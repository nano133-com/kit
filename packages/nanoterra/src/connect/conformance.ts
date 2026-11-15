// The conformance suite of Sign in from Nanoterra: each rule of nano133.com's protocol (docs/agents/launch.md, "Signed-in Play", "The arrival field")
// and of its Launch checker (the "callback" check and its press probe, `pressProblem`), run against a game's MOUNTED routes. A game runs it against its
// own server (a Worker's fetch, React Router's handlers, an Express app through `webRequest`), with nano133.com's token route replaced by the suite's
// stand-in: no request leaves the computer, and the client id and secret are the suite's own test values.
//
//   import { connectConformance } from "@nano133/nanoterra/connect/conformance";
//   for (const c of connectConformance(async (token) => myHarness({ fetch: token }))) it(`${c.rule} ${c.name}`, c.run);
//
// `make(token)` builds the game's routes for ONE case, with `token` as the connect's `fetch` (so the token call reaches the stand-in) and the harness's
// client id and secret. Each case uses its own visitor address (CF-Connecting-IP and X-Forwarded-For), so the routes' limits do not mix the cases.
// A case throws an Error that names the rule and what was wrong; it never prints a code, a state, a cookie or the secret.

import { blake2bShort } from "../shop/address.js";

// The protocol's addresses, written here and NOT imported from the core: the suite checks the core against nano133.com's own values
// (launch.md, "The state flow" and "The exchange"; nano133.com's app/nanoterra/signin/callback.ts: AUTHORIZE_PATH, SITE_ORIGIN, startUrl, callbackUrl).
const NANOTERRA_SITE = "https://nano133.com";
const AUTHORIZE_PATH = "/api/nanoterra/authorize";
const TOKEN_PATH = "/api/nanoterra/token";
const CONNECT_PATHS = { start: "/nanoterra/start", callback: "/nanoterra/callback", confirm: "/nanoterra/confirm", cancel: "/nanoterra/cancel" } as const;

export type ConnectHarness = {
  /** The game's routes as mounted: one request in, one answer out (redirects are not followed). */
  handle(req: Request): Promise<Response>;
  /** The client id and the secret the routes were made with: test values only, never the game's real secret. */
  clientId: string;
  secret: string;
  /** The address (or account) that this Cookie header is signed in as at the game, read with the game's own session reader; null for none. */
  signedIn(cookie: string): Promise<string | null>;
  /** A "name=value" session cookie of the game for this address (the press's "same account" and "Switch" rules). Without it those cases are skipped. */
  sessionFor?(address: string): Promise<string>;
  /** Where the routes answer. Default "https://game.test": the live rules (`__Host-` cookies). */
  origin?: string;
  /** The game's `after` path. Default "/". */
  after?: string;
  /** false for a game that counts its routes in its own way (then the suite does not check 20 a minute). */
  limits?: boolean;
};

export type ConnectConformanceCase = { rule: string; name: string; run: () => Promise<void> };

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

// ---- Addresses, secrets, answers and the token route's stand-in ----

/**
 * A client secret of nano133.com's shape ("ns_" and 43 base64url characters), random at each call, for a game's tests and its harness: the kit refuses
 * a short or made-up secret (`strongSecret`). It is a test value: never the game's real secret, and nobody else knows it.
 */
