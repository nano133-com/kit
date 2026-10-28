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

/**
 * The kinds of visitor the game must be able to make:
 *  - signed_out       no cookie at all
 *  - game_login       a valid login made for the game's PLAYERS (the owner's own address, even): it is not an admin login
 *  - nanoterra_login  an admin-scope login whose `via` is not "wallet" (a sign-in from Nanoterra), for the owner's address
 *  - other_wallet     a wallet login for an address that is not the owner's
 *  - no_address       a wallet login while the game has NO owner address set (the game runs with none)
 *  - expired_login    a wallet login of the owner's, made more than one day ago
 *  - owner            a wallet login of the owner's, made just now
 */
export type Who = "signed_out" | "game_login" | "nanoterra_login" | "other_wallet" | "no_address" | "expired_login" | "owner";

export type ConformanceRequest = { method: string; path: string; headers?: Record<string, string>; body?: string };

export type ConformanceHost = {
  /** The handler's `routes`. */
  routes: readonly AdminRoute[];
  /** The handler's `basePath`. */
  basePath: string;
  /** The game's own origin, like "https://game.example": the suite sends it as the Origin of a good POST. */
  origin: string;
  request(who: Who, req: ConformanceRequest): Promise<Response>;
};

export type ConformanceCase = { name: string; run: () => Promise<void> };

