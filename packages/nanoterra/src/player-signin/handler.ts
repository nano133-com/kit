// The routes of the PLAYER sign-in, on the Web `Request` and `Response` types (a Worker, Firebase Functions, Node). The same paths and answers as the
// game starter's Worker (its src/worker/signin.ts), so the starter's page keeps working, plus the passkey route:
//
//   POST {base}/start          the browser starts a wallet request: { way, turnstile? } → { way, id, link, walletLink?, code?, expiresAt } and the starter cookie
//   GET  {base}/nano/:id       Berry Wallet reads the request (no cookie, no Origin)
//   POST {base}/nano/:id       Berry Wallet posts its signature: 204 with no body when accepted, 401 and the words when refused
//   POST {base}/nautilus?id=   Nautilus posts its signature: always 200 (Nautilus shows only a 200's words)
//   POST {base}/nanchat        NanChat's relay server posts the signature: always 200 (NanChat shows the words; a refusal starts "NOT signed in")
//   POST {base}/check          the browser asks every 2 seconds: { id, way } → { status: "waiting" | "expired" | "elsewhere" | "used" | "signedin", address? }
//   POST {base}/passkey        the passkey purse's signature: { address, at, signature, turnstile? } → { status: "signedin", address } and the session cookie
//   POST {signOut}             ends this browser's session: { ok: true }
//
// `base` is "/api/signin" and `signOut` "/api/signout" (the starter's). The session cookie is the starter's: `session` (`__Host-session` on https),
// HttpOnly, SameSite=Lax, 30 days; the database keeps only the SHA-256 of its token. Only the browser that started a wallet request is signed in by it
// (its starter cookie), once. The passkey's signature names the game's host and counts once within 5 minutes. The server never sees a passkey, a seed
// or a key: it checks signatures (@nano133/signin) and keeps sessions.
//
// A game whose /admin signs in on the same paths (the starter: `scope: "admin"` in the body) passes `sharedPaths: true`: a call for the admin, and a
// wallet's call for a request this store does not hold, then answer null, and the game's own admin code answers them.

import {
  answerNanchat,
  answerNanoSignin,
  answerNautilus,
  checkNanchat,
  checkNanoSignin,
  checkNautilus,
  checkSignatureSignin,
  nanchatNonce,
  nanchatReply,
  NANO_SIGNIN_ACCEPTED,
  nanoSigninRefusal,
  nautilusReply,
  readNanoSignin,
  SigninError,
  startNanchat,
  startNanoSignin,
  startNautilus,
  validAddress,
  WalletRefused,
  type RequestCheck,
} from "@nano133/signin";
import { fail, json, memoryLimiter, readLimited, sameOrigin } from "../admin/http.js";
import { PLAYER_SIGNIN_LIMITS, SESSION_DAYS, STARTER_MAX_AGE_S, TOKEN_PATTERN, viaOf, WAYS, type PlayerSession, type PlayerSigninStore, type Via, type Way } from "./types.js";

/** The address that belongs to nobody (its key is all zeros): Nautilus names it while the game has no address of its own. */
export const EXAMPLE_ADDRESS = "nano_1111111111111111111111111111111111111111111111111111hifc8npp";

export type PlayerSigninOptions = {
  store: PlayerSigninStore;
  /**
   * A Nano address of the game's own (the starter's RECEIVE_ADDRESS). Nautilus only NAMES it in its request and in the text it signs: no key, no
   * payment. Null or none: the example address.
   */
  siteAddress?: string | null;
  /** Where the sign-in routes are. Default "/api/signin". */
  base?: string;
  /** The sign-out route. Default "/api/signout". */
  signOutPath?: string;
  /** The wallet apps the game offers, in the sheet's order. Default all three: ["berry", "nanchat", "nautilus"]. An empty list offers none. */
  ways?: readonly Way[];
  /** The passkey route. Default true. */
  passkey?: boolean;
  /**
   * The game's host exactly as players see it ("mygame.com", with a port when it has one). Every signed text names it. Default: the host of each
   * request. When it is set, a call to any other host is refused (403).
   */
  domain?: string;
  /** True when the game's admin signs in on the same paths (the starter's `scope: "admin"`): its calls answer null. Default false. */
  sharedPaths?: boolean;
  /** The cookies' names. Default { session: "session", starter: "starter" } (the starter's). On https they get the __Host- prefix. */
  cookies?: { session?: string; starter?: string };
  /** How long a session lasts, in days. Default 30. */
  sessionDays?: number;
  /** The shared limiter (sign-in starts, passkey sign-ins, NanChat's totals): false means "too many". Default: a fixed window in this copy's memory. */
  limit?: (key: string, limit: number, windowMs: number, now: number) => boolean | Promise<boolean>;
  /** The visitor's key for the limits: a keyed hash of the IP address, never the address. Default: the CF-Connecting-IP header as it is. */
  visitor?: (request: Request) => Promise<string>;
  /** The person check (Turnstile) of a start and a passkey sign-in: true when `token` passes. No hook: no check. */
  personCheck?: (token: unknown, request: Request) => Promise<boolean>;
  /** The time now in ms. Default Date.now. */
  now?: () => number;
  /** Told about a fault (a store). The player gets a plain 500 and never sees it. */
  onError?: (e: unknown) => void;
};