export function connectTestSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `ns_${btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";
const b32 = (n: bigint, chars: number) => Array.from({ length: chars }, (_, i) => ALPHABET[Number((n >> BigInt(5 * (chars - 1 - i))) & 31n)]).join("");
/** A whole Nano address (right checksum) for a random key. Nobody holds the key: never send money to it. */
export function connectTestAddress(): string {
  const key = crypto.getRandomValues(new Uint8Array(32));
  const n = key.reduce((a, b) => (a << 8n) | BigInt(b), 0n);
  const sum = blake2bShort(key, 5).reverse().reduce((a, b) => (a << 8n) | BigInt(b), 0n);
  return `nano_${b32(n, 52)}${b32(sum, 8)}`;
}

const LOOK = { skin: "#f2c29b", hair: "#3a2a1e", shirt: "#2a9df4", pants: "#1e2a4a", shoes: "#ffffff" };
/** A token answer as nano133.com gives it. */
export const tokenAnswer = (address: string, over: Record<string, unknown> = {}) => ({ username: "Ann", address, playerId: address, character: { v: 1, look: LOOK, items: ["hub.sun-hat"] }, ...over });

type Call = { url: string; init: RequestInit };
type Next = { status: number; body: string } | "fault";
/** The stand-in for nano133.com's token route: it answers what the case sets, and keeps every call. */
function standIn() {
  const calls: Call[] = [];
  let next: Next = { status: 400, body: '{"error":"invalid"}' };
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init: init ?? {} });
    if (next === "fault") throw new TypeError("network");
    return new Response(next.body, { status: next.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return {
    calls,
    fetch: fetcher,
    answer(v: unknown, status = 200) {
      next = { status, body: typeof v === "string" ? v : JSON.stringify(v) };
    },
    fault() {
      next = "fault";
    },
  };
}

// ---- A browser: a cookie jar and the requests it makes ----

let visitors = 0;
/** A new visitor address for each browser (198.18.0.0/15, the benchmark range). */
const nextVisitor = () => {
  visitors += 1;
  return `198.18.${(visitors >> 8) & 255}.${visitors & 255}`;
};

type Cookie = { name: string; value: string; attrs: string[] };
const parseCookie = (c: string): Cookie => {
  const [pair, ...attrs] = c.split(";");
  const i = pair.indexOf("=");
  return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), attrs: attrs.map((a) => a.trim().toLowerCase()) };
};
const maxAgeOf = (c: Cookie) => {
  const a = c.attrs.find((x) => x.startsWith("max-age="));
  return a === undefined ? null : Number(a.slice(8));
};

function browser(h: ConnectHarness) {
  const origin = h.origin ?? "https://game.test";
  const ip = nextVisitor();
  const jar = new Map<string, string>();
  const take = (res: Response) => {
    for (const raw of res.headers.getSetCookie()) {
      const c = parseCookie(raw);
      if (maxAgeOf(c) === 0 || c.value === "") jar.delete(c.name);
      else jar.set(c.name, c.value);
    }
  };
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const send = async (path: string, o: { method?: string; headers?: Record<string, string>; body?: string; cookie?: string | null; keep?: boolean } = {}) => {
    const headers = new Headers({ "CF-Connecting-IP": ip, "X-Forwarded-For": ip, ...o.headers });
    const cookie = o.cookie === undefined ? cookieHeader() : o.cookie;
    if (cookie) headers.set("Cookie", cookie);
    const res = await h.handle(new Request(new URL(path, origin), { method: o.method ?? "GET", headers, body: o.body }));
    if (o.keep !== false) take(res);
    return res;
  };
  /** A press of a screen's form, as the browser sends it from the game's own page. */
  const press = (what: "confirm" | "cancel", bind: string | undefined, o: { headers?: Record<string, string>; cookie?: string | null } = {}) =>
    send(what === "confirm" ? CONNECT_PATHS.confirm : CONNECT_PATHS.cancel, {
      method: "POST",
      headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded", ...o.headers },
      body: bind === undefined ? "" : new URLSearchParams({ bind }).toString(),
      cookie: o.cookie,
    });
  const start = async () => {
    const res = await send(CONNECT_PATHS.start);
    let state = "";
    try {
      state = new URL(res.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    } catch {
      state = "";
    }
    return { res, state };
  };
  const callback = (code: string, state: string | null, o: { cookie?: string | null } = {}) => send(`${CONNECT_PATHS.callback}?code=${code}${state === null ? "" : `&state=${encodeURIComponent(state)}`}`, o);
  return { origin, jar, send, press, start, callback, cookieHeader };
}

const CODE = "A".repeat(43);
const bindIn = (html: string) => /name="bind" value="([0-9a-f]{32})"/.exec(html)?.[1];
const LIVE_COOKIE = (c: Cookie) => c.name.startsWith("__Host-") && c.attrs.includes("secure") && c.attrs.includes("httponly") && c.attrs.includes("path=/") && c.attrs.includes("samesite=lax") && !c.attrs.some((a) => a.startsWith("domain="));
const cookiesOf = (res: Response) => res.headers.getSetCookie().map(parseCookie);
const stateCookieOf = (res: Response) => cookiesOf(res).find((c) => /^(__Host-)?nanoterra-state$/.test(c.name));
const pendingCookieOf = (res: Response) => cookiesOf(res).find((c) => /^(__Host-)?nanoterra-pending$/.test(c.name));
/** The cookies an answer sets that are NOT this flow's own (the game's session, for example). */
const otherCookies = (res: Response) => cookiesOf(res).filter((c) => !/^(__Host-)?nanoterra-(state|pending)$/.test(c.name));

/** Every console line written while `fn` runs (the suite checks that none holds a secret, a code, a state or a cookie). */
async function capture<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string }> {
  const kinds = ["log", "info", "warn", "error", "debug"] as const;
  const saved = kinds.map((k) => console[k]);
  const lines: string[] = [];
  for (const k of kinds) console[k] = (...a: unknown[]) => void lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x) ?? String(x))).join(" "));
  try {
    return { value: await fn(), lines: lines.join("\n") };
  } finally {
    kinds.forEach((k, i) => (console[k] = saved[i]));
  }
}

/**
 * The suite. Rule ids: S = the start route, C = the callback, P = the press and the screens, F = Continue (confirm), N = Not me (cancel),
 * R = where the player goes, L = the limits. Each case's name says the rule in a line; launch.md's and the checker's words are in the README.
 */
export function connectConformance(make: (token: typeof fetch) => Promise<ConnectHarness>): ConnectConformanceCase[] {
  const cases: ConnectConformanceCase[] = [];
  type Ctx = { h: ConnectHarness; t: ReturnType<typeof standIn> };
  const add = (rule: string, name: string, run: (c: Ctx) => Promise<void>) =>
    cases.push({
      rule,
      name,
      run: async () => {
        const t = standIn();
        const h = await make(t.fetch);
        try {
          await run({ h, t });
        } catch (e) {
          throw new Error(`${rule} ${name}: ${e instanceof Error ? e.message : "failed"}`);
        }
      },
    });
  /** A callback with a token answer of this player: the browser started, nano133.com answered with this code and the same state. */
  const arrive = async ({ h, t }: Ctx, answer: unknown, b = browser(h)) => {
    t.answer(answer);
    const { state } = await b.start();
    const res = await b.callback(CODE, state);
    return { b, res, state };
  };
  const after = (h: ConnectHarness) => h.after ?? "/";

  // ---- S: the start route ----

  add("S1", "start redirects (302, 303 or 307) to nano133.com's authorize route with exactly the client id and the state", async ({ h }) => {
    const { res } = await browser(h).start();
    check([302, 303, 307].includes(res.status), `the start answered ${res.status}, not a redirect`);
    const to = new URL(res.headers.get("Location") ?? "about:blank");
    check(`${to.origin}${to.pathname}` === `${NANOTERRA_SITE}${AUTHORIZE_PATH}`, "the redirect goes to another place");
    check(to.searchParams.get("client_id") === h.clientId, "the redirect has another client id");
    check([...to.searchParams.keys()].sort().join() === "client_id,state", "the redirect has other parameters");
  });

  add("S2", "the state has 128 random bits or more: 16 to 128 letters, digits, - or _, at least 22 characters (32 when hex only)", async ({ h }) => {
    const { state } = await browser(h).start();
    check(/^[A-Za-z0-9_-]{16,128}$/.test(state), "the state is not 16 to 128 letters, digits, - or _");
    check(state.length >= 22 && !(/^[0-9a-f]+$/i.test(state) && state.length < 32), "the state is too short for 128 random bits");
  });

  add("S3", "each start makes a new state", async ({ h }) => {
    const b = browser(h);
    const seen = new Set<string>();
    for (let i = 0; i < 5; i++) seen.add((await b.start()).state);
    check(seen.size === 5, "two starts gave the same state");
  });

  add("S4", "the state cookie: a __Host- name, Secure, HttpOnly, Path=/, SameSite=Lax, no Domain, at most 10 minutes, and its value is the state", async ({ h }) => {
    const { res, state } = await browser(h).start();
    const c = stateCookieOf(res);
    check(c, "the start sets no state cookie");
    if ((h.origin ?? "https://game.test").startsWith("https:")) check(LIVE_COOKIE(c), "the state cookie lacks __Host-, Secure, HttpOnly, Path=/ or SameSite=Lax, or has a Domain");
    const age = maxAgeOf(c);
    check(age !== null && age > 0 && age <= 600, "the state cookie lives longer than 10 minutes, or has no Max-Age");
    check(decodeURIComponent(c.value) === state, "the cookie does not hold the state of the redirect");
  });

  add("S5", "start takes GET only, is never cached, sends no Referer, and never shows the secret", async ({ h }) => {
    const b = browser(h);
    const post = await b.send(CONNECT_PATHS.start, { method: "POST", headers: { Origin: b.origin } });
    check(post.status === 405, `a POST to start answered ${post.status}`);
    const { res } = await b.start();
    check(/no-store/.test(res.headers.get("Cache-Control") ?? ""), "the start can be cached");
    check(res.headers.get("Referrer-Policy") === "no-referrer", "the start sends a Referer");
    check(!`${res.headers.get("Location")}${res.headers.getSetCookie().join()}`.includes(h.secret), "the start shows the secret");
  });

  // ---- C: the callback ----

  add("C1", "a code that is not one (the checker's 43 A's, no state) is refused with 400, 401, 403 or 422, and nothing is traded", async ({ h, t }) => {
    const res = await browser(h).callback(CODE, null);
    check([400, 401, 403, 422].includes(res.status), `the callback answered ${res.status}`);
    check(t.calls.length === 0, "the callback traded a code with no state");
  });

  add("C2", "a missing code or one of the wrong shape: 400, and nothing is traded", async ({ h, t }) => {
    const b = browser(h);
    const { state } = await b.start();
    for (const code of ["", "short", "A".repeat(42), "A".repeat(44), `${"A".repeat(42)}!`, "..%2F..%2Fx"]) {
      const res = await b.callback(code, state, { cookie: `__Host-nanoterra-state=${state}; nanoterra-state=${state}` });
      check(res.status === 400, `a code of the wrong shape got ${res.status}`);
    }
    check(t.calls.length === 0, "a code of the wrong shape was traded");
  });

  add("C3", "the link's state must equal THIS browser's state cookie, read by its __Host- name only: else 400 and nothing is traded (login CSRF)", async ({ h, t }) => {
    // A press answer: even a press signs nobody in without this browser's state.
    t.answer(tokenAnswer(connectTestAddress(), { arrival: "press" }));
    const live = (h.origin ?? "https://game.test").startsWith("https:");
    const name = live ? "__Host-nanoterra-state" : "nanoterra-state";
    const a = "a".repeat(32);
    const cases: [string, string | null, string | null][] = [
      ["no state in the link", null, `${name}=${a}`],
      ["no state cookie (the attacker's link in a victim's browser)", a, null],
      ["another state in the cookie", a, `${name}=${"b".repeat(32)}`],
      ["a state of the wrong shape", "short", `${name}=short`],
      ["a state cookie of the wrong shape", a, `${name}=${"x".repeat(200)}`],
      ["an empty state", "", `${name}=`],
      ["a state that differs in its last character", `${"c".repeat(31)}d`, `${name}=${"c".repeat(32)}`],
    ];
    if (live) cases.push(["the plain name (planted by a sibling subdomain)", a, `nanoterra-state=${a}`], ["the __Host- name holds another state, the plain name this one", a, `__Host-nanoterra-state=${"f".repeat(32)}; nanoterra-state=${a}`]);
    // Names that a sibling subdomain CAN set and that are not this name: a reader that compares with JS trim() (it drops U+00A0) or without case
    // would take them (Sunk Cost's AGENTS.md: "never go back to trim()"). A browser drops only spaces and tabs around a name, never U+00A0.
    const nbsp = "\u00a0";
    cases.push(
      ["a no-break space before the name", a, `${nbsp}${name}=${a}`],
      ["a no-break space after the name", a, `${name}${nbsp}=${a}`],
      ["the name in lower case", a, `${name.toLowerCase()}=${a}`],
      ["the name in upper case", a, `${name.toUpperCase()}=${a}`],
      ["a no-break space before the name in lower case", a, `${nbsp}${name.toLowerCase()}=${a}`],
    );
    for (const [why, state, cookie] of cases) {
      const res = await browser(h).callback(CODE, state, { cookie });
      check(res.status === 400, `${why}: the callback answered ${res.status}`);
      check(otherCookies(res).length === 0 && !pendingCookieOf(res), `${why}: the callback set a session or a pending cookie`);
    }
    check(t.calls.length === 0, "a code was traded without this browser's state");
  });

  add("C4", "the token call: one POST of JSON {client_id, client_secret, code, state from the cookie} to nano133.com's token route, no redirect followed", async (c) => {
    const address = connectTestAddress();
    const { state } = await arrive(c, tokenAnswer(address));
    check(c.t.calls.length === 1, `the callback made ${c.t.calls.length} token calls`);
    const call = c.t.calls[0];
    check(call.url === `${NANOTERRA_SITE}${TOKEN_PATH}`, "the token call went to another address");
    check((call.init.method ?? "GET").toUpperCase() === "POST", "the token call is not a POST");
    check(call.init.redirect === "manual", "the token call follows redirects");
    const sent = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    check(Object.keys(sent).sort().join() === "client_id,client_secret,code,state", "the token call sends other fields");
    check(sent.client_id === c.h.clientId && sent.client_secret === c.h.secret && sent.code === CODE && sent.state === state, "the token call sends another client id, secret, code or state");
    check(new Headers(call.init.headers).get("Content-Type")?.startsWith("application/json"), "the token call is not JSON");
  });

  add("C5", "the state works once: every answer after the compare drops the cookie, and the same link again trades nothing", async (c) => {
    const { b, res, state } = await arrive(c, tokenAnswer(connectTestAddress()));
    check(res.status === 200, `the callback answered ${res.status}`);
    const dropped = stateCookieOf(res);
    check(dropped && maxAgeOf(dropped) === 0, "the confirm screen keeps the state cookie");
    const again = await b.callback(CODE, state);
    check(again.status === 400 && c.t.calls.length === 1, "the same link worked twice");
    // A refused exchange drops it too.
    c.t.answer({ error: "invalid" }, 400);
    const b2 = browser(c.h);
    const s2 = (await b2.start()).state;
    const refused = await b2.callback(CODE, s2);
    const d2 = stateCookieOf(refused);
    check(refused.status === 400 && d2 && maxAgeOf(d2) === 0, "a refused exchange keeps the state cookie");
  });

  add("C6", "a refusal, a fault or an answer of the wrong shape signs nobody in: 400 and no session", async (c) => {
    const good = connectTestAddress();
    const other = connectTestAddress();
    const look = tokenAnswer(good).character.look;
    const bad: [string, () => void][] = [
      ["a 400", () => c.t.answer({ error: "invalid" }, 400)],
      ["a refusal status that carries a player", () => c.t.answer(tokenAnswer(good, { arrival: "press" }), 400)],
      ["a 201 that carries a player", () => c.t.answer(tokenAnswer(good, { arrival: "press" }), 201)],
      ["a 500", () => c.t.answer("boom", 500)],
      ["a redirect", () => c.t.answer("", 302)],
      ["not JSON", () => c.t.answer("<html>")],
      ["a network fault", () => c.t.fault()],
      ["an answer over 32 KB", () => c.t.answer({ ...tokenAnswer(good), pad: "x".repeat(40_000) })],
      ["a bad address", () => c.t.answer(tokenAnswer("nano_notanaddress"))],
      ["an xrb_ address", () => c.t.answer(tokenAnswer(good.replace(/^nano_/, "xrb_")))],
      ["an address with a bad checksum (one character changed)", () => {
        const bent = `${good.slice(0, -1)}${good.endsWith("1") ? "3" : "1"}`;
        c.t.answer(tokenAnswer(bent));
      }],
      ["a playerId that is not the address", () => c.t.answer(tokenAnswer(good, { playerId: other }))],
      ["an empty name", () => c.t.answer(tokenAnswer(good, { username: "  " }))],
      ["a name over 60 characters", () => c.t.answer(tokenAnswer(good, { username: "x".repeat(61) }))],
      ["a name with a direction character", () => c.t.answer(tokenAnswer(good, { username: "Ann‮evil" }))],
      ["a character of version 2", () => c.t.answer(tokenAnswer(good, { character: { v: 2, look, items: [] } }))],
      ["a colour that is not hex", () => c.t.answer(tokenAnswer(good, { character: { v: 1, look: { ...look, shirt: "red" }, items: [] } }))],
      ["a missing look part", () => c.t.answer(tokenAnswer(good, { character: { v: 1, look: { skin: look.skin }, items: [] } }))],
    ];
    for (const [why, set] of bad) {
      set();
      const b = browser(c.h);
      const { state } = await b.start();
      const res = await b.callback(CODE, state);
      check(res.status === 400, `${why}: the callback answered ${res.status}`);
      check(otherCookies(res).length === 0 && !pendingCookieOf(res), `${why}: the callback set a session or a pending cookie`);
      check((await c.h.signedIn(b.cookieHeader())) === null, `${why}: the browser is signed in`);
    }
  });

  add("C7", "the secret, the code, the state and the cookies are in no page, no header but their own and no log line", async (c) => {
    const { value, lines } = await capture(async () => {
      const out: { res: Response; state: string; html: string }[] = [];
      for (const answer of [() => c.t.answer({ error: "invalid" }, 400), () => c.t.fault(), () => c.t.answer(tokenAnswer(connectTestAddress()))]) {
        answer();
        const b = browser(c.h);
        const { res: started, state } = await b.start();
        const res = await b.callback(CODE, state);
        out.push({ res: started, state, html: "" }, { res, state, html: await res.text() });
      }
      return out;
    });
    for (const { res, state, html } of value) {
      const heads: string[] = [];
      res.headers.forEach((v, k) => {
        if (k !== "set-cookie" && k !== "location") heads.push(v);
      });
      const sets = res.headers.getSetCookie().join("\n");
      for (const [what, v] of [["the secret", c.h.secret], ["the code", CODE], ["the state", state]] as const) {
        check(!html.includes(v), `the page shows ${what}`);
        check(!heads.join("\n").includes(v), `a header shows ${what}`);
        check(!lines.includes(v), `a log line shows ${what}`);
      }
      check(!sets.includes(c.h.secret) && !sets.includes(CODE), "a cookie holds the secret or the code");
      const pending = pendingCookieOf(res);
      if (pending) {
        check(!html.includes(pending.value), "the page shows the pending cookie");
        check(!lines.includes(pending.value), "a log line shows the pending cookie");
      }
    }
  });

  // ---- P: the press and the screens ----

  add("P1", 'with no `arrival` field, or one that is not exactly "press": the "Sign in as <name>?" screen, and no session', async (c) => {
    for (const v of [undefined, "Press", "press ", " press", "PRESS", true, 1, ["press"], { press: true }, null, ""]) {
      const address = connectTestAddress();
      const { b, res } = await arrive(c, tokenAnswer(address, v === undefined ? {} : { arrival: v }));
      const html = await res.text();
      check(res.status === 200 && bindIn(html), `arrival ${JSON.stringify(v) ?? "absent"}: no confirm screen`);
      check(otherCookies(res).length === 0, `arrival ${JSON.stringify(v) ?? "absent"}: a session cookie`);
      check((await c.h.signedIn(b.cookieHeader())) === null, `arrival ${JSON.stringify(v) ?? "absent"}: signed in with no press`);
    }
  });

  add("P2", "the confirm screen: the pending cookie (__Host-, Secure, HttpOnly, SameSite=Lax, 5 minutes), never cached or framed, the name escaped, a bind that is a hash", async (c) => {
    const address = connectTestAddress();
    const name = `<img src=x onerror=alert(1)> & "q" 'a'`;
    const { res } = await arrive(c, tokenAnswer(address, { username: name }));
    const html = await res.text();
    const pending = pendingCookieOf(res);
    check(pending, "no pending cookie");
    if ((c.h.origin ?? "https://game.test").startsWith("https:")) check(LIVE_COOKIE(pending), "the pending cookie lacks __Host-, Secure, HttpOnly, Path=/ or SameSite=Lax, or has a Domain");
    const age = maxAgeOf(pending);
    check(age !== null && age > 0 && age <= 300, "the pending cookie lives longer than 5 minutes");
    check(/no-store/.test(res.headers.get("Cache-Control") ?? ""), "the screen can be cached");
    check(res.headers.get("Referrer-Policy") === "same-origin", "the screen's Referrer-Policy is not same-origin (no-referrer makes the press send Origin: null)");
    const framed = /frame-ancestors 'none'/.test(res.headers.get("Content-Security-Policy") ?? "") || res.headers.get("X-Frame-Options") === "DENY";
    check(framed, "another site may put the screen in a frame");
    check(!html.includes("<img"), "the name is not escaped");
    check(!html.includes(address), "the screen shows the whole address");
    const bind = bindIn(html);
    check(bind && !html.includes(decodeURIComponent(pending.value)), "the screen holds no bind, or holds the pending token");
  });

  add("P3", "a press with no session here: the session at once, to the game, with no screen and no pending cookie", async (c) => {
    const address = connectTestAddress();
    const { b, res } = await arrive(c, tokenAnswer(address, { arrival: "press" }));
    check(res.status === 303 || res.status === 302, `a press answered ${res.status}`);
    check(res.headers.get("Location") === after(c.h), "a press went somewhere else");
    check(!pendingCookieOf(res), "a press set a pending cookie");
    const dropped = stateCookieOf(res);
    check(dropped && maxAgeOf(dropped) === 0, "a press kept the state cookie");
    check((await c.h.signedIn(b.cookieHeader())) === address, "a press did not sign in the address Nanoterra named");
  });

  add("P4", "a press with a session for the SAME account: the session stays, no new one, and the game", async (c) => {
    if (!c.h.sessionFor) return;
    const address = connectTestAddress();
    const b = browser(c.h);
    const mine = await c.h.sessionFor(address);
    const [k, ...v] = mine.split("=");
    b.jar.set(k, v.join("="));
    const { res } = await arrive(c, tokenAnswer(address, { arrival: "press" }), b);
    check(res.status === 303 || res.status === 302, `a press answered ${res.status}`);
    check(otherCookies(res).length === 0, "a press replaced the session of the same account");
    check((await c.h.signedIn(b.cookieHeader())) === address, "the session of the same account is gone");
  });

  add("P5", 'a press with a session for ANOTHER account: "Switch to <name>?" with no session until a press; Stay keeps it, Switch changes it', async (c) => {
    if (!c.h.sessionFor) return;
    const bob = connectTestAddress();
    const ann = connectTestAddress();
    const b = browser(c.h);
    const mine = await c.h.sessionFor(bob);
    const [k, ...v] = mine.split("=");
    b.jar.set(k, v.join("="));
    const first = await arrive(c, tokenAnswer(ann, { arrival: "press" }), b);
    const html = await first.res.text();
    check(first.res.status === 200 && bindIn(html), "no switch screen");
    check(otherCookies(first.res).length === 0, "the switch screen made a session");
    check((await c.h.signedIn(b.cookieHeader())) === bob, "the session here changed before a press");
    const stay = await b.press("cancel", bindIn(html));
    check(stay.status === 303 || stay.status === 302, `Stay answered ${stay.status}`);
    check((await c.h.signedIn(b.cookieHeader())) === bob, "Stay changed the session");
    const second = await arrive(c, tokenAnswer(ann, { arrival: "press" }), b);
    const done = await b.press("confirm", bindIn(await second.res.text()));
    check(done.status === 303 || done.status === 302, `Switch answered ${done.status}`);
    check((await c.h.signedIn(b.cookieHeader())) === ann, "Switch did not sign in the new account");
  });

  // ---- F: Continue (POST /nanoterra/confirm) ----

  /** A browser on the confirm screen: its bind, the pending cookie and the address. */
  const onScreen = async (c: Ctx) => {
    const address = connectTestAddress();
    const { b, res } = await arrive(c, tokenAnswer(address));
    const bind = bindIn(await res.text());
    check(bind, "no confirm screen");
    return { b, bind, address, pending: `${pendingCookieOf(res)?.name}=${pendingCookieOf(res)?.value}` };
  };

  add("F1", "Continue makes the game's session for the address Nanoterra named, drops the pending cookie and goes to the game", async (c) => {
    const { b, bind, address } = await onScreen(c);
    const done = await b.press("confirm", bind);
    check(done.status === 303 || done.status === 302, `Continue answered ${done.status}`);
    check(done.headers.get("Location") === after(c.h), "Continue went somewhere else");
    const p = pendingCookieOf(done);
    check(p && maxAgeOf(p) === 0, "Continue kept the pending cookie");
    check((await c.h.signedIn(b.cookieHeader())) === address, "Continue did not sign in the address Nanoterra named");
  });

  add("F2", "Continue takes POST only, and only from this game's own page (Origin exactly this site's; Sec-Fetch-Site same-origin when sent)", async (c) => {
    const { b, bind, address } = await onScreen(c);
    const get = await b.send(CONNECT_PATHS.confirm, { keep: false });
    check(get.status === 405, `a GET of confirm answered ${get.status}`);
    const others: [string, Record<string, string>][] = [
      ["another site's Origin", { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" }],
      ["Origin null", { Origin: "null", "Sec-Fetch-Site": "same-origin" }],
      ["another site's Origin with no Sec-Fetch-Site", { Origin: "https://evil.test" }],
      ["a sibling subdomain", { Origin: b.origin.replace("://", "://x."), "Sec-Fetch-Site": "same-site" }],
      ["the right Origin and Sec-Fetch-Site cross-site", { Origin: b.origin, "Sec-Fetch-Site": "cross-site" }],
      // An Origin that only STARTS with this site's: a compare by prefix would take it.
      ["an Origin that starts with this site's (another domain)", { Origin: `${b.origin}.evil.test`, "Sec-Fetch-Site": "cross-site" }],
      ["an Origin that starts with this site's, with no Sec-Fetch-Site", { Origin: `${b.origin}.evil.test` }],
      ["this site's Origin with more after it", { Origin: `${b.origin}evil` }],
      ["this site's Origin with a port added", { Origin: `${b.origin}:8443` }],
      // No Origin at all: only Sec-Fetch-Site "same-origin" (a browser that hides its Origin still sends it) may pass; nothing else.
      ["no Origin and no Sec-Fetch-Site", {}],
      ["no Origin and Sec-Fetch-Site same-site", { "Sec-Fetch-Site": "same-site" }],
      ["no Origin and Sec-Fetch-Site cross-site", { "Sec-Fetch-Site": "cross-site" }],
      ["no Origin and Sec-Fetch-Site none", { "Sec-Fetch-Site": "none" }],
    ];
    for (const [why, headers] of others) {
      const res = await b.send(CONNECT_PATHS.confirm, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: `bind=${bind}`, keep: false });
      check(res.status === 403, `${why}: confirm answered ${res.status}`);
    }
    check((await c.h.signedIn(b.cookieHeader())) === null, "a press from another page signed in");
    // The screen still works for the player's own press.
    check((await b.press("confirm", bind)).status === 303 && (await c.h.signedIn(b.cookieHeader())) === address, "the player's own press failed after the refusals");
  });

  add("F3", "Continue needs the pending cookie of THIS browser, whole and signed with the game's key: else 400 and no session", async (c) => {
    const { b, bind, pending } = await onScreen(c);
    const [name, value] = [pending.slice(0, pending.indexOf("=")), pending.slice(pending.indexOf("=") + 1)];
    const [payload, sig] = value.split(".");
    const flip = (s: string) => `${s.slice(0, -2)}${s.endsWith("AA") ? "BB" : "AA"}`;
    const bad: [string, string | null][] = [
      ["no cookie", null],
      ["a changed payload", `${name}=${flip(payload)}.${sig}`],
      ["a changed signature", `${name}=${payload}.${flip(sig)}`],
      ["no signature", `${name}=${payload}`],
      ["three parts", `${name}=${value}.x`],
      ["not base64", `${name}=!!!.???`],
      ["too long", `${name}=${payload}.${"A".repeat(1100)}`],
    ];
    if (name.startsWith("__Host-")) bad.push(["the plain name", `${name.slice(7)}=${value}`]);
    // Names a sibling subdomain can set that are not this name (a reader with trim() or without case would take them).
    bad.push(["a no-break space before the name", `\u00a0${name}=${value}`], ["the name in lower case", `${name.toLowerCase()}=${value}`]);
    // A cookie made by someone else: a whole payload for another address, a deadline far ahead, and a signature that is not the game's.
    const b64 = (v: string) => btoa(v).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const forged = b64(JSON.stringify({ a: connectTestAddress(), n: "Mallory", l: tokenAnswer("x").character.look, r: null, exp: Date.now() + 3_600_000, j: "0".repeat(24) }));
    bad.push(["a payload of someone else's making", `${name}=${forged}.${sig}`], ["a payload of someone else's making with no valid signature", `${name}=${forged}.${"A".repeat(43)}`]);
    // Each press carries the bind of the cookie it sends (anyone can make it: it is a hash of the cookie), so only the cookie's own checks can refuse it.
    const bindFor = async (cookie: string | null) => {
      const v = cookie ? cookie.slice(cookie.indexOf("=") + 1) : "";
      const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)));
      return Array.from(d, (x) => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
    };
    check((await bindFor(pending)) === bind, "the screen's bind is not the hash of its cookie");
    for (const [why, cookie] of bad) {
      const res = await b.press("confirm", await bindFor(cookie), { cookie });
      check(res.status === 400, `${why}: confirm answered ${res.status}`);
      check(otherCookies(res).length === 0, `${why}: confirm set a session`);
    }
  });

  add("F4", "a press is tied to its screen: after a second callback in the same browser, the first screen's Continue, a missing or a wrong bind sign nobody in", async (c) => {
    const victim = await onScreen(c);
    const attacker = connectTestAddress();
    c.t.answer(tokenAnswer(attacker, { username: "Mallory" }));
    const { state } = await victim.b.start();
    const second = await victim.b.callback(CODE, state);
    const secondBind = bindIn(await second.text());
    const replaced = victim.b.cookieHeader();
    for (const [why, bind] of [["the first screen's bind", victim.bind], ["no bind", undefined], ["a wrong bind", "0".repeat(32)]] as const) {
      const res = await victim.b.press("confirm", bind, { cookie: replaced });
      check(res.status === 400, `${why}: confirm answered ${res.status}`);
      check(otherCookies(res).length === 0, `${why}: confirm set a session`);
    }
    check(secondBind, "no second screen");
  });

  add("F5", "a pending cookie works once: a second Continue, or Continue after Not me, signs nobody in", async (c) => {
    const one = await onScreen(c);
    const kept = one.b.cookieHeader();
    check((await one.b.press("confirm", one.bind)).status === 303, "the first Continue failed");
    const again = await one.b.press("confirm", one.bind, { cookie: kept });
    check(again.status === 400 && otherCookies(again).length === 0, "a second Continue with a kept copy of the cookie worked");
    const two = await onScreen(c);
    const kept2 = two.b.cookieHeader();
    check((await two.b.press("cancel", two.bind)).status === 303, "Not me failed");
    const after2 = await two.b.press("confirm", two.bind, { cookie: kept2 });
    check(after2.status === 400 && otherCookies(after2).length === 0, "Continue worked after Not me");
    check((await c.h.signedIn(kept2)) === null, "Not me signed in");
  });

  // ---- N: Not me (POST /nanoterra/cancel) ----

  add("N1", "Not me takes POST from this game's own page only, makes no session, drops the pending cookie and goes to the game", async (c) => {
    const { b, bind, address } = await onScreen(c);
    check((await b.send(CONNECT_PATHS.cancel, { keep: false })).status === 405, "a GET of cancel worked");
    const cross = await b.send(CONNECT_PATHS.cancel, { method: "POST", headers: { Origin: "https://evil.test", "Sec-Fetch-Site": "cross-site" }, keep: false });
    check(cross.status === 403, `Not me from another site answered ${cross.status}`);
    const prefix = await b.send(CONNECT_PATHS.cancel, { method: "POST", headers: { Origin: `${b.origin}.evil.test` }, keep: false });
    check(prefix.status === 403, `Not me from an Origin that starts with this site's answered ${prefix.status}`);
    const bare = await b.send(CONNECT_PATHS.cancel, { method: "POST", keep: false });
    check(bare.status === 403, `Not me with no Origin and no Sec-Fetch-Site answered ${bare.status}`);
    // The refused presses spent nothing: the player's own Continue on this screen still signs in (the origin is checked BEFORE the cookie is used).
    const own = await b.press("confirm", bind);
    check(own.status === 303 || own.status === 302, `Continue after a refused Not me answered ${own.status}: a refused Not me used the cookie up`);
    check((await c.h.signedIn(b.cookieHeader())) === address, "Continue after a refused Not me made no session: a refused Not me used the cookie up");
    const { b: b2, bind: bind2 } = await onScreen(c);
    const res = await b2.press("cancel", bind2);
    check(res.status === 303 || res.status === 302, `Not me answered ${res.status}`);
    check(res.headers.get("Location") === after(c.h), "Not me went somewhere else");
    const p = pendingCookieOf(res);
    check(p && maxAgeOf(p) === 0, "Not me kept the pending cookie");
    check(otherCookies(res).length === 0 && (await c.h.signedIn(b2.cookieHeader())) === null, "Not me signed in");
  });

  // ---- R: where the player goes ----

  add("R1", "every redirect of the flow but the start goes to a path on this site, never to an address from the request", async (c) => {
    const { b, res } = await arrive(c, tokenAnswer(connectTestAddress(), { arrival: "press" }));
    const locs = [res.headers.get("Location")];
    const evil = await b.send(`${CONNECT_PATHS.callback}?code=${CODE}&state=x&after=https://evil.test&next=//evil.test&redirect=https://evil.test`);
    locs.push(evil.headers.get("Location"));
    const s = await onScreen(c);
    locs.push((await s.b.send(`${CONNECT_PATHS.confirm}?next=//evil.test`, { method: "POST", headers: { Origin: s.b.origin, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/x-www-form-urlencoded" }, body: `bind=${s.bind}&next=https://evil.test` })).headers.get("Location"));
    for (const l of locs) if (l !== null) check(l === after(c.h) && l.startsWith("/") && !l.startsWith("//") && !l.startsWith("/\\"), "a redirect leaves the site or follows the request");
  });

  // ---- L: the limits ----

  add("L1", "start, callback and Continue answer 429 after 20 tries a minute from one visitor", async (c) => {
    if (c.h.limits === false) return;
    for (const [route, send] of [
      ["start", (b: ReturnType<typeof browser>) => b.send(CONNECT_PATHS.start)],
      ["callback", (b: ReturnType<typeof browser>) => b.callback(CODE, null)],
      ["confirm", (b: ReturnType<typeof browser>) => b.press("confirm", "0".repeat(32))],
    ] as const) {
      const b = browser(c.h);
      let last = 0;
      for (let i = 0; i < 22 && last !== 429; i++) last = (await send(b)).status;
      check(last === 429, `${route} has no limit of 20 a minute`);
    }
  });

  return cases;
}

/** The rule ids of the suite, in order (the README's table names each with its source). */
export const CONNECT_RULES = ["S1", "S2", "S3", "S4", "S5", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "P1", "P2", "P3", "P4", "P5", "F1", "F2", "F3", "F4", "F5", "N1", "R1", "L1"] as const;
