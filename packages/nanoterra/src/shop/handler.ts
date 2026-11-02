// The routes of the shop, on the Web `Request` and `Response` types (a Worker, Firebase Functions, Node). The same paths and answers as the game
// starter's Worker, so its page keeps working:
//
//   POST {base}               { lookId, turnstile? }  a new order for a look: 201 and the pay view (or 200 and the same open order again)
//   GET  {base}/{id}          the pay view of the player's own order
//   POST {base}/{id}/check    scans for payments first (at most one scan for the whole game every 4 s), then the pay view
//
// `base` is "/api/orders" (the starter's). The pay view is the order ({ id, lookId, usd, amount, status, createdAt, expiresAt }) with `xno` (the amount as
// XNO text), `test`, `prices` (the feeds' names) and, ONLY outside test mode, `address` and `uri` (the nano: link with the exact raw amount).
//
// The player is the game's own signed-in player (`player(request)`): a visitor who is not signed in gets 401, and another player's order looks like no
// order at all (404). A POST must come from the game's own page. The server decides every price: the browser sends a look's id and nothing else.
//
// TEST MODE: with no payee (none, the example address, or a wrong checksum) or `testMode: true`, the answer carries NO address and NO link, and the page
// shows "TEST MODE: DO NOT PAY". A payment to an address nobody holds the key for is lost for good.

import { fail, json, memoryLimiter, readLimited, sameOrigin } from "../admin/http.js";
import { checkLooks, usdDecimals, type Look } from "../looks/look.js";
import { payeeOf } from "./address.js";
import { nanoUri, priceRaw, xnoText } from "./amount.js";
import { PUBLIC_NODES, type Fetch, type NanoNode, type RpcOptions } from "./nodes.js";
import { MAX_OPEN_PER_PLAYER, ORDER_ID_PATTERN, ShopBusy, orderView, reserveOrder } from "./orders.js";
import { PRICE_FEEDS, usdPerXno, type PriceFeed } from "./price.js";
import { scanPayments, type ScanResult } from "./scan.js";
import type { OrderStatus, ShopOrder, ShopStore } from "./store.js";

/** What the pay screen gets. `address` and `uri` are there only outside test mode. */
export type PayView = {
  id: string;
  lookId: string;
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
  /** The creator's Nano address: payments go straight there. Null, the example address or one with a wrong checksum keeps test mode on. */
  payee: string | null | undefined;
  /** True keeps test mode on with a real address (the starter's TEST_MODE). */
  testMode?: boolean;
  /** The game's signed-in player of this request (its own id: the starter's is the Nano address), or null. Never the admin's login. */
  player(request: Request): Promise<string | null>;
  /** Where the routes are. Default "/api/orders". */
  base?: string;
  /** The nodes that check payments (`nodesFor`). Default: the public nodes. */
  nodes?: readonly NanoNode[];
  /** The price feeds and the `fetch` that reads them. Default: CoinGecko, Kraken and KuCoin, the page's fetch. */
  rate?: { feeds?: readonly PriceFeed[]; fetch?: Fetch };
  /** For the scan's node calls (a test gives its own fetch and timeouts). */
  rpc?: RpcOptions;
  /** A limiter for new orders: false means "too many". Default: a fixed window in memory, SHOP_LIMITS.order. */
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
  /** The biggest body of a POST. */
  bodyMax: 8192,
} as const;

export type ShopHandler = {
  base: string;
  /** The answer for a request under `base`, or null when it is not one of the shop's routes. */
  handle(request: Request): Promise<Response | null>;
  /** One payment scan now (the cron's and the admin's "Check payments now"). */
  scan(at?: number): Promise<ScanResult>;
  /** The looks a paid order gave this player (the free looks are everyone's and are not listed). */
  owned(player: string): Promise<string[]>;
  /** The pay view of an order (for a game's own route). */
  payView(order: ShopOrder, now?: number): PayView;
  /** The payee the shop uses (checked), or null. */
  readonly payee: string | null;
  /** Whether pay screens are in test mode. */
  readonly testMode: boolean;
};

const sharedLimit = memoryLimiter();

export function createShopHandler(options: ShopHandlerOptions): ShopHandler {
  const base = options.base ?? "/api/orders";
  if (!base.startsWith("/") || base.length < 2 || base.endsWith("/")) throw new Error('base must start with "/" and not end with "/", like "/api/orders"');
  const looks: Look[] = checkLooks(options.catalogue);
  const lookById = (id: unknown) => looks.find((l) => l.id === id);
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

  async function createOrder(req: Request, player: string, at: number): Promise<Response> {
    const body = await readBody(req);
    if (!body) return fail(400, "That request is not readable.");
    const look = lookById(body.lookId);
    if (!look) return fail(400, "That look does not exist.");
    if (look.priceUsd === 0) return fail(400, "That look is free: it is already yours.");
    const visitor = options.visitor ? await options.visitor(req) : null;
    if (!(await limit(`order|${visitor ?? player}`, SHOP_LIMITS.order.limit, SHOP_LIMITS.order.windowMs, at))) return fail(429, "Too many orders. Wait a few minutes.");
    if (options.personCheck && !(await options.personCheck(body.turnstile, req))) return fail(403, "The person check failed. Try again.");
    if (await store.owns(player, look.id)) return fail(409, "You already own this look.");
    // One waiting order per look: the same one comes back, with the same amount.
    const same = await store.openOrder(player, look.id, at + 60_000);
    if (same) return json(payView(same, at));
    if ((await store.countOpen(player, at)) >= MAX_OPEN_PER_PLAYER) return fail(429, "You have orders waiting. Pay one or wait until it ends.");
    const rate = await usdPerXno(store, fetchRate, at, feeds);
    if (!rate) return fail(503, "Prices are not available now. Try again later.");
    const price = priceRaw(look.priceUsd, rate.usd);
    if (!price) return fail(503, "Prices are not available now. Try again later.");
    try {
      const order = await reserveOrder(store, { player, lookId: look.id, usd: usdDecimals(look.priceUsd), rate: rate.usd, price, visitor, now: at });
      return json(payView(order, at), 201);
    } catch (e) {
      if (e instanceof ShopBusy) return fail(503, "Many players are paying this price right now. Try again in a minute.");
      throw e;
    }
  }

  async function handle(req: Request): Promise<Response | null> {
    const path = new URL(req.url).pathname;
    const one = path.startsWith(`${base}/`) ? /^([0-9a-f]{24})(\/check)?$/.exec(path.slice(base.length + 1)) : null;
    const isNew = path === base && req.method === "POST";
    if (!isNew && !one) return null;
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

  return { base, handle, scan, owned: (player) => store.owned(player), payView, payee, testMode };
}