export type PlayerSignin = {
  base: string;
  /** Answers a sign-in route, or null when the request is not one (or is the admin's, with `sharedPaths`). */
  handle(request: Request): Promise<Response | null>;
  /** The signed-in player of this request (their Nano address), or null. The shop's and the friends' `player` hook. Never the admin's login. */
  player(request: Request): Promise<string | null>;
  /** The session of this request: the address, when it was made and how. */
  session(request: Request): Promise<PlayerSession | null>;
  /** Makes a new session for `address` (the game's own code exchange: via "nanoterra") and returns the Set-Cookie value to send. */
  signIn(request: Request, address: string, via: Via): Promise<string>;
  /** Ends this request's session and returns the Set-Cookie value that clears the cookie. */
  signOut(request: Request): Promise<string>;
  /** "Delete my data": every session and sign-in row of the player. Returns how many rows went. */
  forget(player: string): Promise<number>;
  /** The clean-up (a cron): old requests, ended sessions, used once-only keys. */
  clean(now?: number): Promise<void>;
};

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

/** Only a space or a tab around a cookie's name or value is dropped (JS trim() also drops Unicode spaces, which would let another name pass for ours). */
const trimAscii = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, "");

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && trimAscii(part.slice(0, i)) === name) {
      try {
        return decodeURIComponent(trimAscii(part.slice(i + 1)));
      } catch {
        // Not valid percent-coding: not ours.
      }
    }
  }
  return null;
}

const isHttps = (req: Request) => new URL(req.url).protocol === "https:";
/** A cookie for this site only: on https it gets the __Host- prefix and Secure (the starter's exact form). */
export function cookieHeader(req: Request, name: string, value: string, maxAgeSec: number): string {
  const https = isHttps(req);
  return `${https ? "__Host-" : ""}${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`;
}
const readCookie = (req: Request, name: string) => cookieValue(req, isHttps(req) ? `__Host-${name}` : name);

/** What the player reads for a refused passkey sign-in. */
function passkeyWords(e: SigninError): string {
  if (e.status === 409) return "That sign-in was used already. Try again.";
  if (e.status === 401) return "The signature does not match. Try again.";
  if (/too old/.test(e.message)) return "That sign-in is too old. Check the clock of this device, then try again.";
  return "That sign-in could not be read. Try again.";
}

const fallbackLimit = memoryLimiter();

