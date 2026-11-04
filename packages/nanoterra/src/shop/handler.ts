// The routes of the shop, on the Web `Request` and `Response` types (a Worker, Firebase Functions, Node). The same paths and answers as the game
// starter's Worker, so its page keeps working:
//
//   POST {base}               { lookId, turnstile? }  a new order for a look: 201 and the pay view (or 200 and the same open order again)
//                             { playId, turnstile? }  the same for a play (a round or a level, used once): exactly one of the two ids
//   GET  {base}/{id}          the pay view of the player's own order
//   POST {base}/{id}/check    scans for payments first (at most one scan for the whole game every 4 s), then the pay view
//   GET  {playsBase}          { plays: [{ playId, ready }] }: how many paid credits of each play wait for the player's use
//   POST {playsBase}/use      { playId, ref }: the round's start uses one credit, once for each ref: 200 { used: true, again }, 402 none is ready,
//                             409 the ref used another play, 400 a bad ref (1 to 64 letters, digits, ":", "_" or "-")
//
// `base` is "/api/orders" (the starter's), `playsBase` "/api/plays". The pay view is the order ({ id, lookId, usd, amount, status, createdAt, expiresAt })
// with `xno` (the amount as XNO text), `test`, `prices` (the feeds' names) and, ONLY outside test mode, `address` and `uri` (the nano: link with the exact
// raw amount); a play's order adds `kind: "play"` and `playId`.
//
// A play is used at the START of a round, never at the buy: a round that could not start costs nothing. The use's answer carries only `used` and `again`:
// nothing about the round (no number, no level, no bonus). A game whose server starts its rounds calls `use(player, playId, ref)` from its own route.
//
// The player is the game's own signed-in player (`player(request)`): a visitor who is not signed in gets 401, and another player's order looks like no
// order at all (404), and another player's credit like none. A POST must come from the game's own page. The server decides every price: the browser
// sends a look's or a play's id and nothing else.
//
// TEST MODE: with no payee (none, the example address, or a wrong checksum) or `testMode: true`, the answer carries NO address and NO link, and the page
// shows "TEST MODE: DO NOT PAY". A payment to an address nobody holds the key for is lost for good.

import { fail, json, memoryLimiter, readLimited, sameOrigin } from "../admin/http.js";
import { checkLooks, usdDecimals, type Look } from "../looks/look.js";
import { checkPlays, type Play } from "../looks/play.js";
import { payeeOf } from "./address.js";
import { nanoUri, priceRaw, xnoText } from "./amount.js";
import { PUBLIC_NODES, type Fetch, type NanoNode, type RpcOptions } from "./nodes.js";
import { MAX_OPEN_PER_PLAYER, ORDER_ID_PATTERN, ShopBusy, orderView, reserveOrder } from "./orders.js";
import { PRICE_FEEDS, usdPerXno, type PriceFeed } from "./price.js";
import { creditWindow, MAX_READY_PER_PLAY, USE_REF_PATTERN } from "./plays.js";
import { scanPayments, type ScanResult } from "./scan.js";
import { kindOf, type OrderStatus, type ReadyCredits, type ShopOrder, type ShopStore } from "./store.js";

/** What the pay screen gets. `address` and `uri` are there only outside test mode. */
export type PayView = {
  id: string;
  lookId: string;
  /** Only on a play's order: "play", and the play's id (the same as `lookId`). */
  kind?: "play";
  playId?: string;
  usd: string;
  amount: string;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
  xno: string;
  test: boolean;
  address?: string;
  uri?: string;
  prices: string[];
};

