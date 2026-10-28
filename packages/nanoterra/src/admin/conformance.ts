// The conformance suite: every game that uses the admin handler runs this against its OWN session code and store, in its own tests. It proves
// the whole chain (the cookie, the session lookup, the guard, the routes), not only the pure guard: a game that reads the wrong cookie, or that
// forgets to pass its owner, fails here.
//
//   import { adminConformance } from "@nano133/nanoterra/admin/conformance";
//   for (const c of adminConformance(host)) it(c.name, c.run);      // vitest, node:test, any runner
//
// `host.request(who, ...)` sends the request as that kind of visitor. The game makes each kind from its own sessions (see `Who`). The suite asks
// only for statuses and for the words "reason" and "error"; it never reads a cookie.

import type { AdminRoute } from "./handler.js";
import type { AdminStore } from "./store.js";
import { ORDERS_SHOWN, type OrderRow } from "./summary.js";

/**
 * The kinds of visitor the game must be able to make:
 *  - signed_out            no cookie at all
 *  - game_login            a valid login made for the game's PLAYERS (the owner's own address, even), in the game's own cookie: it is not an admin login
 *  - game_token_as_admin   the token of that same player login, put in the ADMIN cookie. The game must keep the two scopes apart in its store, not only in the cookie names
 *  - nanoterra_login       an admin-scope login whose `via` is "nanoterra" (a sign-in from Nanoterra), for the owner's address
 *  - unknown_via_login     an admin-scope login of the owner's whose `via` is a word the game does not know (like "ticket", or an empty one): it must fail closed
 *  - other_wallet          a wallet login for an address that is not the owner's
 *  - no_address            a wallet login while the game has NO owner address set (the game runs with none)
 *  - expired_login         a wallet login of the owner's, made LESS than a day ago, that the game's own store has already expired (its own life is shorter than a day, or it ended).
 *                          The guard's age check cannot refuse it, so only the game's store does: a game whose session code ignores its own expiry fails here
 *  - signed_out_login      a wallet login of the owner's, made just now, that the game's own sign-out route has ended. A game that still reads it fails here
 *  - old_valid_row         a wallet login of the owner's made more than one day ago whose stored row is STILL valid, so only the guard's own age check can refuse it. The suite sends it
 *                          TWICE (the second time with `again: true`, the same login): a game that renews the creation time on every read fails here
 *  - owner                 a wallet login of the owner's, made just now
 */
export type Who = "signed_out" | "game_login" | "game_token_as_admin" | "nanoterra_login" | "unknown_via_login" | "other_wallet" | "no_address" | "expired_login" | "signed_out_login" | "old_valid_row" | "owner";

export type ConformanceRequest = {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
  /** True when the suite wants the SAME login as the last request of this kind (do not make a new one): a host must support it, or a session that renews itself on each read is not caught. */
  again?: boolean;
};

export type ConformanceHost = {
  /** The handler's `routes`. */
  routes: readonly AdminRoute[];
  /** The handler's `basePath`. */
  basePath: string;
  /** The game's own origin, like "https://game.example": the suite sends it as the Origin of a good POST. */
  origin: string;
  /**
   * Other routes that the game's OWN router serves under the base path (an old route, a debug route, a route kept for an old page): `{ method, path }`. The suite sends each
   * as every kind of visitor who is not the owner and requires a refusal: a route that the game's router answers BEFORE the handler, with no guard, must show up here.
   * List every one you know of; the suite cannot find the ones your router hides from it.
   */
  otherRoutes?: readonly { method: string; path: string }[];
  request(who: Who, req: ConformanceRequest): Promise<Response>;
};

export type ConformanceCase = { name: string; run: () => Promise<void> };

const REFUSALS: { who: Who; status: number; reason?: string; words: string }[] = [
  { who: "signed_out", status: 401, words: "a visitor who is signed out" },
  { who: "game_login", status: 401, words: "a login that was made for the game's players" },
  { who: "game_token_as_admin", status: 401, words: "the token of a player's login put in the admin cookie" },
  { who: "nanoterra_login", status: 403, reason: "nanoterra", words: "a Nanoterra sign-in (it names an address but proves no key)" },
  { who: "unknown_via_login", status: 403, words: "an admin login that was made some way the game does not know (it must fail closed)" },
  { who: "other_wallet", status: 403, reason: "other_address", words: "a wallet that is not the owner's" },
  { who: "no_address", status: 403, reason: "no_address", words: "anyone, while the game has no owner address" },
  { who: "expired_login", status: 401, words: "an admin login that the game's own store has expired (made less than a day ago)" },
  { who: "signed_out_login", status: 401, words: "an admin login that the game's own sign-out has ended" },
  { who: "old_valid_row", status: 401, words: "an admin login that is more than a day old but still valid in the game's store (only the guard's age check refuses it)" },
];

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