export function createPlayerSignin(options: PlayerSigninOptions): PlayerSignin {
  const base = options.base ?? "/api/signin";
  const signOutPath = options.signOutPath ?? "/api/signout";
  for (const p of [base, signOutPath]) if (!p.startsWith("/") || p.length < 2 || p.endsWith("/")) throw new Error('a path must start with "/" and not end with "/", like "/api/signin"');
  const ways: readonly Way[] = options.ways ?? WAYS;
  for (const w of ways) if (!WAYS.includes(w)) throw new Error(`no such wallet app: ${String(w)} (the ways are ${WAYS.join(", ")})`);
  const passkeyOn = options.passkey !== false;
  const store = options.store;
  const sessionName = options.cookies?.session ?? "session";
  const starterName = options.cookies?.starter ?? "starter";
  for (const n of [sessionName, starterName]) if (!/^[A-Za-z0-9_-]{1,40}$/.test(n)) throw new Error("a cookie's name is letters, digits, _ and - only");
  const sessionMs = Math.max(1, options.sessionDays ?? SESSION_DAYS) * 86_400_000;
  const now = options.now ?? (() => Date.now());
  const limit = options.limit ?? fallbackLimit;
  const memory = memoryLimiter();
  const siteAddress = options.siteAddress && validAddress(options.siteAddress) ? options.siteAddress : EXAMPLE_ADDRESS;
  const report = (e: unknown) => {
    try {
      options.onError?.(e);
    } catch {
      // nothing more can be done
    }
  };
  const ipOf = (req: Request) => req.headers.get("CF-Connecting-IP") ?? "anyone";
  const visitorOf = async (req: Request) => (options.visitor ? await options.visitor(req) : ipOf(req));
  const person = async (token: unknown, req: Request) => (options.personCheck ? options.personCheck(token, req) : true);

  /** Each wallet's options for this request's site: the domain and page come from the address the player opened (or `domain`). */
  function walletsFor(req: Request, at: number) {
    const url = new URL(req.url);
    const host = options.domain ?? url.host;
    const origin = `${url.protocol}//${host}`;
    const clock = { now: () => at };
    return {
      host,
      berry: { domain: host, uri: `${origin}/`, store: store.requests("berry"), ...clock },
      nautilus: { site: host, siteAddress, store: store.requests("nautilus"), ...clock },
      nanchat: { host, store: store.requests("nanchat"), ...clock },
      requestUrl: (id: string) => `${origin}${base}/nano/${id}`,
      nautilusUrl: (id: string) => `${origin}${base}/nautilus?id=${id}`,
      nanchatUrl: `${origin}${base}/nanchat`,
    };
  }

  async function body(req: Request): Promise<Record<string, unknown> | null> {
    const text = await readLimited(req, PLAYER_SIGNIN_LIMITS.bodyMax);
    if (text === null) return null;
    if (!text) return {};
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** The way a call names; Berry Wallet when it names none (the starter's page sends none for Berry). Null for anything else. */
  const wayOf = (v: unknown): Way | null => (v === undefined ? (ways.includes("berry") ? "berry" : null) : (ways.find((w) => w === v) ?? null));

  async function newSession(address: string, via: Via, at: number) {
    const token = randomHex(32);
    return { token, record: { idHash: await sha256Hex(token), address, createdAt: at, expiresAt: at + sessionMs, via } };
  }

  async function start(req: Request, b: Record<string, unknown>, at: number): Promise<Response> {
    const way = wayOf(b.way);
    if (!way) return fail(400, "That wallet is not one of this game's.");
    if (!(await limit(`signin|${await visitorOf(req)}`, PLAYER_SIGNIN_LIMITS.signin.limit, PLAYER_SIGNIN_LIMITS.signin.windowMs, at))) return fail(429, "Too many sign-ins. Wait a few minutes.");
    if (!(await person(b.turnstile, req))) return fail(403, "The person check failed. Try again.");
    const starter = randomHex(32);
    const hash = await sha256Hex(starter);
    const w = walletsFor(req, at);
    let out: Record<string, unknown>;
    if (way === "nautilus") {
      const s = await startNautilus(w.nautilus, { starter: hash, answerUrl: w.nautilusUrl });
      out = { way, id: s.id, link: s.link, code: s.code, expiresAt: s.expiresAt };
    } else if (way === "nanchat") {
      const s = await startNanchat(w.nanchat, { starter: hash, answerUrl: w.nanchatUrl });
      out = { way, id: s.id, link: s.link, expiresAt: s.expiresAt };
    } else {
      const s = await startNanoSignin(w.berry, { starter: hash, requestUrl: w.requestUrl });
      out = { way, id: s.id, link: s.link, walletLink: s.walletLink, expiresAt: s.expiresAt };
    }
    return json(out, 200, { "Set-Cookie": cookieHeader(req, starterName, starter, STARTER_MAX_AGE_S) });
  }

  async function check(req: Request, b: Record<string, unknown>, at: number): Promise<Response> {
    const way = wayOf(b.way);
    if (!way) return fail(400, "That wallet is not one of this game's.");
    if (typeof b.id !== "string") return fail(400, "no request id");
    const cookie = readCookie(req, starterName);
    const starter = cookie && TOKEN_PATTERN.test(cookie) ? await sha256Hex(cookie) : undefined;
    const o = { store: store.requests(way), now: () => at };
    const r: RequestCheck = way === "nautilus" ? await checkNautilus(o, b.id, starter) : way === "nanchat" ? await checkNanchat(o, b.id, starter) : await checkNanoSignin(o, b.id, starter);
    if (r.status !== "signedin") return json({ status: r.status });
    if (!r.mine || !r.account) return json({ status: "elsewhere" });
    // Once: the delivery and the session are one step of the store; a second check of the same request makes no second session.
    const { token, record } = await newSession(r.account, "wallet", at);
    if (!(await store.deliver(way, r.key ?? b.id, record))) return json({ status: "used" });
    return json({ status: "signedin", address: r.account }, 200, { "Set-Cookie": cookieHeader(req, sessionName, token, sessionMs / 1000) });
  }

  async function passkey(req: Request, b: Record<string, unknown>, at: number): Promise<Response> {
    if (!(await limit(`signin|${await visitorOf(req)}`, PLAYER_SIGNIN_LIMITS.signin.limit, PLAYER_SIGNIN_LIMITS.signin.windowMs, at))) return fail(429, "Too many sign-ins. Wait a few minutes.");
    if (!(await person(b.turnstile, req))) return fail(403, "The person check failed. Try again.");
    let address: string;
    try {
      address = await checkSignatureSignin({ domain: walletsFor(req, at).host, useOnce: (k, ttl, a) => store.useOnce(k, ttl, a), now: () => at }, { address: b.address as string, at: Number(b.at), signature: b.signature as string });
    } catch (e) {
      if (e instanceof SigninError) return fail(e.status, passkeyWords(e));
      throw e;
    }
    const { token, record } = await newSession(address, "passkey", at);
    await store.createSession(record);
    return json({ status: "signedin", address }, 200, { "Set-Cookie": cookieHeader(req, sessionName, token, sessionMs / 1000) });
  }

  /** Berry Wallet's GET and POST. They come from the wallet app: no cookie, no Origin. */
  async function berry(req: Request, id: string, at: number): Promise<Response | null> {
    if (options.sharedPaths && !(await store.requests("berry").get(id))) return null;
    const w = walletsFor(req, at);
    if (req.method === "GET") {
      const request = await readNanoSignin(w.berry, id, w.requestUrl);
      return request ? json(request) : json(nanoSigninRefusal("This sign-in expired."), 404);
    }
    const b = await body(req);
    if (!b) return json(nanoSigninRefusal("This answer is not readable."), 401);
    try {
      await answerNanoSignin(w.berry, id, b, w.requestUrl);
      // Berry Wallet shows its success screen only for a 204 with no body.
      return new Response(null, { status: NANO_SIGNIN_ACCEPTED, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof WalletRefused) return json(nanoSigninRefusal(e.message), 401);
      throw e;
    }
  }

  async function nautilus(req: Request, at: number): Promise<Response | null> {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    if (options.sharedPaths && !(await store.requests("nautilus").get(id))) return null;
    const w = walletsFor(req, at);
    const b = await body(req);
    if (!b) return json(nautilusReply(w.host, "That answer could not be read."));
    try {
      await answerNautilus(w.nautilus, id, b);
      return json(nautilusReply(w.host));
    } catch (e) {
      if (e instanceof WalletRefused) return json(nautilusReply(w.host, e.message));
      throw e;
    }
  }

  /** NanChat's answer: its relay server posts every one, so the limits are totals and per nonce, never per visitor. */
  async function nanchat(req: Request, at: number): Promise<Response> {
    const w = walletsFor(req, at);
    const refuse = (words: string) => json(nanchatReply(w.host, words));
    if (!memory("nanchat", PLAYER_SIGNIN_LIMITS.nanchatRoute.limit, PLAYER_SIGNIN_LIMITS.nanchatRoute.windowMs, at)) return refuse("too many sign-ins at once. Wait a minute.");
    const b = await body(req);
    if (!b) return refuse("that answer could not be read.");
    const nonce = nanchatNonce(w.host, b.message);
    if (nonce && typeof b.account === "string" && typeof b.signature === "string" && /^[0-9A-Fa-f]{128}$/.test(b.signature)) {
      if (!(await limit("nanchat|all", PLAYER_SIGNIN_LIMITS.nanchatAll.limit, PLAYER_SIGNIN_LIMITS.nanchatAll.windowMs, at))) return refuse("too many sign-ins at once. Wait a few minutes.");
      if (!(await limit(`nanchat|${nonce}`, PLAYER_SIGNIN_LIMITS.nanchatNonce.limit, PLAYER_SIGNIN_LIMITS.nanchatNonce.windowMs, at))) return refuse(`too many tries for this sign-in. Start again on ${w.host}.`);
    }
    try {
      await answerNanchat(w.nanchat, b);
      return json(nanchatReply(w.host));
    } catch (e) {
      if (e instanceof WalletRefused) return refuse(e.message);
      throw e;
    }
  }

  async function sessionOf(req: Request): Promise<PlayerSession | null> {
    const token = readCookie(req, sessionName);
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    const s = await store.session(await sha256Hex(token), now());
    return s ? { address: s.address, createdAt: s.createdAt, via: viaOf(s.via) } : null;
  }

  async function signOut(req: Request): Promise<string> {
    const token = readCookie(req, sessionName);
    if (token && TOKEN_PATTERN.test(token)) await store.endSession(await sha256Hex(token));
    return cookieHeader(req, sessionName, "", 0);
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    const berryPath = path.startsWith(`${base}/nano/`) ? /^[0-9a-f]{32}$/.exec(path.slice(base.length + 6))?.[0] : undefined;
    const browserRoutes = [`${base}/start`, `${base}/check`, `${base}/passkey`, signOutPath];
    const mine = browserRoutes.includes(path) || berryPath !== undefined || path === `${base}/nautilus` || path === `${base}/nanchat`;
    if (!mine) return null;
    if (path === `${base}/passkey` && !passkeyOn) return null;
    try {
      if (options.domain && url.host !== options.domain) return fail(403, `This sign-in belongs to ${options.domain}.`);
      const at = now();
      const ip = ipOf(req);

      // The wallet apps' routes: no cookie and no Origin (an app, or NanChat's relay server, posts them: not a browser page).
      if (berryPath !== undefined) {
        if (req.method !== "GET" && req.method !== "POST") return fail(405, "Not allowed.", {}, { Allow: "GET, POST" });
        if (!ways.includes("berry")) return null;
        if (!memory(`wallet|${ip}`, PLAYER_SIGNIN_LIMITS.wallet.limit, PLAYER_SIGNIN_LIMITS.wallet.windowMs, at)) return fail(429, "Too many requests.");
        return await berry(req, berryPath, at);
      }
      if (path === `${base}/nautilus`) {
        if (req.method !== "POST" || !ways.includes("nautilus")) return null;
        // Nautilus shows the words of a refusal only with HTTP 200.
        if (!memory(`wallet|${ip}`, PLAYER_SIGNIN_LIMITS.wallet.limit, PLAYER_SIGNIN_LIMITS.wallet.windowMs, at)) return json(nautilusReply(walletsFor(req, at).host, "Too many requests. Wait a minute."));
        return await nautilus(req, at);
      }
      if (path === `${base}/nanchat`) {
        if (req.method !== "POST" || !ways.includes("nanchat")) return null;
        return await nanchat(req, at);
      }

      // The browser's own calls: a POST from the game's own page.
      if (req.method !== "POST") return fail(405, "Not allowed.", {}, { Allow: "POST" });
      // Read on a copy: a call that is the admin's goes back to the game whole.
      const b = await body(options.sharedPaths ? req.clone() : req);
      if (b && b.scope === "admin") return options.sharedPaths ? null : fail(400, "This game has no such sign-in.");
      if (!sameOrigin(req)) return fail(403, "This call must come from the game's own page.");
      if (path === signOutPath) {
        // A body that is not JSON (an older page) signs out too.
        return json({ ok: true }, 200, { "Set-Cookie": await signOut(req) });
      }
      if (!b) return fail(400, "That request is not readable.");
      if (path === `${base}/check`) {
        if (!memory(`poll|${ip}`, PLAYER_SIGNIN_LIMITS.poll.limit, PLAYER_SIGNIN_LIMITS.poll.windowMs, at)) return fail(429, "Too many requests. Wait a minute.");
        return await check(req, b, at);
      }
      if (path === `${base}/start`) return await start(req, b, at);
      return await passkey(req, b, at);
    } catch (e) {
      report(e);
      return fail(500, "Something went wrong. Try again.");
    }
  }

  return {
    base,
    handle,
    async player(req) {
      return (await sessionOf(req))?.address ?? null;
    },
    session: sessionOf,
    async signIn(req, address, via) {
      if (!validAddress(address)) throw new Error("a session is for a whole Nano address");
      if (!(["wallet", "passkey", "nanoterra"] as const).includes(via)) throw new Error("say how the player signed in: wallet, passkey or nanoterra");
      const { token, record } = await newSession(address, via, now());
      await store.createSession(record);
      return cookieHeader(req, sessionName, token, sessionMs / 1000);
    },
    signOut,
    forget: (player) => store.forget(player),
    clean: (at = now()) => store.clean(at),
  };
}