export type ShopHandlerOptions = {
  store: ShopStore;
  /** The game's looks (looks.json as it was read). They are checked with `checkLooks`: a bad file throws here, before any sale. */
  catalogue: unknown;
  /**
   * The game's plays (plays.json as it was read), or none: the game sells looks only. They are checked with `checkPlays` (no play takes a look's id): a bad
   * file throws here, before any sale. A D1 store sells plays only with the plays' migration and `{ plays: true }` (createShop does it).
   */
  plays?: unknown;
  /** The creator's Nano address: payments go straight there. Null, the example address or one with a wrong checksum keeps test mode on. */
  payee: string | null | undefined;
  /** True keeps test mode on with a real address (the starter's TEST_MODE). */
  testMode?: boolean;
  /** The game's signed-in player of this request (its own id: the starter's is the Nano address), or null. Never the admin's login. */
  player(request: Request): Promise<string | null>;
  /** Where the routes are. Default "/api/orders". */
  base?: string;
  /** Where the plays' routes are. Default "/api/plays". */
  playsBase?: string;
  /** The nodes that check payments (`nodesFor`). Default: the public nodes. */
  nodes?: readonly NanoNode[];
  /** The price feeds and the `fetch` that reads them. Default: CoinGecko, Kraken and KuCoin, the page's fetch. */
  rate?: { feeds?: readonly PriceFeed[]; fetch?: Fetch };
  /** For the scan's node calls (a test gives its own fetch and timeouts). */
  rpc?: RpcOptions;
  /** A limiter for new orders and for uses: false means "too many". Default: a fixed window in memory, SHOP_LIMITS.order and SHOP_LIMITS.use. */
  limit?: (key: string, limit: number, windowMs: number, now: number) => boolean | Promise<boolean>;
  /** A keyed hash of the visitor's IP address (never the address), kept on the order and used as the limit's key; null or no hook: the player's id. */
  visitor?: (request: Request) => Promise<string | null>;
  /** The person check (Turnstile): true when `token` passes. No hook: no check. The starter's checks `body.turnstile` with Cloudflare. */
  personCheck?: (token: unknown, request: Request) => Promise<boolean>;
  /** The time now in ms. Default Date.now. */
  now?: () => number;
  /** Told about a fault (a store, a node). The player gets a plain 500 and never sees it. */
  onError?: (e: unknown) => void;
};

export const SHOP_LIMITS = {
  /** New orders of one visitor (the starter's: 10 in 10 minutes). */
  order: { limit: 10, windowMs: 10 * 60_000 },
  /** Uses of one player (a round start each). */
  use: { limit: 60, windowMs: 60_000 },
  /** The biggest body of a POST. */
  bodyMax: 8192,
} as const;

/**
 * What a use did. `used`: the round may start (`again`: this ref used its credit before, the same answer again). Else `why`: "none" (no credit of the
 * play is ready), "other-play" (this ref used a credit of another play), "no-play" (no such play) or "bad-ref".
 */
export type UseAnswer = { used: true; again: boolean } | { used: false; why: "none" | "other-play" | "no-play" | "bad-ref" };

export type ShopHandler = {
  base: string;
  playsBase: string;
  /** The answer for a request under `base` or `playsBase`, or null when it is not one of the shop's routes. */
  handle(request: Request): Promise<Response | null>;
  /** One payment scan now (the cron's and the admin's "Check payments now"). */
  scan(at?: number): Promise<ScanResult>;
  /** The looks a paid order gave this player (the free looks are everyone's and are not listed). */
  owned(player: string): Promise<string[]>;
  /** The pay view of an order (for a game's own route). */
  payView(order: ShopOrder, now?: number): PayView;
  /** How many credits of each play wait for this player's use (every play of plays.json, 0 when none). */
  ready(player: string, now?: number): Promise<ReadyCredits[]>;
  /** Uses one credit of this play for the round `ref`, once (for a game's own round route; the player is the signed-in one). */
  use(player: string, playId: unknown, ref: unknown, now?: number): Promise<UseAnswer>;
  /** The payee the shop uses (checked), or null. */
  readonly payee: string | null;
  /** Whether pay screens are in test mode. */
  readonly testMode: boolean;
};

const sharedLimit = memoryLimiter();