const REFUSALS: { who: Who; status: number; reason?: string; words: string }[] = [
  { who: "signed_out", status: 401, words: "a visitor who is signed out" },
  { who: "game_login", status: 401, words: "a login that was made for the game's players" },
  { who: "nanoterra_login", status: 403, reason: "nanoterra", words: "a Nanoterra sign-in (it names an address but proves no key)" },
  { who: "other_wallet", status: 403, reason: "other_address", words: "a wallet that is not the owner's" },
  { who: "no_address", status: 403, reason: "no_address", words: "anyone, while the game has no owner address" },
  { who: "expired_login", status: 401, words: "an admin login that is more than a day old" },
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

export function adminConformance(host: ConformanceHost): ConformanceCase[] {
  const cases: ConformanceCase[] = [];
  const add = (name: string, run: () => Promise<void>) => cases.push({ name, run });
  const good = (extra: Record<string, string> = {}) => ({ Origin: host.origin, "Content-Type": "application/json", ...extra });
  const body = (r: AdminRoute) => (r.method === "POST" ? "{}" : undefined);

  check(host.routes.length > 0, "the host lists no routes");

  for (const r of REFUSALS) {
    add(`every route refuses ${r.words} (${r.status}${r.reason ? `, ${r.reason}` : ""}) and gives it no data`, async () => {
      for (const route of host.routes) {
        const got = await read(await host.request(r.who, { method: route.method, path: route.path, headers: good(), body: body(route) }));
        const here = `${route.method} ${route.path} as ${r.who}`;
        check(got.status === r.status, `${here}: expected ${r.status}, got ${got.status}`);
        if (r.reason) check(got.json?.reason === r.reason, `${here}: expected reason "${r.reason}", got ${JSON.stringify(got.json?.reason)}`);
        check(got.json !== null && Object.keys(got.json).every((k) => REFUSAL_KEYS.has(k)), `${here}: a refusal must carry only error, reason and signedInAs, got ${got.text.slice(0, 120)}`);
      }
    });
  }

  add("an unknown path under the base is refused like any admin path (so the routes are not leaked): the same refusal for a visitor, 404 for the owner", async () => {
    const path = `${host.basePath}/no-such-page`;
    for (const r of REFUSALS) {
      const got = await read(await host.request(r.who, { method: "GET", path }));
      check(got.status === r.status, `GET ${path} as ${r.who}: expected ${r.status}, got ${got.status}`);
    }
    const owner = await read(await host.request("owner", { method: "GET", path }));
    check(owner.status === 404, `GET ${path} as owner: expected 404, got ${owner.status}`);
  });

  add("other spellings of an admin path never open anything for a visitor (other case, a slash, a doubled slash, a percent code, a dot segment)", async () => {
    const real = host.routes.find((r) => r.method === "GET")!.path;
    const last = real.slice(real.lastIndexOf("/") + 1);
    const tricks = [
      real.toUpperCase(),
      `${real}/`,
      real.replace(`/${last}`, `//${last}`),
      real.slice(0, -1) + `%${last.charCodeAt(last.length - 1).toString(16)}`,
      real.replace(`/${last}`, `/x/../${last}`),
      `${host.basePath}%2f${last}`,
      `${host.basePath}\\${last}`,
    ];
    for (const path of tricks) {
      for (const who of ["signed_out", "game_login", "nanoterra_login", "other_wallet", "expired_login"] as const) {
        const got = await read(await host.request(who, { method: "GET", path }));
        check([401, 403, 404].includes(got.status), `GET ${path} as ${who}: expected 401, 403 or 404, got ${got.status}`);
        check(!/"orders"|"players"|"totals"|"counts"|"character"/.test(got.text), `GET ${path} as ${who}: the answer holds the game's data`);
      }
    }
  });

  add("the owner gets through the guard on every route", async () => {
    for (const route of host.routes) {
      const res = await host.request("owner", { method: route.method, path: route.path, headers: good(), body: body(route) });
      const got = await read(res);
      check(![401, 403, 404, 405].includes(got.status) && got.status < 500, `${route.method} ${route.path} as owner: the guard let the owner through, but the status was ${got.status}`);
    }
  });

  add("a POST from another site is refused (403), even with the owner's cookie", async () => {
    for (const route of host.routes.filter((r) => r.method === "POST")) {
      const other = await read(await host.request("owner", { method: "POST", path: route.path, headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" }));
      check(other.status === 403, `POST ${route.path} with another Origin: expected 403, got ${other.status}`);
      const fetchSite = await read(await host.request("owner", { method: "POST", path: route.path, headers: { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, body: "{}" }));
      check(fetchSite.status === 403, `POST ${route.path} with no Origin and Sec-Fetch-Site cross-site: expected 403, got ${fetchSite.status}`);
      const none = await read(await host.request("owner", { method: "POST", path: route.path, headers: { "Content-Type": "application/json" }, body: "{}" }));
      check(none.status === 403, `POST ${route.path} with neither Origin nor Sec-Fetch-Site: expected 403, got ${none.status}`);
    }
  });

  add("a method that a route does not have is refused: the guard's answer for a visitor, 405 for the owner", async () => {
    for (const route of host.routes) {
      const owner = await read(await host.request("owner", { method: "DELETE", path: route.path, headers: good() }));
      check(owner.status === 405, `DELETE ${route.path} as owner: expected 405, got ${owner.status}`);
      const visitor = await read(await host.request("signed_out", { method: "DELETE", path: route.path, headers: good() }));
      check(visitor.status === 401, `DELETE ${route.path} signed out: expected 401, got ${visitor.status}`);
    }
  });

  add("a body that is far too big is refused and changes nothing", async () => {
    const big = JSON.stringify({ character: "own", pad: "x".repeat(100_000) });
    for (const route of host.routes.filter((r) => r.method === "POST" && r.path.endsWith("/game"))) {
      const got = await read(await host.request("owner", { method: "POST", path: route.path, headers: good(), body: big }));
      check(got.status === 413 || got.status === 400, `POST ${route.path} with 100 KB: expected 413 or 400, got ${got.status}`);
    }
  });

  add("every answer is no-store and carries no CORS header", async () => {
    for (const who of ["signed_out", "owner"] as const) {
      for (const route of host.routes.filter((r) => r.method === "GET")) {
        const res = await host.request(who, { method: "GET", path: route.path });
        await res.text();
        check((res.headers.get("cache-control") ?? "").includes("no-store"), `GET ${route.path} as ${who}: the answer is not "Cache-Control: no-store"`);
        let cors = false;
        res.headers.forEach((_, k) => {
          if (k.toLowerCase().startsWith("access-control-")) cors = true;
        });
        check(!cors, `GET ${route.path} as ${who}: the answer has a CORS header`);
      }
    }
  });

  return cases;
}
