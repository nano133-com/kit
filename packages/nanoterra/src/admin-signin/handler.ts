// The routes of the ADMIN's sign-in, on the Web `Request` and `Response` types (a Worker, Firebase Functions, Node). The game starter's admin sign-in
// (its src/worker/signin.ts), moved into the package with every check and every signed text as the starter has them; only the paths are new, and the same
// in every game:
//
//   POST {base}/start          the browser starts an admin request: { way, turnstile? } → { way, id, link, walletLink?, code?, expiresAt } and the starter cookie
//   GET  {base}/nano/:id       Berry Wallet reads the request (no cookie, no Origin)
//   POST {base}/nano/:id       Berry Wallet posts its signature: 204 with no body when accepted, 401 and the words when refused
//   POST {base}/nautilus?id=   Nautilus posts its signature: always 200 (Nautilus shows only a 200's words)
//   POST {base}/nanchat        NanChat's relay server posts the signature (only with `nanchat: true`): always 200, a refusal starts "NOT signed in"
//   POST {base}/check          the browser asks every 2 seconds: { id, way } → { status: "waiting" | "expired" | "elsewhere" | "used" | "not_owner" | "signedin", address? }
//   POST {base}/signout        ends this browser's admin login only: { ok: true }
//
// With `passkeys: true` (since 0.12.0), the owner's linked passkeys (a passkey is only a key to /admin; the money stays in the owner's wallet):
//
//   POST {base}/passkey/link   { address, at, signature }: ONLY with a live WALLET admin session of the owner, and the passkey's own signature of
//                              "Link this passkey to the ADMIN of <host>: sign in as <address> at <ms>": both sides prove their key → { ok, passkeys }
//   POST {base}/passkey/unlink { address }: only with a live wallet admin session of the owner; the passkey's admin sessions end too → { ok, removed, passkeys }
//   POST {base}/passkeys       the list, for any session the guard accepts → { passkeys, limit, via, canChange, you }
//   POST {base}/passkey        { address, at, signature, turnstile? }: the passkey's signature of "ADMIN of <host>: sign in as <address> at <ms>" (never
//                              the host alone, which a player's passkey signs), refused unless the passkey is linked to the owner → a NEW admin session
//                              { via: "passkey" } of one day and the admin cookie
//
// Each passkey signature counts once (the admin's own table) and within 5 minutes. A passkey session opens /admin only while its link to the CURRENT owner
// exists: `session(request)` reads the link on every request, so a removed link or a new owner address ends it at the next request.
//
// `base` is "/api/admin-signin" (ADMIN_SIGNIN_BASE). Berry Wallet and Nautilus sign a text that names the ADMIN: Berry signs the page `${origin}/admin`
// with NO query (Berry refused "/admin?from=US" with "Sign-in requires a public HTTPS website", device test 2026-10-27), Nautilus signs the label "ADMIN of
// <host> sign-in ABCD-EFGH from <country>" and shows "Sign in to the ADMIN of <host>. Started <time> UTC from <country>. If you did not start this, do not
// sign." NanChat is OFF by default and refused with the starter's words: its text must start "Login to <host>" and CANNOT name the ADMIN, so the owner
// who is asked to sign sees what looks like any sign-in to the game. A game may turn it on (`nanchat: true`); it then signs "Login to <host>" as a
// player's NanChat sign-in does, and the admin's own checks (the starter cookie, the owner, once) are the same. A request lives 2 minutes, is
// delivered for one more minute, and works once.
//
// Two logins, two cookies: the game's (`session`, the player sign-in's) and the admin's (`admin`; `__Host-admin` on https, HttpOnly, SameSite=Lax, one
// day), so the game and /admin can have different people signed in at once. The database keeps `adminKey(token)`, the SHA-256 of "admin:" and the token,
// and a player's session keeps the plain hash: a player's token put in the admin cookie opens nothing, and a starter value copied from the player's cookie
// finishes no admin request. Only the game's own address (`owner`) makes an admin login. DO NOT CHANGE the checks in this file: they are what makes the
// admin page the creator's.