async function read(res: Response): Promise<{ status: number; text: string; json: Record<string, unknown> | null }> {
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) json = v as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return { status: res.status, text, json };
}

/** A refusal carries words and a reason and nothing else: no data of the game. */
const REFUSAL_KEYS = new Set(["error", "reason", "signedInAs"]);

/** Words of the game's data that a refusal or an answer to a visitor must never hold. */
const DATA_WORDS = /"orders"|"players"|"totals"|"counts"|"character"|"signin"|"warnings"/;

export function adminConformance(host: ConformanceHost): ConformanceCase[] {
  const cases: ConformanceCase[] = [];
  const add = (name: string, run: () => Promise<void>) => cases.push({ name, run });
  const good = (extra: Record<string, string> = {}) => ({ Origin: host.origin, "Content-Type": "application/json", ...extra });
  const body = (r: { method: string }) => (r.method === "POST" ? "{}" : undefined);
  const NOT_OWNER = REFUSALS.map((r) => r.who);

  check(host.routes.length > 0, "the host lists no routes");

  /**
   * Sends a request and looks at the HEADERS of the answer: every answer to a request for the admin is `no-store` and has no CORS header, whatever the method and the
   * status (a preflight answer that allows an origin, or a cached refusal, is a fault). `strict: false` is for paths that the game's own router may answer (a plain 404).
   */
  async function send(who: Who, req: ConformanceRequest, strict = true): Promise<Response> {
    const res = await host.request(who, req);
    let cors = "";
    res.headers.forEach((v, k) => {
      if (k.toLowerCase().startsWith("access-control-")) cors = `${k}: ${v}`;
    });
    check(cors === "", `${req.method} ${req.path} as ${who}: the answer has a CORS header (${cors})`);
    if (strict) check((res.headers.get("cache-control") ?? "").includes("no-store"), `${req.method} ${req.path} as ${who}: the answer (${res.status}) is not "Cache-Control: no-store"`);
    return res;
  }

  for (const r of REFUSALS) {
    add(`every route refuses ${r.words} (${r.status}${r.reason ? `, ${r.reason}` : ""}) and gives it no data`, async () => {
      for (const route of host.routes) {
        const got = await read(await send(r.who, { method: route.method, path: route.path, headers: good(), body: body(route) }));
        const here = `${route.method} ${route.path} as ${r.who}`;
        check(got.status === r.status, `${here}: expected ${r.status}, got ${got.status}`);
        if (r.reason) check(got.json?.reason === r.reason, `${here}: expected reason "${r.reason}", got ${JSON.stringify(got.json?.reason)}`);
        check(got.json !== null && Object.keys(got.json).every((k) => REFUSAL_KEYS.has(k)), `${here}: a refusal must carry only error, reason and signedInAs, got ${got.text.slice(0, 120)}`);
      }
    });
  }

  add("OPTIONS and HEAD on every route are refused like any other method, with no CORS answer: no preflight is ever answered for a visitor", async () => {
    for (const r of REFUSALS) {
      for (const route of host.routes) {
        for (const method of ["OPTIONS", "HEAD"]) {
          const headers = method === "OPTIONS" ? good({ "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }) : good();
          const got = await send(r.who, { method, path: route.path, headers });
          check(got.status === r.status, `${method} ${route.path} as ${r.who}: expected ${r.status}, got ${got.status}`);
        }
      }
    }
  });

  add("an unknown path under the base is refused like any admin path (so the routes are not leaked): the same refusal for a visitor, 404 for the owner", async () => {
    const path = `${host.basePath}/no-such-page`;
    for (const r of REFUSALS) {
      const got = await send(r.who, { method: "GET", path });
      check(got.status === r.status, `GET ${path} as ${r.who}: expected ${r.status}, got ${got.status}`);
    }
    const owner = await send("owner", { method: "GET", path });
    check(owner.status === 404, `GET ${path} as owner: expected 404, got ${owner.status}`);
  });

  add("the game's other routes under the base (the ones its own router serves) refuse every visitor who is not the owner, with a refusal that carries no data", async () => {
    for (const route of host.otherRoutes ?? []) {
      for (const who of NOT_OWNER) {
        const got = await read(await send(who, { method: route.method, path: route.path, headers: good(), body: body(route) }, false));
        const here = `${route.method} ${route.path} as ${who}`;
        check(got.status === 401 || got.status === 403, `${here}: expected 401 or 403, got ${got.status}`);
        check(!DATA_WORDS.test(got.text), `${here}: the answer holds the game's data`);
        check(got.json !== null && Object.keys(got.json).every((k) => REFUSAL_KEYS.has(k)), `${here}: a refusal must carry only error, reason and signedInAs, got ${got.text.slice(0, 120)}`);
      }
    }
  });

  /** Other spellings of one admin path: other case, a slash, a doubled slash, a percent code, a backslash, a dot segment. */
  const spellings = (path: string): string[] => {
    const last = path.slice(path.lastIndexOf("/") + 1);
    const base = host.basePath;
    return [
      path.toUpperCase(),
      `${path}/`,
      path.replace(`/${last}`, `//${last}`),
      path.slice(0, -1) + `%${path.charCodeAt(path.length - 1).toString(16)}`,
      path.replace(`/${last}`, `/x/../${last}`),
      `${base}%2f${last}`,
      `${base}\\${last}`,
      `${base}%5c${last}`,
      `${base.replace(/^\/(\w+)\//, "/$1%2f")}/${last}`,
      `${base.replace(/^\/(\w)/, (_, c: string) => `/%${c.charCodeAt(0).toString(16)}`)}/${last}`,
    ];
  };

  add("other spellings of EVERY admin path never open anything for a visitor, with any method", async () => {
    const seen = new Set<string>();
    for (const route of host.routes) {
      for (const path of spellings(route.path)) {
        if (seen.has(path)) continue;
        seen.add(path);
        for (const who of NOT_OWNER) {
          for (const method of new Set([route.method, "GET", "POST", "OPTIONS", "HEAD"])) {
            const got = await read(await send(who, { method, path, headers: good(), body: body({ method }) }, false));
            check([401, 403, 404, 405].includes(got.status), `${method} ${path} as ${who}: expected 401, 403, 404 or 405, got ${got.status}`);
            check(!DATA_WORDS.test(got.text), `${method} ${path} as ${who}: the answer holds the game's data`);
          }
        }
      }
    }
  });

  add("a request from another page never gets a CORS header, and never the data: a foreign Origin (another site, 'null', a sibling subdomain) on every route, with every method, for the owner and for every visitor", async () => {
    const own = new URL(host.origin);
    const origins = ["https://evil.example", "null", `${own.protocol}//evil.${own.host}`, `${own.protocol}//${own.host.replace(/^[^.]+\./, "sibling.")}`, `${own.protocol}//${own.host}.evil.example`];
    const WHO: Who[] = ["owner", ...NOT_OWNER];
    for (const route of host.routes) {
      for (const origin of origins) {
        for (const who of WHO) {
          for (const method of new Set([route.method, "GET", "OPTIONS", "HEAD"])) {
            const got = await read(await send(who, { method, path: route.path, headers: { Origin: origin, "Content-Type": "application/json" }, body: body({ method }) }));
            const here = `${method} ${route.path} as ${who} with Origin ${origin}`;
            check([401, 403, 405].includes(got.status), `${here}: a foreign page must get 401, 403 or 405, got ${got.status}`);
            check(!DATA_WORDS.test(got.text), `${here}: the answer holds the game's data`);
          }
        }
      }
      // Sec-Fetch-Site says the same: cross-site and same-site (a sibling subdomain has the game's cookies) are not the game's own page.
      for (const site of ["cross-site", "same-site"]) {
        const got = await read(await send("owner", { method: route.method, path: route.path, headers: { "Sec-Fetch-Site": site, "Content-Type": "application/json" }, body: body(route) }));
        check(got.status === 403, `${route.method} ${route.path} as owner with Sec-Fetch-Site ${site}: expected 403, got ${got.status}`);
      }
    }
  });

  add("an old login that is still valid in the store is refused EVERY time it is used, not only the first: a game must not renew a login on each read", async () => {
    for (const route of host.routes) {
      for (const again of [false, true, true]) {
        const got = await read(await send("old_valid_row", { method: route.method, path: route.path, headers: good(), body: body(route), again }));
        check(got.status === 401, `${route.method} ${route.path} as old_valid_row${again ? " (the same login again)" : ""}: expected 401, got ${got.status}`);
      }
    }
  });

  add("the owner gets through the guard on every route", async () => {
    for (const route of host.routes) {
      const res = await send("owner", { method: route.method, path: route.path, headers: good(), body: body(route) });
      const got = await read(res);
      check(![401, 403, 404, 405].includes(got.status) && got.status < 500, `${route.method} ${route.path} as owner: the guard let the owner through, but the status was ${got.status}`);
    }
  });

  add("a POST from another site is refused (403), even with the owner's cookie", async () => {
    for (const route of host.routes.filter((r) => r.method === "POST")) {
      const other = await read(await send("owner", { method: "POST", path: route.path, headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" }));
      check(other.status === 403, `POST ${route.path} with another Origin: expected 403, got ${other.status}`);
      const fetchSite = await read(await send("owner", { method: "POST", path: route.path, headers: { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, body: "{}" }));
      check(fetchSite.status === 403, `POST ${route.path} with no Origin and Sec-Fetch-Site cross-site: expected 403, got ${fetchSite.status}`);
      const none = await read(await send("owner", { method: "POST", path: route.path, headers: { "Content-Type": "application/json" }, body: "{}" }));
      check(none.status === 403, `POST ${route.path} with neither Origin nor Sec-Fetch-Site: expected 403, got ${none.status}`);
    }
  });

  add("a method that a route does not have is refused: the guard's answer for a visitor, 405 for the owner", async () => {
    for (const route of host.routes) {
      const owner = await read(await send("owner", { method: "DELETE", path: route.path, headers: good() }));
      check(owner.status === 405, `DELETE ${route.path} as owner: expected 405, got ${owner.status}`);
      const visitor = await read(await send("signed_out", { method: "DELETE", path: route.path, headers: good() }));
      check(visitor.status === 401, `DELETE ${route.path} signed out: expected 401, got ${visitor.status}`);
    }
  });

  add("a body that is far too big is refused and changes nothing", async () => {
    const big = JSON.stringify({ character: "own", pad: "x".repeat(100_000) });
    for (const route of host.routes.filter((r) => r.method === "POST" && r.path.endsWith("/game"))) {
      const got = await read(await send("owner", { method: "POST", path: route.path, headers: good(), body: big }));
      check(got.status === 413 || got.status === 400, `POST ${route.path} with 100 KB: expected 413 or 400, got ${got.status}`);
    }
  });

  return cases;
}

// ---- the store contract: every adapter (the memory store, D1, Firestore, a game's own) must pass these ----

/** What a test gives to run the store contract: the store, and a way to put rows in the game's database the way the game's own code does (the store has no write for them). */
export type StoreHarness = {
  store: AdminStore;
  seed(data: { orders?: OrderRow[]; owned?: { player: string; lookId: string; at: number }[]; rate?: { value: string; at: number } }): Promise<void>;
  /** Every row that the store could change by mistake, as one text: the orders, the owned looks and the meta rows that are NOT the two settings. Same rows, same text. */
  snapshot(): Promise<string>;
  /** Only for a store with `recentLogins` and `signOutEverywhere`: put admin sign-ins in the game's database (the store only reads them). */
  seedLogins?(rows: { at: number; country: string | null; browser: string }[]): Promise<void>;
  /** Put this many admin sessions and this many player sessions in the game's database. */
  seedSessions?(n: { admin: number; play: number }): Promise<void>;
  /** How many admin sessions and how many player sessions the game's database holds now. */
  sessionCounts?(): Promise<{ admin: number; play: number }>;
};

const rawOf = (xno: number): string => (BigInt(Math.round(xno * 10_000)) * 10n ** 26n).toString();

export function adminStoreConformance(make: () => Promise<StoreHarness>): ConformanceCase[] {
  const cases: ConformanceCase[] = [];
  const add = (name: string, run: (h: StoreHarness) => Promise<void>) => cases.push({ name, run: async () => run(await make()) });
  const NOW = 1_800_000_000_000;
  const A = `nano_1${"a".repeat(59)}`;
  const B = `nano_3${"b".repeat(59)}`;
  const order = (id: string, over: Partial<OrderRow>): OrderRow => ({ id, player: A, lookId: "mint-cap", usd: "0.25", amountRaw: rawOf(0.25), status: "paid", createdAt: NOW - 1000, expiresAt: NOW + 1000, paidAt: NOW - 500, payer: A, hash: `H${id}`, ...over });

  add("a new store has no settings of its own", async ({ store }) => {
    const s = await store.readSettings();
    check(s.character === undefined && s.signin === undefined, `expected no settings, got ${JSON.stringify(s)}`);
  });

  add("a patch saves only what it names; the next patch keeps the rest", async ({ store }) => {
    await store.saveSettings({ signin: "none" }, NOW);
    let s = await store.readSettings();
    check(s.signin === "none" && s.character === undefined, `after signin none: ${JSON.stringify(s)}`);
    await store.saveSettings({ character: "own" }, NOW + 1);
    s = await store.readSettings();
    check(s.signin === "none" && s.character === "own", `after character own: ${JSON.stringify(s)}`);
    await store.saveSettings({ signin: "exchange", character: "nanoterra" }, NOW + 2);
    s = await store.readSettings();
    check(s.signin === "exchange" && s.character === "nanoterra", `after both: ${JSON.stringify(s)}`);
  });

  add("an empty patch writes nothing and does not fail", async ({ store }) => {
    await store.saveSettings({}, NOW);
    const s = await store.readSettings();
    check(s.character === undefined && s.signin === undefined, "an empty patch must save nothing");
  });

  add("saving changes nothing but the two settings: no order, no owned look, no other meta row", async (h) => {
    await h.seed({ orders: [order("1", {}), order("2", { status: "open" })], owned: [{ player: A, lookId: "mint-cap", at: NOW }], rate: { value: JSON.stringify({ usd: 1.2, sources: ["x"] }), at: NOW } });
    const before = await h.snapshot();
    await h.store.saveSettings({ character: "own", signin: "none" }, NOW + 5);
    check((await h.snapshot()) === before, "the rows of the game changed after saving the settings");
  });

  add("the summary counts the orders by status, reads an open order past its expiry as expired, and totals the money", async ({ store, seed }) => {
    await seed({
      orders: [
        order("a", { status: "paid", usd: "0.25", amountRaw: rawOf(0.25) }),
        order("b", { status: "paid", usd: "0.50", amountRaw: rawOf(0.5) }),
        order("c", { status: "paid_late", usd: "1.10", amountRaw: rawOf(0.9) }),
        order("d", { status: "open", expiresAt: NOW + 1000, paidAt: null, payer: null, hash: null }),
        order("e", { status: "open", expiresAt: NOW - 1000, paidAt: null, payer: null, hash: null }),
        order("f", { status: "expired", expiresAt: NOW - 5000, paidAt: null, payer: null, hash: null }),
      ],
    });
    const s = await store.summary(NOW);
    check(JSON.stringify(s.counts) === JSON.stringify({ open: 1, paid: 2, expired: 2, paid_late: 1 }), `counts: ${JSON.stringify(s.counts)}`);
    check(JSON.stringify(s.totals.paid) === JSON.stringify({ count: 2, xno: "0.75", usd: "0.75" }), `paid: ${JSON.stringify(s.totals.paid)}`);
    check(JSON.stringify(s.totals.paidLate) === JSON.stringify({ count: 1, xno: "0.9", usd: "1.10" }), `paid late: ${JSON.stringify(s.totals.paidLate)}`);
    const e = s.orders.find((o) => o.id === "e");
    check(e?.status === "expired", `an open order past its expiry reads "expired", got ${e?.status}`);
    check(s.orders.find((o) => o.id === "d")?.status === "open", "an open order that has not run out stays open");
    const a = s.orders.find((o) => o.id === "a")!;
    check(a.xno === "0.25" && a.usd === "0.25" && a.player === A && a.lookId === "mint-cap" && a.hash === "Ha" && a.payer === A && a.paidAt === NOW - 500, `an order's fields: ${JSON.stringify(a)}`);
  });

  add(`the summary lists the newest ${ORDERS_SHOWN} orders, newest first, and still counts them all`, async ({ store, seed }) => {
    const rows: OrderRow[] = [];
    for (let i = 0; i < ORDERS_SHOWN + 5; i++) rows.push(order(`o${String(i).padStart(4, "0")}`, { createdAt: NOW - 100_000 + i, status: "paid", hash: `H${i}` }));
    await seed({ orders: rows });
    const s = await store.summary(NOW);
    check(s.orders.length === ORDERS_SHOWN, `expected ${ORDERS_SHOWN} orders, got ${s.orders.length}`);
    check(s.orders[0].id === `o${String(ORDERS_SHOWN + 4).padStart(4, "0")}`, `the first order must be the newest, got ${s.orders[0].id}`);
    check(s.orders.every((o, i, all) => i === 0 || all[i - 1].createdAt >= o.createdAt), "the orders are not newest first");
    check(s.counts.paid === ORDERS_SHOWN + 5, `the count must be over all orders, got ${s.counts.paid}`);
    check(s.totals.paid.count === ORDERS_SHOWN + 5, `the total must be over all orders, got ${s.totals.paid.count}`);
  });

  add("the summary lists the looks that players own, by player and in the order they were granted", async ({ store, seed }) => {
    await seed({ owned: [{ player: B, lookId: "royal", at: NOW - 10 }, { player: A, lookId: "sunset", at: NOW - 30 }, { player: A, lookId: "mint-cap", at: NOW - 40 }] });
    const s = await store.summary(NOW);
    check(JSON.stringify(s.players) === JSON.stringify([{ player: A, looks: [{ id: "mint-cap", at: NOW - 40 }, { id: "sunset", at: NOW - 30 }] }, { player: B, looks: [{ id: "royal", at: NOW - 10 }] }]), JSON.stringify(s.players));
  });

  add("the rate is null when there is none, read when it is good, and null when the row is junk", async ({ store, seed }) => {
    check((await store.summary(NOW)).rate === null, "no rate row must give null");
    await seed({ rate: { value: JSON.stringify({ usd: 1.18, sources: ["a", "b"] }), at: NOW - 60 } });
    check(JSON.stringify((await store.summary(NOW)).rate) === JSON.stringify({ usd: 1.18, sources: ["a", "b"], at: NOW - 60 }), "a good rate row must be read");
    await seed({ rate: { value: "not json", at: NOW } });
    check((await store.summary(NOW)).rate === null, "a junk rate row must give null");
  });

  // The sign-in list and "sign out everywhere" are optional: a store that has them must pass these cases (a store that has not skips them).
  add("(when the store lists sign-ins) the last sign-ins come newest first, at most the limit, with only the time, the country and the browser", async (h) => {
    if (!h.store.recentLogins) return;
    check(Boolean(h.seedLogins), "a store with recentLogins needs seedLogins in its harness");
    check((await h.store.recentLogins(10)).length === 0, "a new store lists no sign-ins");
    const rows = Array.from({ length: 12 }, (_, i) => ({ at: NOW - 1000 * (12 - i), country: i % 3 === 0 ? null : "US", browser: `Chrome on macOS ${i}` }));
    await h.seedLogins!(rows);
    const got = await h.store.recentLogins(10);
    check(got.length === 10, `expected 10 sign-ins, got ${got.length}`);
    check(got.every((l, i, all) => i === 0 || all[i - 1].at >= l.at), "the sign-ins are not newest first");
    check(got[0].at === NOW - 1000 && got[0].browser === "Chrome on macOS 11", `the first must be the newest: ${JSON.stringify(got[0])}`);
    check(got.every((l) => Object.keys(l).sort().join() === "at,browser,country"), `a sign-in must carry only at, browser and country: ${JSON.stringify(got[0])}`);
    check((await h.store.recentLogins(3)).length === 3, "the limit must hold");
    check((await h.store.recentLogins(0)).length === 0, "a limit of 0 lists none");
  });

  add("(when the store can sign out everywhere) it deletes every admin session and no player session, says how many, and changes nothing else", async (h) => {
    if (!h.store.signOutEverywhere) return;
    check(Boolean(h.seedSessions && h.sessionCounts), "a store with signOutEverywhere needs seedSessions and sessionCounts in its harness");
    await h.seed({ orders: [order("1", {}), order("2", { status: "open" })], owned: [{ player: A, lookId: "mint-cap", at: NOW }] });
    await h.seedSessions!({ admin: 3, play: 4 });
    const before = await h.snapshot();
    const n = await h.store.signOutEverywhere();
    check(n === 3, `expected 3 admin sessions deleted, got ${n}`);
    const left = await h.sessionCounts!();
    check(left.admin === 0 && left.play === 4, `expected 0 admin and 4 player sessions, got ${JSON.stringify(left)}`);
    check((await h.snapshot()) === before, "the orders, the owned looks or the meta rows changed");
    check((await h.store.signOutEverywhere()) === 0, "a second call deletes nothing and says 0");
    check((await h.sessionCounts!()).play === 4, "the player sessions are still there");
  });

  return cases;
}