export function createShopHandler(options: ShopHandlerOptions): ShopHandler {
  const base = options.base ?? "/api/orders";
  if (!base.startsWith("/") || base.length < 2 || base.endsWith("/")) throw new Error('base must start with "/" and not end with "/", like "/api/orders"');
  const playsBase = options.playsBase ?? "/api/plays";
  if (!playsBase.startsWith("/") || playsBase.length < 2 || playsBase.endsWith("/") || playsBase === base) throw new Error('playsBase must start with "/", not end with "/" and not be base, like "/api/plays"');
  const looks: Look[] = checkLooks(options.catalogue);
  const lookById = (id: unknown) => looks.find((l) => l.id === id);
  const plays: Play[] = options.plays === undefined || options.plays === null ? [] : checkPlays(options.plays, looks);
  const playById = (id: unknown) => plays.find((p) => p.id === id);
  const payee = payeeOf(options.payee);
  const testMode = payee === null || options.testMode === true;
  const now = options.now ?? (() => Date.now());
  const limit = options.limit ?? sharedLimit;
  const nodes = options.nodes ?? PUBLIC_NODES;
  const feeds = options.rate?.feeds ?? PRICE_FEEDS;
  const fetchRate: Fetch = options.rate?.fetch ?? ((i, init) => fetch(i, init));
  const store = options.store;
  const report = (e: unknown) => {
    try {
      options.onError?.(e);
    } catch {
      // nothing more can be done
    }
  };

  const payView = (o: ShopOrder, at = now()): PayView => ({
    ...orderView(o, at),
    ...(kindOf(o) === "play" ? { kind: "play" as const, playId: o.lookId } : {}),
    xno: xnoText(o.amount),
    test: testMode,
    ...(!testMode && payee ? { address: payee, uri: nanoUri(payee, o.amount) } : {}),
    prices: feeds.map((f) => f.name),
  });

  const scan = (at = now()) => scanPayments(store, { address: payee, nodes, at, rpc: options.rpc });

  async function readBody(req: Request): Promise<Record<string, unknown> | null> {
    const text = await readLimited(req, SHOP_LIMITS.bodyMax);
    if (text === null) return null;
    if (!text) return {};
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    } catch {
      return null;
    }
  }

  /** How many credits of one play wait for this player now. */
  const readyOf = async (player: string, play: Play, at: number) => (await store.credits(player, creditWindow(play, at))).find((r) => r.playId === play.id)?.ready ?? 0;

  async function ready(player: string, at = now()): Promise<ReadyCredits[]> {
    // One read for each wait (most games have one), then each play's count.
    const byWindow = new Map<number, ReadyCredits[]>();
    for (const p of plays) {
      const from = creditWindow(p, at);
      if (!byWindow.has(from)) byWindow.set(from, await store.credits(player, from));
    }
    return plays.map((p) => ({ playId: p.id, ready: byWindow.get(creditWindow(p, at))!.find((r) => r.playId === p.id)?.ready ?? 0 }));
  }

  async function use(player: string, playId: unknown, ref: unknown, at = now()): Promise<UseAnswer> {
    const play = playById(playId);
    if (!play) return { used: false, why: "no-play" };
    if (typeof ref !== "string" || !USE_REF_PATTERN.test(ref)) return { used: false, why: "bad-ref" };
    const r = await store.useCredit(player, play.id, ref, at, creditWindow(play, at));
    if (r.status === "none") return { used: false, why: "none" };
    // A ref names one use: the same ref for another play is not a second use.
    if (r.credit.playId !== play.id) return { used: false, why: "other-play" };
    return { used: true, again: r.status === "again" };
  }

  async function createOrder(req: Request, player: string, at: number): Promise<Response> {
    const body = await readBody(req);
    if (!body) return fail(400, "That request is not readable.");
    if (body.lookId !== undefined && body.playId !== undefined) return fail(400, "Send a lookId or a playId, not both.");
    // What is sold, and at what price: the server's, from the id alone.
    let item: { id: string; priceUsd: number; play: Play | null };
    if (body.playId !== undefined) {
      const play = playById(body.playId);
      if (!play) return fail(400, "That play does not exist.");
      item = { id: play.id, priceUsd: play.priceUsd, play };
    } else {
      const look = lookById(body.lookId);
      if (!look) return fail(400, "That look does not exist.");
      if (look.priceUsd === 0) return fail(400, "That look is free: it is already yours.");
      item = { id: look.id, priceUsd: look.priceUsd, play: null };
    }
    const visitor = options.visitor ? await options.visitor(req) : null;
    if (!(await limit(`order|${visitor ?? player}`, SHOP_LIMITS.order.limit, SHOP_LIMITS.order.windowMs, at))) return fail(429, "Too many orders. Wait a few minutes.");
    if (options.personCheck && !(await options.personCheck(body.turnstile, req))) return fail(403, "The person check failed. Try again.");
    if (item.play) {
      // The money that waits in credits stays small: a few rounds ready at most.
      if ((await readyOf(player, item.play, at)) >= MAX_READY_PER_PLAY) return fail(409, `You have ${MAX_READY_PER_PLAY} ${item.play.use}s ready. Play one first.`);
    } else if (await store.owns(player, item.id)) return fail(409, "You already own this look.");
    // One waiting order per look or play: the same one comes back, with the same amount.
    const same = await store.openOrder(player, item.id, at + 60_000);
    if (same) return json(payView(same, at));
    if ((await store.countOpen(player, at)) >= MAX_OPEN_PER_PLAYER) return fail(429, "You have orders waiting. Pay one or wait until it ends.");
    const rate = await usdPerXno(store, fetchRate, at, feeds);
    if (!rate) return fail(503, "Prices are not available now. Try again later.");
    const price = priceRaw(item.priceUsd, rate.usd);
    if (!price) return fail(503, "Prices are not available now. Try again later.");
    try {
      const order = await reserveOrder(store, { player, lookId: item.id, kind: item.play ? "play" : "look", usd: usdDecimals(item.priceUsd), rate: rate.usd, price, visitor, now: at });
      return json(payView(order, at), 201);
    } catch (e) {
      if (e instanceof ShopBusy) return fail(503, "Many players are paying this price right now. Try again in a minute.");
      throw e;
    }
  }

  async function usePlay(req: Request, player: string, at: number): Promise<Response> {
    if (!(await limit(`use|${player}`, SHOP_LIMITS.use.limit, SHOP_LIMITS.use.windowMs, at))) return fail(429, "Too many tries. Wait a minute.");
    const body = await readBody(req);
    if (!body) return fail(400, "That request is not readable.");
    const r = await use(player, body.playId, body.ref, at);
    // Only these two keys: the use says nothing about the round.
    if (r.used) return json({ used: true, again: r.again });
    if (r.why === "no-play") return fail(400, "That play does not exist.");
    if (r.why === "bad-ref") return fail(400, "That round id is not right.");
    if (r.why === "other-play") return fail(409, "That round id was used for another play.");
    return fail(402, `No ${playById(body.playId)!.use} is ready. Buy one first.`);
  }

  async function handle(req: Request): Promise<Response | null> {
    const path = new URL(req.url).pathname;
    const one = path.startsWith(`${base}/`) ? /^([0-9a-f]{24})(\/check)?$/.exec(path.slice(base.length + 1)) : null;
    const isNew = path === base && req.method === "POST";
    const playsRoute = path === playsBase ? "list" : path === `${playsBase}/use` ? "use" : null;
    if (!isNew && !one && !playsRoute) return null;
    try {
      // Every call that changes something must come from the game's own pages.
      if (req.method === "POST" && !sameOrigin(req)) return fail(403, "This call must come from the game's own page.");
      let player: string | null;
      try {
        player = await options.player(req);
      } catch (e) {
        report(e);
        return fail(503, "The game's server could not check your sign-in. Try again.");
      }
      if (typeof player !== "string" || !player) return fail(401, "Sign in first.");
      const at = now();
      if (isNew) return await createOrder(req, player, at);
      if (playsRoute === "list") return req.method === "GET" ? json({ plays: await ready(player, at) }) : fail(405, "Not allowed.");
      if (playsRoute === "use") return req.method === "POST" ? await usePlay(req, player, at) : fail(405, "Not allowed.");
      const [, id, check] = one!;
      if (check && req.method === "POST") {
        const r = await scan(at);
        if (r.error) report(new Error(`payment scan: ${r.error}`));
      } else if (check || req.method !== "GET") return fail(405, "Not allowed.");
      const o = ORDER_ID_PATTERN.test(id) ? await store.order(id) : null;
      // Another player's order looks the same as no order at all.
      if (!o || o.player !== player) return fail(404, "No such order.");
      return json(payView(o, at));
    } catch (e) {
      report(e);
      return fail(500, "Something went wrong. Try again.");
    }
  }

  return { base, playsBase, handle, scan, owned: (player) => store.owned(player), payView, ready, use, payee, testMode };
}