import {
  answerNanchat,
  answerNanoSignin,
  answerNautilus,
  checkNanchat,
  checkSignatureSignin,
  checkNanoSignin,
  checkNautilus,
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
  type NanchatOptions,
  type NanoSigninOptions,
  type NautilusOptions,
  type RequestCheck,
} from "@nano133/signin";
import { ADMIN_SESSION_MS, adminAccess } from "../admin/guard.js";
import { fail, json, memoryLimiter, readLimited, sameOrigin } from "../admin/http.js";
import type { AdminLogin } from "../admin/store.js";
import { countryOf, shortBrowser } from "./browser.js";
import {
  ADMIN_DELIVER_MS,
  ADMIN_ONCE_MS,
  ADMIN_PAGE,
  ADMIN_PASSKEY_LIMIT,
  ADMIN_REQUEST_MS,
  ADMIN_SIGNIN_BASE,
  ADMIN_SIGNIN_LIMITS,
  ADMIN_STARTER_MAX_AGE_S,
  ADMIN_WAYS,
  NANCHAT_REFUSAL,
  TOKEN_PATTERN,
  adminLinkDomain,
  adminPasskeyDomain,
  type AdminSigninSession,
  type AdminSigninStore,
  type AdminWay,
} from "./types.js";

/** The address that belongs to nobody (its key is all zeros): Nautilus names it while the game has no address of its own. */
export const EXAMPLE_ADDRESS = "nano_1111111111111111111111111111111111111111111111111111hifc8npp";

export type AdminSigninOptions = {
  store: AdminSigninStore;
  /**
   * The game's own address (the starter's RECEIVE_ADDRESS: "nano_...", lowercase, its checksum checked), or null when none is set. Only this address makes an
   * admin login: a signature by any other wallet is answered "not_owner" and the request stays unused. Nautilus also NAMES it in its request and in the
   * text it signs (no key, no payment); with none, the example address.
   */
  owner: string | null;
  /** Where the routes are. Default "/api/admin-signin" (ADMIN_SIGNIN_BASE): keep it, so every page and helper finds the admin's sign-in at the same place. */
  base?: string;
  /** The admin page that Berry Wallet signs in to. Default "/admin". A path with no query: Berry refuses a query. */
  page?: string;
  /** The game's host exactly as people see it ("mygame.com"). Every signed text names it. Default: the host of each request. When it is set, a call to any other host is refused (403). */
  domain?: string;
  /**
   * Offer NanChat for the admin. Default false: a NanChat start is refused ("NanChat cannot open the admin yet. Use Berry Wallet or Nautilus."). NanChat's
   * text must start "Login to <host>" and cannot name the ADMIN, which is why it is off: the owner who is asked to sign cannot tell an admin sign-in from a
   * game sign-in. Turn it on only when the owner accepts that; give the panel the same `nanchat: true`.
   */
  nanchat?: boolean;
  /**
   * The owner's linked passkeys (since 0.12.0). Default false: no passkey route, and no passkey session opens /admin. With true, a live WALLET admin
   * session of the owner may link up to 10 passkeys (each proves its key by signing), and a linked passkey's signature makes an admin login while its link to
   * the current owner exists. The store needs the passkey methods (the package's stores have them; D1 needs the two tables at the end of d1.sql). Give the
   * panel the same `passkeys: true` and the game's frozen passkey `scheme`.
   */
  passkeys?: boolean;
  /** The cookies' names. Default { session: "admin", starter: "starter-admin" } (the starter's). On https they get the __Host- prefix. */
  cookies?: { session?: string; starter?: string };
  /** The shared limiter of the starts: false means "too many". Default: a fixed window in this process's memory. */
  limit?: (key: string, limit: number, windowMs: number, now: number) => boolean | Promise<boolean>;
  /** The visitor's key for the limit of the starts: a keyed hash of the IP address, never the address. Default: the CF-Connecting-IP header as it is. */
  visitor?: (request: Request) => Promise<string>;
  /** The person check (Turnstile) of a start: true when `token` passes. No hook: no check. */
  personCheck?: (token: unknown, request: Request) => Promise<boolean>;
  /** The time now in ms. Default Date.now. */
  now?: () => number;
  /** Told about a fault (a store). The visitor gets a plain 500 and never sees it. */
  onError?: (e: unknown) => void;
};

export type AdminSignin = {
  base: string;
  /** Answers a route of the admin's sign-in, or null when the request is not one. */
  handle(request: Request): Promise<Response | null>;
  /** The ADMIN login of this request (the admin cookie only), or null: give it to `createAdminHandler` as its `session`. Never a player's login. */
  session(request: Request, now?: number): Promise<AdminSigninSession | null>;
  /** Ends this request's admin login only and returns the Set-Cookie value that clears the cookie (the game's own login, another person's perhaps, stays). */
  signOut(request: Request): Promise<string>;
  /** "Sign out everywhere": every admin login and every admin request not yet delivered. Give it to the admin store (`signOutEverywhere`) when the store has none. */
  signOutEverywhere(): Promise<number>;
  /** The last admin sign-ins, newest first. Give it to the admin store (`recentLogins`) when the store has none. */
  recentLogins(limit: number): Promise<AdminLogin[]>;
  /** The clean-up (a cron): old admin requests, ended admin sessions, sign-in rows past 30 days. */
  clean(now?: number): Promise<void>;
};

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha256Hex = async (text: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

/**
 * What the database keeps of an admin session or of an admin request's starter: the hash of the value with a prefix. So the SERVER (not only the cookie's
 * name) keeps the two scopes apart: a token made for the game (the player sign-in keeps its plain hash) does not open /admin even if it is put in the admin
 * cookie, and a starter value copied from the game's cookie does not finish an admin request.
 */
export const adminKey = (value: string): Promise<string> => sha256Hex(`admin:${value}`);

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
function cookieHeader(req: Request, name: string, value: string, maxAgeSec: number): string {
  const https = isHttps(req);
  return `${https ? "__Host-" : ""}${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`;
}
/** A cookie's value: on https only the `__Host-` name (a sibling subdomain can set the plain one; it cannot set a `__Host-` one). */
const readCookie = (req: Request, name: string) => cookieValue(req, isHttps(req) ? `__Host-${name}` : name);

/** What the owner reads for a refused passkey signature. */
function passkeyWords(e: SigninError): string {
  if (e.status === 409) return "That passkey signature was used already. Try again.";
  if (e.status === 401) return "The passkey's signature does not match. Try again.";
  if (/too old/.test(e.message)) return "That signature is too old. Check the clock of this device, then try again.";
  return "That passkey signature could not be read. Try again.";
}

/** The limiters live at module level: a Worker makes the sign-in for each request, and a limiter made inside it would forget every call. */
const fallbackLimit = memoryLimiter();
const memory = memoryLimiter();

export function createAdminSignin(options: AdminSigninOptions): AdminSignin {
  const base = options.base ?? ADMIN_SIGNIN_BASE;
  if (!base.startsWith("/") || base.length < 2 || base.endsWith("/")) throw new Error('a path must start with "/" and not end with "/", like "/api/admin-signin"');
  const page = options.page ?? ADMIN_PAGE;
  if (!/^\/[A-Za-z0-9._~\-/]*$/.test(page)) throw new Error('the admin page is a path with no query, like "/admin"');
  const store = options.store;
  const sessionName = options.cookies?.session ?? "admin";
  const starterName = options.cookies?.starter ?? "starter-admin";
  for (const n of [sessionName, starterName]) if (!/^[A-Za-z0-9_-]{1,40}$/.test(n)) throw new Error("a cookie's name is letters, digits, _ and - only");
  if (sessionName === starterName) throw new Error("the session cookie and the starter cookie need two names");
  const owner = options.owner;
  const now = options.now ?? (() => Date.now());
  const limit = options.limit ?? fallbackLimit;
  const siteAddress = owner && validAddress(owner) ? owner : EXAMPLE_ADDRESS;
  const nanchatOn = options.nanchat === true;
  const passkeysOn = options.passkeys === true;
  const pk = store as Required<AdminSigninStore>;
  if (passkeysOn) {
    for (const m of ["createSession", "linkPasskey", "unlinkPasskey", "passkeys", "linked", "useOnce"] as const) {
      if (typeof store[m] !== "function") throw new Error(`passkeys: true needs a store with ${m}() (the package's stores have it)`);
    }
  }
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

  /**
   * The sign-in options of each wallet app for this request's site: the domain and page come from the address the owner opened (or `domain`). `admin` is
   * given for a START: the request's life is 2 minutes, and Nautilus's label and line name the admin and the place the request started. Berry Wallet's text
   * names the admin through its page, for every call (each request this sign-in holds is an admin request), so the wallet's GET and POST get the same text.
   */
  function wallets(req: Request, at: number, admin?: { country: string | null }) {
    const url = new URL(req.url);
    const host = options.domain ?? url.host;
    const origin = `${url.protocol}//${host}`;
    const clock = { now: () => at };
    const life = admin ? { ttlMs: ADMIN_REQUEST_MS } : {};
    const started = new Date(at).toISOString().slice(11, 16);
    const adminLine = `Sign in to the ADMIN of ${host}. Started ${started} UTC from ${admin?.country ?? "an unknown country"}. If you did not start this, do not sign.`;
    return {
      host,
      berry: { domain: host, uri: `${origin}${page}`, store: store.requests("berry"), ...life, ...clock } satisfies NanoSigninOptions,
      nautilus: {
        site: host,
        siteAddress,
        store: store.requests("nautilus"),
        ...(admin ? { title: `ADMIN of ${host}`, ...(admin.country ? { note: `from ${admin.country}` } : {}), message: adminLine } : {}),
        ...life,
        ...clock,
      } satisfies NautilusOptions,
      // NanChat's text is "Login to <host> nonce: <nonce>": it has no place for the admin's name.
      nanchat: { host, store: store.requests("nanchat"), ...life, ...clock } satisfies NanchatOptions,
      nanchatUrl: `${origin}${base}/nanchat`,
      requestUrl: (id: string) => `${origin}${base}/nano/${id}`,
      nautilusUrl: (id: string) => `${origin}${base}/nautilus?id=${id}`,
    };
  }

  /** A JSON body of at most 8 KB, or null when it is not one readable object. */
  async function body(req: Request): Promise<Record<string, unknown> | null> {
    const text = await readLimited(req, ADMIN_SIGNIN_LIMITS.bodyMax);
    if (text === null) return null;
    if (!text) return {};
    try {
      const v: unknown = JSON.parse(text);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  /** The way a call names; Berry Wallet when it names none. Null for anything else. NanChat is a way even when it is off, so that it is refused with its own words. */
  const wayOf = (v: unknown): AdminWay | null => (v === undefined ? "berry" : (ADMIN_WAYS.find((w) => w === v) ?? null));

  async function start(req: Request, b: Record<string, unknown>, at: number): Promise<Response> {
    const way = wayOf(b.way);
    if (!way) return fail(400, "That wallet is not one of this game's.");
    if (!(await limit(`signin|${await visitorOf(req)}`, ADMIN_SIGNIN_LIMITS.signin.limit, ADMIN_SIGNIN_LIMITS.signin.windowMs, at))) return fail(429, "Too many sign-ins. Wait a few minutes.");
    if (!(await person(b.turnstile, req))) return fail(403, "The person check failed. Try again.");
    const admin = { country: countryOf(req) };
    // NanChat cannot name the admin in what it signs (its text must start "Login to <host>"): an admin request through it would look like any sign-in to
    // the owner who is asked to sign. So it is refused unless the game turned it on.
    if (way === "nanchat" && !nanchatOn) return fail(400, NANCHAT_REFUSAL);
    const starter = randomHex(32);
    const hash = await adminKey(starter);
    const w = wallets(req, at, admin);
    let out: Record<string, unknown>;
    if (way === "nautilus") {
      const s = await startNautilus(w.nautilus, { starter: hash, answerUrl: w.nautilusUrl });
      out = { way, id: s.id, link: s.link, code: s.code, expiresAt: s.expiresAt };
    } else if (way === "nanchat") {
      const s = await startNanchat(w.nanchat, { starter: hash, answerUrl: w.nanchatUrl });
      out = { way, id: s.id, link: s.link, expiresAt: s.expiresAt };
    } else {
      // `label` keeps where the request started ("admin:US"), as the starter wrote it: a starter that reads these rows sees an admin request it knows.
      const s = await startNanoSignin(w.berry, { starter: hash, requestUrl: w.requestUrl, label: admin.country ? `admin:${admin.country}` : "admin" });
      out = { way, id: s.id, link: s.link, walletLink: s.walletLink, expiresAt: s.expiresAt };
    }
    return json(out, 200, { "Set-Cookie": cookieHeader(req, starterName, starter, ADMIN_STARTER_MAX_AGE_S) });
  }

  /**
   * The browser's check of an admin request. When it is signed and this browser started it ("mine"), a NEW admin session is made, once per request, and
   * its cookie is set.
   */
  async function check(req: Request, b: Record<string, unknown>, at: number): Promise<Response> {
    const way = wayOf(b.way);
    if (!way) return fail(400, "That wallet is not one of this game's.");
    if (typeof b.id !== "string") return fail(400, "no request id");
    const cookie = readCookie(req, starterName);
    // The starter cookie is what this sign-in made: 32 random bytes as 64 hex characters. A value of any other shape (one with a prefix of the other scope's hashing, for example) is no starter.
    const starter = cookie && TOKEN_PATTERN.test(cookie) ? await adminKey(cookie) : undefined;
    // While NanChat is off the admin starts no NanChat request: there is none to deliver.
    if (way === "nanchat" && !nanchatOn) return json({ status: "expired" });
    // An admin request is delivered for a minute after it ends.
    const o = { store: store.requests(way), now: () => at, deliverMs: ADMIN_DELIVER_MS };
    const r: RequestCheck = way === "nautilus" ? await checkNautilus(o, b.id, starter) : way === "nanchat" ? await checkNanchat(o, b.id, starter) : await checkNanoSignin(o, b.id, starter);
    if (r.status !== "signedin") return json({ status: r.status });
    if (!r.mine || !r.account) return json({ status: "elsewhere" });
    // An admin login is for the game's own address only. A wallet that is not it makes no admin login (and does not end the owner's, which is in a cookie
    // of its own), and the request stays unused.
    if (r.account !== owner) return json({ status: "not_owner", address: r.account });
    // Deliver once: a second check of the same request makes no second session. The delivery and the session are ONE step of the store, and the session is
    // written only when the delivery changed the request. So "Sign out everywhere" cannot run between them: it either ends the request first (nothing is
    // delivered, no session) or deletes the session after.
    const token = randomHex(32);
    const record = { idHash: await adminKey(token), address: r.account, createdAt: at, expiresAt: at + ADMIN_SESSION_MS, via: "wallet" };
    if (!(await store.deliver(way, r.key ?? b.id, record))) return json({ status: "used" });
    // The admin's sign-in list: the time, the rough country and a short browser name of THIS browser (the one that started the request and now gets the login). Nothing else.
    await store.recordLogin({ at, country: countryOf(req), browser: shortBrowser(req.headers.get("User-Agent")) });
    return json({ status: "signedin", address: r.account }, 200, { "Set-Cookie": cookieHeader(req, sessionName, token, ADMIN_SESSION_MS / 1000) });
  }

  /** Berry Wallet's GET and POST. They come from the wallet app, so there is no cookie and no Origin to check. */
  async function berry(req: Request, id: string, at: number): Promise<Response> {
    const w = wallets(req, at);
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

  /** Nautilus's answer. It comes from the app: no cookie, no Origin. Nautilus shows the words only with HTTP 200. */
  async function nautilus(req: Request, at: number): Promise<Response> {
    const w = wallets(req, at);
    const b = await body(req);
    if (!b) return json(nautilusReply(w.host, "That answer could not be read."));
    try {
      await answerNautilus(w.nautilus, new URL(req.url).searchParams.get("id") ?? "", b);
      return json(nautilusReply(w.host));
    } catch (e) {
      if (e instanceof WalletRefused) return json(nautilusReply(w.host, e.message));
      throw e;
    }
  }

  /** NanChat's answer (only while it is on): its relay server posts every one, so the limits are totals and per nonce, never per visitor. Always 200: NanChat shows the words. */
  async function nanchat(req: Request, at: number): Promise<Response> {
    const w = wallets(req, at);
    const refuse = (words: string) => json(nanchatReply(w.host, words));
    if (!memory(`${base}|nanchat`, ADMIN_SIGNIN_LIMITS.nanchatRoute.limit, ADMIN_SIGNIN_LIMITS.nanchatRoute.windowMs, at)) return refuse("too many sign-ins at once. Wait a minute.");
    const b = await body(req);
    if (!b) return refuse("that answer could not be read.");
    const nonce = nanchatNonce(w.host, b.message);
    if (nonce && typeof b.account === "string" && typeof b.signature === "string" && /^[0-9A-Fa-f]{128}$/.test(b.signature)) {
      if (!(await limit("admin-nanchat|all", ADMIN_SIGNIN_LIMITS.nanchatAll.limit, ADMIN_SIGNIN_LIMITS.nanchatAll.windowMs, at))) return refuse("too many sign-ins at once. Wait a few minutes.");
      if (!(await limit(`admin-nanchat|${nonce}`, ADMIN_SIGNIN_LIMITS.nanchatNonce.limit, ADMIN_SIGNIN_LIMITS.nanchatNonce.windowMs, at))) return refuse(`too many tries for this sign-in. Start again on ${w.host}.`);
    }
    try {
      await answerNanchat(w.nanchat, b);
      return json(nanchatReply(w.host));
    } catch (e) {
      if (e instanceof WalletRefused) return refuse(e.message);
      throw e;
    }
  }

  async function sessionOf(req: Request, at = now()): Promise<AdminSigninSession | null> {
    const token = readCookie(req, sessionName);
    if (!token || !TOKEN_PATTERN.test(token)) return null;
    // The scope is in the store's row (the adapter reads only admin rows) as well as in the hash: the two scopes stay apart in two ways.
    const s = await store.session(await adminKey(token), at);
    if (!s) return null;
    if (s.via === "passkey") {
      // A passkey's login counts only while its link to the CURRENT owner exists: read now, on every request. A removed link, a new owner address, or the
      // passkeys turned off: no session at all (the page asks for a sign-in). `linkedTo` is set here only, and only after this check.
      if (!passkeysOn || typeof owner !== "string" || !validAddress(owner)) return null;
      return (await pk.linked(owner, s.address)) ? { address: s.address, createdAt: s.createdAt, via: "passkey", linkedTo: owner } : null;
    }
    // Only the words a login can carry are read; any other is "unknown", never a wallet login (a fail-open map would turn a stray value into a login that opens /admin).
    return { address: s.address, createdAt: s.createdAt, via: s.via === "wallet" || s.via === "nanoterra" ? s.via : "unknown" };
  }

  // ---- the owner's passkeys ----

  /** The host every passkey text names: `domain`, or this request's host. */
  const hostOf = (req: Request) => options.domain ?? new URL(req.url).host;

  /** The session the guard accepts now, or the refusal to send. `wallet`: only a wallet session of the owner (a link and a removal). */
  async function ownerSession(req: Request, at: number, wallet: boolean): Promise<{ ok: true; session: AdminSigninSession } | { ok: false; res: Response }> {
    const session = await sessionOf(req, at);
    const access = adminAccess({ owner, session, now: at });
    if (!access.ok) return { ok: false, res: fail(access.status, access.error, access.reason ? { reason: access.reason } : {}) };
    if (wallet && session!.via !== "wallet") return { ok: false, res: fail(403, "Only a wallet sign-in can add or remove a passkey. Sign in with your wallet.", { reason: "wallet_only" }) };
    return { ok: true, session: session! };
  }

  /** A passkey's signature of `domain`'s text, checked once: its address, or the refusal to send. */
  async function passkeySignature(b: Record<string, unknown>, domain: string, label: string, at: number): Promise<{ ok: true; address: string } | { ok: false; res: Response }> {
    try {
      const address = await checkSignatureSignin(
        { domain, useOnce: (k, ttl) => pk.useOnce(k, Math.max(ttl, ADMIN_ONCE_MS)), now: () => at, onceLabel: label },
        { address: b.address as string, at: Number(b.at), signature: b.signature as string },
      );
      return { ok: true, address };
    } catch (e) {
      if (e instanceof SigninError) return { ok: false, res: fail(e.status, passkeyWords(e)) };
      throw e;
    }
  }

  async function passkeyList(session: AdminSigninSession): Promise<Record<string, unknown>> {
    return { passkeys: await pk.passkeys(owner!), limit: ADMIN_PASSKEY_LIMIT, via: session.via, canChange: session.via === "wallet", you: session.address };
  }

  async function link(req: Request, b: Record<string, unknown>, at: number): Promise<Response> {
    const o = await ownerSession(req, at, true);
    if (!o.ok) return o.res;
    if (!(await limit(`signin|${await visitorOf(req)}`, ADMIN_SIGNIN_LIMITS.signin.limit, ADMIN_SIGNIN_LIMITS.signin.windowMs, at))) return fail(429, "Too many tries. Wait a few minutes.");
    const sig = await passkeySignature(b, adminLinkDomain(hostOf(req)), "nanoterra admin passkey link v1", at);
    if (!sig.ok) return sig.res;
    const r = await pk.linkPasskey(owner!, sig.address, at);
    if (r === "full") return fail(409, `You have ${ADMIN_PASSKEY_LIMIT} passkeys. Remove one first.`, { reason: "full" });
    if (r === "exists") return fail(409, "This passkey is linked already.", { reason: "exists" });
    return json({ ok: true, address: sig.address, ...(await passkeyList(o.session)) });
  }

  async function unlink(req: Request, b: Record<string, unknown>, at: number): Promise<Response> {
    const o = await ownerSession(req, at, true);
    if (!o.ok) return o.res;
    if (typeof b.address !== "string" || !validAddress(b.address)) return fail(400, "That is not a passkey's address.");
    const removed = await pk.unlinkPasskey(owner!, b.address);
    return json({ ok: true, removed, ...(await passkeyList(o.session)) });
  }

  async function list(req: Request, at: number): Promise<Response> {
    const o = await ownerSession(req, at, false);
    if (!o.ok) return o.res;
    return json(await passkeyList(o.session));
  }

  async function passkeySignin(req: Request, b: Record<string, unknown>, at: number): Promise<Response> {
    if (!(await limit(`signin|${await visitorOf(req)}`, ADMIN_SIGNIN_LIMITS.signin.limit, ADMIN_SIGNIN_LIMITS.signin.windowMs, at))) return fail(429, "Too many sign-ins. Wait a few minutes.");
    if (!(await person(b.turnstile, req))) return fail(403, "The person check failed. Try again.");
    if (typeof owner !== "string" || !validAddress(owner)) return fail(403, "Set the game's own Nano address first. Only that address can open this page.", { reason: "no_address" });
    const sig = await passkeySignature(b, adminPasskeyDomain(hostOf(req)), "nanoterra admin passkey signin v1", at);
    if (!sig.ok) return sig.res;
    // The signature is checked first, so a stranger learns nothing of which passkeys are linked.
    if (!(await pk.linked(owner, sig.address))) return fail(403, "This passkey is not linked to the game's address. Sign in with your wallet, then add this passkey in Settings.", { reason: "not_linked" });
    const token = randomHex(32);
    await pk.createSession({ idHash: await adminKey(token), address: sig.address, createdAt: at, expiresAt: at + ADMIN_SESSION_MS, via: "passkey" });
    await store.recordLogin({ at, country: countryOf(req), browser: shortBrowser(req.headers.get("User-Agent")) });
    return json({ status: "signedin", address: sig.address, linkedTo: owner }, 200, { "Set-Cookie": cookieHeader(req, sessionName, token, ADMIN_SESSION_MS / 1000) });
  }

  async function signOut(req: Request): Promise<string> {
    const token = readCookie(req, sessionName);
    if (token) await store.endSession(await adminKey(token));
    return cookieHeader(req, sessionName, "", 0);
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    const berryId = path.startsWith(`${base}/nano/`) ? /^[0-9a-f]{32}$/.exec(path.slice(base.length + 6))?.[0] : undefined;
    const passkeyPaths = [`${base}/passkey`, `${base}/passkey/link`, `${base}/passkey/unlink`, `${base}/passkeys`];
    const mine =
      berryId !== undefined || [`${base}/start`, `${base}/check`, `${base}/signout`, `${base}/nautilus`].includes(path) || (nanchatOn && path === `${base}/nanchat`) || (passkeysOn && passkeyPaths.includes(path));
    if (!mine) return null;
    try {
      if (options.domain && url.host !== options.domain) return fail(403, `This sign-in belongs to ${options.domain}.`);
      const at = now();
      const ip = ipOf(req);

      // The wallet apps' routes: no cookie and no Origin (an app posts them, not a browser page).
      if (berryId !== undefined) {
        if (req.method !== "GET" && req.method !== "POST") return fail(405, "Not allowed.", {}, { Allow: "GET, POST" });
        if (!memory(`${base}|wallet|${ip}`, ADMIN_SIGNIN_LIMITS.wallet.limit, ADMIN_SIGNIN_LIMITS.wallet.windowMs, at)) return fail(429, "Too many requests.");
        return await berry(req, berryId, at);
      }
      if (path === `${base}/nautilus`) {
        if (req.method !== "POST") return fail(405, "Not allowed.", {}, { Allow: "POST" });
        // Nautilus shows the words of a refusal only with HTTP 200.
        if (!memory(`${base}|wallet|${ip}`, ADMIN_SIGNIN_LIMITS.wallet.limit, ADMIN_SIGNIN_LIMITS.wallet.windowMs, at)) return json(nautilusReply(wallets(req, at).host, "Too many requests. Wait a minute."));
        return await nautilus(req, at);
      }
      if (path === `${base}/nanchat`) {
        if (req.method !== "POST") return fail(405, "Not allowed.", {}, { Allow: "POST" });
        return await nanchat(req, at);
      }

      // The browser's own calls: a POST from the game's own page.
      if (req.method !== "POST") return fail(405, "Not allowed.", {}, { Allow: "POST" });
      if (path === `${base}/check` && !memory(`${base}|poll|${ip}`, ADMIN_SIGNIN_LIMITS.poll.limit, ADMIN_SIGNIN_LIMITS.poll.windowMs, at)) return fail(429, "Too many requests. Wait a minute.");
      if (passkeyPaths.includes(path) && path !== `${base}/passkey` && !memory(`${base}|passkeys|${ip}`, ADMIN_SIGNIN_LIMITS.passkeys.limit, ADMIN_SIGNIN_LIMITS.passkeys.windowMs, at)) return fail(429, "Too many requests. Wait a minute.");
      if (!sameOrigin(req)) return fail(403, "This call must come from the game's own page.");
      // A sign-out reads no body.
      if (path === `${base}/signout`) return json({ ok: true }, 200, { "Set-Cookie": await signOut(req) });
      const b = await body(req);
      if (!b) return fail(400, "That request is not readable.");
      if (path === `${base}/check`) return await check(req, b, at);
      if (path === `${base}/passkey`) return await passkeySignin(req, b, at);
      if (path === `${base}/passkey/link`) return await link(req, b, at);
      if (path === `${base}/passkey/unlink`) return await unlink(req, b, at);
      if (path === `${base}/passkeys`) return await list(req, at);
      return await start(req, b, at);
    } catch (e) {
      report(e);
      return fail(500, "Something went wrong. Try again.");
    }
  }

  return {
    base,
    handle,
    session: sessionOf,
    signOut,
    signOutEverywhere: () => store.signOutEverywhere(),
    recentLogins: (n) => store.recentLogins(n),
    clean: (at = now()) => store.clean(at),
  };
}
