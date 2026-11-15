// "@nano133/nanoterra/connect": Sign in from Nanoterra, the code exchange of nano133.com (its docs/agents/launch.md, "Signed-in Play" and "The
// arrival field"), for a game with a server. The game starter's src/worker/nanoterra.ts (origin/main 5409723), moved into the package with every
// check unchanged, and with the stricter checks of Nano Arcade's copy where the two differed (README, "Nanoterra connect"; each difference is
// named where it is made: "Arcade's"). The game gives only what is its own (`ConnectOptions`): the client id and the secret, how it makes its own
// session for the proved address (`signIn`), how it reads the session it has (`session`), its "works once" store (`once`), and its words or screens.
//
// A player who is signed in at nano133.com and agreed on its card
// presses Play and arrives at GET /nanoterra/start on THIS site. The start route makes a STATE (random text), keeps it in a cookie of
// THIS browser and sends the browser to nano133.com's authorize address with the client id and the state. Nanoterra answers with a
// redirect to GET /nanoterra/callback?code=...&state=... (the code is good for 60 seconds, once, and was made for that state). The
// callback accepts the state ONLY when it equals this browser's cookie: a link that someone else made carries a state that is not in
// the victim's cookie, so it is refused before anything is traded (login CSRF). The Worker then trades the code for the player's
// details with a call from the server, with its client id, its client secret (NANOTERRA_SECRET) and the state, and makes its own
// session for the address that Nanoterra named. The state cookie works once: every answer of the callback after the state matched drops it.
//
// The callback does NOT sign the player in by itself. Anyone can send a victim a callback link that holds the attacker's own
// code, and a victim who opens it would land signed in as the attacker (login CSRF). So the callback only shows a screen:
// "Sign in as <name>? Continue / Not me". A session is made only when the player presses Continue (POST /nanoterra/confirm),
// and that press must carry the cookie the callback set in THIS browser (signed, 5 minutes, SameSite=Lax: another site's
// form cannot send it) from the same origin, and the `bind` field of THIS screen (so a second callback that replaced the cookie
// after the screen was drawn is not signed in by the press on the old screen). A pending cookie works once. "Not me"
// (POST /nanoterra/cancel) drops the cookie and uses the token up.
//
// THE PRESS (2026-11-13; nano133.com's docs/agents/launch.md, "The arrival field"): when nano133.com's token answer says `arrival: "press"` (the
// player pressed Play for this game in this browser a moment ago, and our start route passed nano133.com's press probe), the screen is skipped:
// with no session here, or a session for the SAME address, the player goes straight to the game. With a session for ANOTHER account the screen
// asks "Switch to <name>?" (Switch / Stay), with the same pending cookie, `bind` field and once-only rules as Continue / Not me. In any doubt (no
// field, any other value, a session that cannot be read, a fault) the screen is the old "Sign in as <name>?". The press says nothing about which
// browser opens this callback: only the state cookie binds the code to this browser, so the press is read only AFTER the state check, and the
// state cookie must keep its rules (a `__Host-` name, HttpOnly, SameSite=Lax, 10 minutes, deleted after one use, 128 random bits).
//
// What this proves: Nanoterra says this player is signed in there and agreed to this game. It proves no key and no payment, so
// a session made here (`via: "nanoterra"`) must never open the game's admin. The secret stays on the server: never put it in a
// page, a log or a message. DO NOT CHANGE the checks in this file: the conformance suite (./conformance.ts) holds each one.

import { unpackRecord } from "../character/record.js";
import { validAddress } from "../shop/address.js";
import { errorHtml, pageHeaders, shortAddress, signInHtml, switchHtml, type ConnectErrorKey, type ConnectScreens } from "./screens.js";

/** nano133.com: the only site that a live game trades codes with. */
export const NANOTERRA_SITE = "https://nano133.com";
/** nano133.com's authorize route (the start route sends the browser here) and its token route (the server trades the code here). */
export const AUTHORIZE_PATH = "/api/nanoterra/authorize";
export const TOKEN_PATH = "/api/nanoterra/token";
/** The game's four routes. nano133.com builds the first two next to the play address (for the usual play address, the root of the game's origin). */
export const CONNECT_PATHS = { start: "/nanoterra/start", callback: "/nanoterra/callback", confirm: "/nanoterra/confirm", cancel: "/nanoterra/cancel" } as const;
/** A code is 32 random bytes in base64url. */
const CODE = /^[A-Za-z0-9_-]{43}$/;
const LOOK_PARTS = ["skin", "hair", "shirt", "pants", "shoes"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
/**
 * The token route's answer, in bytes, read with a bound (Arcade's: the body is never held whole past it). The starter's bound was 4096 characters,
 * read whole first; the answer carries the owned cosmetics (`items`, about 2 KB today), which grow with the catalogue, so 4 KB would refuse a player
 * with many of them one day.
 */
export const ANSWER_MAX = 32 * 1024;
/** nano133.com's client id (`ng_` and 20 hex digits) and its secret (at most 100 characters): Arcade's. Anything else is "not set up". */
const CLIENT_ID = /^ng_[0-9a-f]{20}$/;
const SECRET_MAX = 100;
/**
 * The client secret as nano133.com makes it (its app/nanoterra/signin/secret.server.ts, `newSecret`: "ns_" and 32 random bytes in base64url, 43
 * characters), at most 100 characters in all (its SECRET_MAX). The secret is also the pending cookie's key (`signingKey` changes that): a short or
 * made-up secret would let anyone sign a pending cookie for any address. So a secret of another shape is a setup error, never "not set up".
 */
const SECRET_SHAPE = /^ns_[A-Za-z0-9_-]{43,97}$/;
/**
 * Placeholders that have the right shape ("ns_" and 43 x's, a word typed again and again) are refused too: 43 random base64url characters hold 16
 * or more different characters in all but about 1 of 10^13 secrets; a typed placeholder holds far fewer.
 */
const SECRET_KINDS = 16;
/** A game's own `signingKey`: at least 32 characters, and 8 or more different ones (32 random hex digits have fewer in about 1 of 3 x 10^7 keys). */
export const SIGNING_KEY_MIN = 32;
const SIGNING_KEY_KINDS = 8;
const kinds = (s: string) => new Set(s).size;
/** True for a client secret of the shape nano133.com makes (the rule above). Spaces around it are dropped first, as the setup does. */
export const strongSecret = (secret: string): boolean => {
  const s = secret.trim();
  return SECRET_SHAPE.test(s) && kinds(s.slice(3)) >= SECRET_KINDS;
};
/** True for a pending-cookie key a game may give (`signingKey`): at least 32 characters, 8 or more of them different. */
export const strongSigningKey = (key: string): boolean => typeof key === "string" && key.length >= SIGNING_KEY_MIN && kinds(key) >= SIGNING_KEY_KINDS;
/** A setting that would let someone forge a sign-in: thrown by `createConnect`. Its message names the setting, never its value. */
export class ConnectSetupError extends Error {
  override name = "ConnectSetupError";
}
const WEAK_SECRET =
  'connect: the client secret is not one that nano133.com made ("ns_" and 43 letters, digits, "-" or "_"). Copy it again from Launch (make a new one if it is lost). For a local dev server only, set `localDevSecret: true`.';
const WEAK_KEY = "connect: `signingKey` must be at least 32 characters of random text (8 or more different characters). For a local dev server only, set `localDevSecret: true`.";
// Names and texts from nano133.com that hold a control or direction character are refused (Arcade's): they could hide or reorder words on a screen.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
export const CALLBACK_LIMIT = { limit: 20, windowMs: 60_000 };
/**
 * The cookie that holds the state this browser started with, and how long the player has to come back (10 minutes). Its name on the live game is
 * `__Host-nanoterra-state` (Secure, Path=/, no Domain, HttpOnly, SameSite=Lax): no sibling subdomain or parent domain can plant it, and the plain
 * name is read only on a local dev server (`setCookie`, `readCookie`, `localDev` below).
 */
export const STATE_COOKIE = "nanoterra-state";
export const STATE_SECONDS = 600;
/** A state is random text of our own making, or the same shape from Nanoterra's redirect: 16 to 128 letters, digits, "-" or "_". */
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
/**
 * The state's random bytes: 24 (192 bits, 32 base64url characters; Arcade's). The starter made 16 bytes in hex (128 bits, also 32 characters). Both
 * pass nano133.com's press probe (at least 128 bits); the stronger one is kept.
 */
const STATE_BYTES = 24;
/** The cookie that waits for the player's Continue, and how long it lives (the player has 5 minutes to press it). */
export const PENDING_COOKIE = "nanoterra-pending";
export const PENDING_SECONDS = 300;
/** A pending cookie is used once: its id is counted in the game's "once" store in the window of its own deadline (D1: `hits`, 10-minute windows). */
export const ONCE_WINDOW_MS = 10 * 60_000;
/** Put in front of what is signed, so a signature made here is good for nothing else. (Exported for the package's own tests; not in the index.) */
export const PENDING_LABEL = "@nano133/nanoterra connect: a Nanoterra sign-in waits for a press, v1";
/** The longest pending cookie read (Arcade's; the starter's was 512: the cookie now carries the name, the look and the record, never the items). */
export const PENDING_MAX = 1024;
/** The pending cookie's key with `localDevSecret`: random, new in each process, never the weak secret, so nobody can forge a cookie with it. */
let localDevKey: string | undefined;
const text = new TextEncoder();

export type Look = Record<(typeof LOOK_PARTS)[number], string>;
/** The player's whole character as Nanoterra sends it: the two numbers of `packRecord`, each a whole number on the closed lists (`unpackRecord` reads them). */
export type PackedRecord = [number, number];
/** What Nanoterra sends for a signed-in player. `playerId` is the address now: use the address. `record`: null for a sign-in from before Nanoterra sent it, or one that is not whole. */
export type Player = { username: string; address: string; look: Look; record: PackedRecord | null; items: string[] };
/** The token answer: the player, and `press`, true only when the answer says `arrival: "press"` (pressOf). */
export type Exchanged = Player & { press: boolean };
/**
 * The player that `signIn` gets. `items` (the owned cosmetics) is there only on a press with no screen. After a screen (Continue, Switch) it is
 * undefined, never `[]`: the pending cookie does not hold the items, so the kit does not know them then. A game that keeps the items keeps them in
 * `keep`, which runs after every exchange with the whole answer.
 */
export type SignInPlayer = Omit<Player, "items"> & { items?: string[] };

/**
 * True only when the token answer has `arrival` and it is exactly the string "press" (launch.md, "The arrival field": any other value, a value of
 * another type, or no key at all is no press). An older nano133.com, a start that was not a press, and a game that has not passed the press
 * probe all come with no field: the old screen.
 */
export function pressOf(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return (v as { arrival?: unknown }).arrival === "press";
}

/** The answer of Nanoterra's token call, read strictly: anything of another shape is null. */
export function readPlayer(v: unknown): Player | null {
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const { username, address, playerId, character } = o as { username?: unknown; address?: unknown; playerId?: unknown; character?: unknown };
  if (typeof username !== "string" || !username.trim() || username.length > 60 || CONTROL.test(username)) return null;
  // The starter checked the address with @nano133/signin's validAddress (the "nano_" prefix only, and the checksum); this package's own check
  // (the shop's, with no other package) also takes "xrb_", so the prefix is checked here first.
  if (typeof address !== "string" || !address.startsWith("nano_") || !validAddress(address) || playerId !== address) return null;
  const c = character as { v?: unknown; look?: unknown; record?: unknown; items?: unknown } | null;
  if (!c || c.v !== 1 || !c.look || typeof c.look !== "object" || !Array.isArray(c.items)) return null;
  const look = {} as Look;
  for (const part of LOOK_PARTS) {
    const colour = (c.look as Record<string, unknown>)[part];
    if (typeof colour !== "string" || !HEX.test(colour)) return null;
    look[part] = colour;
  }
  const items = c.items.slice(0, 64).filter((id): id is string => typeof id === "string" && id.length <= 48 && /^[a-z0-9.-]+$/.test(id));
  return { username: username.trim(), address, look, record: packedOf(c.record), items };
}

/** The character's record from Nanoterra's `{ v: 2, k: [a, b] }`, or null when it is not there or not whole (the game then uses the five colours): never trusted without the lists. */
export function packedOf(record: unknown): PackedRecord | null {
  const r = record as { v?: unknown; k?: unknown } | null;
  if (!r || typeof r !== "object" || r.v !== 2 || !Array.isArray(r.k) || r.k.length !== 2) return null;
  return unpackRecord(r.k[0], r.k[1]) ? [r.k[0] as number, r.k[1] as number] : null;
}

/** A body of at most `max` bytes, or null: it stops reading at the bound, so a larger answer is never held whole (Arcade's). */
async function boundedText(res: { headers: Headers; body: ReadableStream<Uint8Array> | null }, max: number): Promise<string | null> {
  if (Number(res.headers.get("content-length") ?? 0) > max) return null;
  if (!res.body) return "";
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** What the exchange needs: the client id, the secret and the site to trade with (nano133.com, or a local stand-in in a test). */
export type ConnectSetup = { clientId: string; secret: string; site: string };

/**
 * The lines this flow logs: a fixed message, and at most the token route's status or an error's NAME. Never a code, a state, a cookie, the secret or
 * an error's message (a fault's message may hold an address).
 */
export type ConnectLog = (message: string, detail?: { status?: number; error?: string }) => void;
/** The starter's log lines, as it wrote them. */
export const consoleLog: ConnectLog = (message, detail) => {
  if (detail?.status !== undefined) console.warn(`Nanoterra sign-in: ${message}`, detail.status);
  else console.warn(`Nanoterra sign-in: ${message}`);
};
const errorName = (e: unknown) => (e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : "error");

/** Trades the code for the player's details: one call from this server. Null for every refusal and every fault. */
export async function exchangeCode(setup: ConnectSetup, code: string, state: string, fetcher: typeof fetch = fetch, log: ConnectLog = consoleLog): Promise<Exchanged | null> {
  try {
    const res = await fetcher(`${setup.site}${TOKEN_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: setup.clientId, client_secret: setup.secret, code, state }),
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      log("the exchange was refused", { status: res.status });
      return null;
    }
    const text = await boundedText(res, ANSWER_MAX);
    if (text === null) {
      log("the answer was too large");
      return null;
    }
    const answer = JSON.parse(text) as unknown;
    const player = readPlayer(answer);
    return player ? { ...player, press: pressOf(answer) } : null;
  } catch (e) {
    log("the exchange failed", { error: errorName(e) });
    return null;
  }
}

// The starter's hash and random helpers (its src/worker/http.ts). Web APIs only: they run in Workers and in Node 20 or later.
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", text.encode(value)));
}
function randomHex(bytes: number): string {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (v: string) => Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** A new state: STATE_BYTES random bytes from crypto.getRandomValues, in base64url (Arcade's). */
export const newState = () => b64url(crypto.getRandomValues(new Uint8Array(STATE_BYTES)));

/** True when the two texts are the same: their hashes are compared with no early exit, so the time says nothing about where they differ. */
export async function sameText(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ---- The pending cookie ----------------------------------------------------------------------------------------------------------------

const hmacKey = (key: string, usage: ("sign" | "verify")[]) => crypto.subtle.importKey("raw", text.encode(key), { name: "HMAC", hash: "SHA-256" }, false, usage);

/**
 * The cookie value that waits for a press: what Nanoterra said (the address, the name, the look and the record: never the items), a deadline and an
 * id, signed with `key` (the game's signing key, else its client secret). The starter's held the address alone and kept the rest in its own table at
 * the callback; Arcade's held these four, so that its sign-in can use them only after the press. Both are read again with readPlayer's care.
 */
export async function pendingToken(key: string, player: Player, now: number): Promise<string> {
  const payload = b64url(text.encode(JSON.stringify({ a: player.address, n: player.username, l: player.look, r: player.record, exp: now + PENDING_SECONDS * 1000, j: randomHex(12) })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(key, ["sign"]), text.encode(`${PENDING_LABEL}\n${payload}`)));
  return `${payload}.${b64url(sig)}`;
}

/** The field of the confirm screen that ties a press to the cookie the screen was made with. It is a hash: the token itself never goes into the page. */
export const bindOf = async (token: string): Promise<string> => (await sha256Hex(token)).slice(0, 32);

/** A pending sign-in: what the cookie holds. Its player has no `items` (the cookie never holds them: `SignInPlayer`). */
export type Pending = { player: SignInPlayer; id: string; exp: number; token: string };

/** This browser's pending cookie, if it is signed with this key and has not run out; null for anything else. `origins`: as in `readCookie`. */
export async function readPending(key: string, req: Request, now: number, origins?: readonly string[]): Promise<Pending | null> {
  const token = readCookie(req, PENDING_COOKIE, origins);
  if (!token || token.length > PENDING_MAX) return null;
  const [payload, sig, more] = token.split(".");
  if (!payload || !sig || more !== undefined) return null;
  try {
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(key, ["verify"]), unb64url(sig), text.encode(`${PENDING_LABEL}\n${payload}`)))) return null;
    const v = JSON.parse(new TextDecoder().decode(unb64url(payload))) as { a?: unknown; n?: unknown; l?: unknown; r?: unknown; exp?: unknown; j?: unknown };
    const read = readPlayer({ username: v.n, address: v.a, playerId: v.a, character: { v: 1, look: v.l, record: Array.isArray(v.r) ? { v: 2, k: v.r } : null, items: [] } });
    if (!read || typeof v.exp !== "number" || v.exp < now || typeof v.j !== "string" || !/^[0-9a-f]{24}$/.test(v.j)) return null;
    // The items are not in the cookie: the player goes on with no `items` key at all, never an empty list that looks real (F4 of the review).
    const { items: _none, ...player } = read;
    return { player, id: v.j, exp: v.exp, token };
  } catch {
    return null;
  }
}

/** The `bind` field of the press's small form body, or "" (Arcade's: the body is read with a bound, and a body of another kind has no bind). */
async function bindField(req: Request): Promise<string> {
  try {
    const body = await boundedText(req, 1024);
    return body === null ? "" : (new URLSearchParams(body).get("bind") ?? "");
  } catch {
    return "";
  }
}

// ---- The checks of a request ---------------------------------------------------------------------------------------------------------

/**
 * True only for a press from this game's own page (Arcade's `ownOriginPost`): Sec-Fetch-Site, when sent, is exactly "same-origin", and the Origin
 * header is exactly this site's (the request's own origin, or one of `origins`, the game's public origins, for a server behind a proxy that does not
 * see its own https address); never compared by its start. With NO Origin header, only Sec-Fetch-Site "same-origin" lets it through (the starter's
 * rule): a browser that hides its Origin (Firefox with `network.http.sendOriginHeader` at 0) still sends that header, and a page cannot set it (a
 * forbidden header). With no Origin and no Sec-Fetch-Site, or any other Sec-Fetch-Site, it is refused.
 */
export function ownOrigin(req: Request, origins?: readonly string[]): boolean {
  const site = req.headers.get("Sec-Fetch-Site");
  const origin = req.headers.get("Origin");
  if (site !== null && site !== "same-origin") return false;
  if (origin === null) return site === "same-origin";
  return origins && origins.length ? origins.includes(origin) : origin === new URL(req.url).origin;
}

/**
 * Where the player goes after a sign-in, a press of Not me or Stay, and as a guest: a path on THIS site, fixed by the game's code (never from a
 * request: no open redirect). "/" by default. Anything else (another site, "//host", a backslash, a space or a control character) throws.
 */
export function afterPath(after = "/"): string {
  const ok = typeof after === "string" && /^\/(?![/\\])[^\s\\]*$/.test(after) && !CONTROL.test(after) && new URL(after, "https://game.test").origin === "https://game.test";
  if (!ok) throw new TypeError("connect: `after` must be a path on this site, like \"/\" or \"/play\"");
  return after;
}

/** The site to trade with: nano133.com, or (a test or a local dev server only) a stand-in on this computer. Null for anything else: not set up. */
export function siteOf(site: string | undefined): string | null {
  if (site === undefined || site === NANOTERRA_SITE) return NANOTERRA_SITE;
  try {
    const u = new URL(site);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    return (u.protocol === "http:" || u.protocol === "https:") && local && u.origin === site.replace(/\/+$/, "") ? u.origin : null;
  } catch {
    return null;
  }
}

/** The client id and the secret as nano133.com makes them, and the site; null while the game is not set up. */
export function setupOf(clientId: string | undefined, secret: string | undefined, site?: string): ConnectSetup | null {
  const id = (clientId ?? "").trim();
  const s = (secret ?? "").trim();
  const to = siteOf(site);
  return to && CLIENT_ID.test(id) && s && s.length <= SECRET_MAX ? { clientId: id, secret: s, site: to } : null;
}

// ---- The routes ------------------------------------------------------------------------------------------------------------------------

/** The account this browser is signed in as at the game: its address (or the game's own account id), and its name for "Switch to <name>?". */
export type ConnectSession = { address: string; name?: string };
/** The game's "works once" store: true the first time an id is used, false every other time. `until` is the pending cookie's deadline (ms). */
export type ConnectOnce = (id: string, until: number, use: "confirm" | "cancel") => Promise<boolean>;
/** How the player is being signed in: a press with no screen, or a press of Continue or Switch; `id` names this sign-in (24 hex digits). */
export type ConnectHow = { via: "press" | "confirm"; id: string };
export type ConnectScope = "start" | "callback" | "confirm";

export type ConnectOptions = {
  /** The client id that Nanoterra gave the game (a setting). */
  clientId: string | undefined;
  /** The client secret that Nanoterra showed once (a secret: read it from the game's secret store, never from a file in the repository). */
  secret: string | undefined;
  /** Tests and a local dev server only: a stand-in for nano133.com on this computer. Anything else is "not set up". */
  site?: string;
  /** The game's "works once" store (`createD1Once`, `createFirestoreOnce`, `createMemoryOnce`). */
  once: ConnectOnce;
  /**
   * Makes the game's OWN session for the address that Nanoterra proved, and gives its Set-Cookie value(s); or gives a page instead (a rule of the game
   * said no: the page is sent with this flow's cookies dropped). The session must say it came from Nanoterra (`via: "nanoterra"`): it proves no key, so
   * it never opens the game's admin.
   */
  signIn: (req: Request, player: SignInPlayer, how: ConnectHow) => Promise<string | string[] | Response>;
  /** The session this browser has at the game, or null. Without it a press never skips the screen ("in any doubt, the screen"). */
  session?: (req: Request) => Promise<ConnectSession | null>;
  /** Whether the session here is the account Nanoterra named (default: the same address). */
  same?: (here: ConnectSession, player: Player) => boolean | Promise<boolean>;
  /** Keeps what Nanoterra said about the player, after the exchange and before any screen (the starter's `nanoterra_players` row). */
  keep?: (player: Player, req: Request) => Promise<void>;
  /** A rule of the game's own, after the exchange and before the press is read: a page or a redirect to answer instead, or null to go on. */
  arrived?: (req: Request, player: Player) => Promise<Response | null>;
  /** The game's switch (the admin's "sign-in from Nanoterra"): while false, start, callback and confirm answer "is off". Not me always works. */
  enabled?: (req: Request) => boolean | Promise<boolean>;
  /** The limit of each route: true to go on. Default: 20 a minute for a visitor, in memory (the starter's). */
  limit?: (scope: ConnectScope, req: Request) => boolean | Promise<boolean>;
  /** The visitor of the default limit (default: CF-Connecting-IP, an IPv6 address by its /64). */
  visitor?: (req: Request) => string;
  /** The path the player goes to after (default "/"): a path on this site, fixed in the game's code. */
  after?: string;
  /**
   * The game's public origins, for a server that does not see its own https address (Node behind a proxy). Default: the request's origin. When set,
   * they decide the cookies' names, never the request's Host header: plain names only when EVERY origin is plain http on localhost, else `__Host-`.
   */
  origins?: readonly string[];
  /** The pending cookie's key (default: the client secret itself). At least 32 characters of random text. A new key ends every pending screen. */
  signingKey?: string;
  /**
   * A local dev server only: accept a client secret or a `signingKey` that is not strong (a placeholder such as "dev"). It needs `site` (a stand-in
   * for nano133.com on this computer: a weak secret can never trade with nano133.com), else it throws; with `origins` that name another site it throws
   * too. Every request that is not plain http on localhost, 127.0.0.1 or [::1] then gets a 500 page ("set up wrong"). It changes nothing for a strong
   * secret. Never needed in a test: use a strong test secret (`connectTestSecret` in "/connect/conformance").
   */
  localDevSecret?: boolean;
  screens?: ConnectScreens;
  log?: ConnectLog;
  fetch?: typeof fetch;
  now?: () => number;
};

export type Connect = {
  /** True when the client id, the secret and the site are set and well formed. */
  ready: boolean;
  start(req: Request): Promise<Response>;
  callback(req: Request): Promise<Response>;
  confirm(req: Request): Promise<Response>;
  cancel(req: Request): Promise<Response>;
  /** The answer of the route at the request's path (CONNECT_PATHS), or null for any other path. */
  handle(req: Request): Promise<Response | null>;
};

/** The starter's keys of its memory limits. */
const LIMIT_KEYS: Record<ConnectScope, string> = { start: "nanoterra-start", callback: "nanoterra", confirm: "nanoterra-confirm" };

const isOrigin = (x: unknown) => {
  try {
    return typeof x === "string" && new URL(x).origin === x;
  } catch {
    return false;
  }
};
/** A local dev server's origin: plain http on this computer (`localUrl`). */
const localOrigin = (origin: string) => localUrl(new URL(origin));

/**
 * The setting that would let someone forge a sign-in, or null: a client secret that is set but not of nano133.com's shape, or a `signingKey` that is
 * not strong. A missing secret is not one of them (the game is "not set up": 503). The message names the setting, never its value.
 */
export function connectSetupProblem(o: Pick<ConnectOptions, "secret" | "signingKey">): string | null {
  const secret = (o.secret ?? "").trim();
  if (secret && !strongSecret(secret)) return WEAK_SECRET;
  if (o.signingKey !== undefined && !strongSigningKey(o.signingKey)) return WEAK_KEY;
  return null;
}

export function createConnect(o: ConnectOptions): Connect {
  const after = afterPath(o.after);
  if (o.origins && !o.origins.every(isOrigin)) throw new TypeError('connect: each of `origins` is an origin, like "https://game.example"');
  // A weak secret or key fails closed (F1 of the review): a thrown error here, or, with `localDevSecret`, a 500 page for every request that is not
  // on a local dev server.
  const problem = connectSetupProblem(o);
  if (problem && !o.localDevSecret) throw new ConnectSetupError(problem);
  if (problem && o.origins?.length && !o.origins.every(localOrigin)) throw new ConnectSetupError("connect: `localDevSecret` works only on a local dev server, and `origins` names another site.");
  // A weak secret can never trade with nano133.com (it knows only the secrets it made), so a local dev server with one always trades with a stand-in
  // on this computer. Needing that stand-in too means a deployed game cannot take the opt-in by one setting alone.
  if (problem && (siteOf(o.site) === null || siteOf(o.site) === NANOTERRA_SITE)) throw new ConnectSetupError("connect: `localDevSecret` needs a stand-in for nano133.com on this computer (`site`, or NANOTERRA_ORIGIN on a Worker).");
  const setup = setupOf(o.clientId, o.secret, o.site);
  const key = o.signingKey ?? setup?.secret ?? "";
  const keyNow = () => (problem ? (localDevKey ??= randomHex(32)) : key);
  const s = o.screens ?? {};
  const origins = o.origins;
  const cookieOut = (req: Request, name: string, value: string, maxAgeSec: number) => setCookie(req, name, value, maxAgeSec, origins);
  /** With a weak secret or key (`localDevSecret`): true for a request that is not on a local dev server. */
  const refusedHere = (req: Request) => problem !== null && !localDev(req, origins);
  const log = o.log ?? consoleLog;
  const now = () => (o.now ? o.now() : Date.now());
  const visitor = o.visitor ?? visitorIp;
  const limit = o.limit ?? ((scope: ConnectScope, req: Request) => memoryLimit(`${LIMIT_KEYS[scope]}|${visitor(req)}`, CALLBACK_LIMIT.limit, CALLBACK_LIMIT.windowMs, now()));
  const fetcher: typeof fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const off = async (req: Request) => (o.enabled ? !(await o.enabled(req)) : false);

  /** A page for a sign-in that did not work, with a way into the game as a guest. */
  const page = (status: number, why: ConnectErrorKey, cookies: string[] = []): Response => {
    const headers = pageHeaders(s, "no-referrer");
    for (const c of cookies) headers.append("Set-Cookie", c);
    return new Response(errorHtml(s, why, status, after), { status, headers });
  };
  /** A weak secret or key on a request that is not on a local dev server: a 500 page that names no setting's value, and a fixed log line. */
  const setupWrong = (): Response => {
    log("the setup is wrong: a weak setting is used away from a local dev server");
    return page(500, "setupWrong");
  };
  const notAllowed = (allow: string) => new Response(JSON.stringify({ error: "Not allowed." }), { status: 405, headers: { "Content-Type": "application/json; charset=utf-8", Allow: allow, "Cache-Control": "no-store" } });
  /** To the game (`after`), with these cookies. */
  const go = (cookies: string[]): Response => {
    const headers = new Headers({ Location: after, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    for (const c of cookies) headers.append("Set-Cookie", c);
    return new Response(null, { status: 303, headers });
  };
  /** The game's own answer (a rule said no), with this flow's cookies dropped, never kept by a cache. */
  const withCookies = (res: Response, cookies: string[]): Response => {
    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", "no-store");
    for (const c of cookies) out.headers.append("Set-Cookie", c);
    return out;
  };
  const cookiesOf = (made: string | string[]) => (Array.isArray(made) ? made : [made]);

  /** A screen that waits for a press: the pending cookie is set and the state cookie dropped. */
  const pendingPage = async (req: Request, player: Player, clear: string[], current?: string): Promise<Response> => {
    const token = await pendingToken(keyNow(), player, now());
    const bind = await bindOf(token);
    const html = current === undefined ? signInHtml(s, player.username, player.address, bind, after) : switchHtml(s, player.username, current, bind, after);
    // "same-origin", not "no-referrer": with no-referrer a browser sends `Origin: null` on the form's POST, and confirm() would refuse
    // the player's own press. Another site still gets no Referer from this page, and its own POST here still carries its own Origin.
    const headers = pageHeaders(s, "same-origin");
    headers.append("Set-Cookie", cookieOut(req, PENDING_COOKIE, token, PENDING_SECONDS));
    // The state has done its work: it works once.
    for (const c of clear) headers.append("Set-Cookie", c);
    return new Response(html, { status: 200, headers });
  };

  /**
   * A press (`arrival: "press"`, read only after the state check): the answer with no screen, the "Switch to <name>?" screen, or null for "show the
   * old screen" (launch.md, "The arrival field", rules 4 and 5). No session here: a new one, and the game. A session for the same account: it stays
   * (a wallet session is never replaced by a weaker one), and the game. A session for another account: the switch screen. A fault (a session that
   * cannot be read, a store that fails), or a game that cannot read its session at all: null.
   */
  const pressArrival = async (req: Request, player: Player, clear: string[]): Promise<Response | null> => {
    if (!o.session) return null;
    try {
      const here = await o.session(req);
      if (here && !(await (o.same ? o.same(here, player) : here.address === player.address))) return await pendingPage(req, player, clear, here.name ?? shortAddress(here.address));
      if (here) return go(clear);
      const made = await o.signIn(req, player, { via: "press", id: randomHex(12) });
      return made instanceof Response ? withCookies(made, clear) : go([...cookiesOf(made), ...clear]);
    } catch (e) {
      log("the press could not be used", { error: errorName(e) });
      return null;
    }
  };

  /**
   * GET /nanoterra/start: where Nanoterra's Play key sends the player. It makes a STATE (`newState`: 24 random bytes, new at each start), keeps it in a
   * cookie of THIS browser (`__Host-`, HttpOnly, SameSite=Lax, 10 minutes) and redirects to nano133.com's authorize address with the client id and the
   * state. A new start in this browser replaces the cookie, and only the last state can come back.
   */
  async function start(req: Request): Promise<Response> {
    if (req.method !== "GET") return notAllowed("GET");
    if (refusedHere(req)) return setupWrong();
    if (await off(req)) return page(503, "off");
    if (!setup) return page(503, "notSetUp");
    if (!(await limit("start", req))) return page(429, "tooMany");
    const state = newState();
    const to = new URL(AUTHORIZE_PATH, setup.site);
    to.searchParams.set("client_id", setup.clientId);
    to.searchParams.set("state", state);
    const headers = new Headers({ Location: to.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    headers.append("Set-Cookie", cookieOut(req, STATE_COOKIE, state, STATE_SECONDS));
    return new Response(null, { status: 302, headers });
  }

  /**
   * GET /nanoterra/callback?code=...&state=...: trades the code for the player's details, keeps them (`keep`), and shows the confirm screen with a
   * cookie that waits for Continue. It makes NO session, except for a press (`pressArrival`: `arrival: "press"`, and no session here or one for
   * the same account). A bad or missing code is a 400 page, an unfinished setup a 503 page: each with a link to play as a guest.
   */
  async function callback(req: Request): Promise<Response> {
    if (req.method !== "GET") return notAllowed("GET");
    if (refusedHere(req)) return setupWrong();
    if (await off(req)) return page(503, "off");
    if (!setup) return page(503, "notSetUp");
    if (!(await limit("callback", req))) return page(429, "tooMany");
    const params = new URL(req.url).searchParams;
    const code = params.get("code") ?? "";
    if (!CODE.test(code)) return page(400, "badCode");
    // The state of the link must be the state THIS browser started with (its cookie). A link that someone else made has a state that is not in this
    // browser's cookie, and nothing is traded for it. The cookie is dropped in every answer from here on: a state works once. The token route gets
    // the state from the COOKIE, never the link's: so even a missed compare would fail at nano133.com.
    const state = params.get("state") ?? "";
    const kept = readCookie(req, STATE_COOKIE, origins) ?? "";
    const clear = [cookieOut(req, STATE_COOKIE, "", 0)];
    if (!STATE.test(state) || !STATE.test(kept) || !(await sameText(state, kept))) return page(400, "notHere", clear);
    const player = await exchangeCode(setup, code, kept, fetcher, log);
    if (!player) return page(400, "refused", clear);
    // What Nanoterra says about this address is kept now (it is that address's own data, and the exchange proved the code and the secret).
    if (o.keep) await o.keep(player, req);
    // The game's own rules (Arcade's: already signed in as that account, a key sign-in in use on another device). A fault: the old screen, and the
    // press is not used (in any doubt, the screen).
    let doubt = false;
    if (o.arrived) {
      let early: Response | null = null;
      try {
        early = await o.arrived(req, player);
      } catch (e) {
        doubt = true;
        log("the game's arrival rule failed", { error: errorName(e) });
      }
      if (early) return withCookies(early, clear);
    }
    // The press is read only here, after the state check and the exchange: in any doubt, the old screen.
    if (player.press && !doubt) {
      const done = await pressArrival(req, player, clear);
      if (done) return done;
    }
    return pendingPage(req, player, clear);
  }

  /**
   * POST /nanoterra/confirm: the player pressed Continue (or Switch). Needs the pending cookie of THIS browser (signed, not run out), a request from
   * this game's own page and the screen's `bind`; works once. Makes the session (`signIn`) and drops the pending cookie.
   */
  async function confirm(req: Request): Promise<Response> {
    if (req.method !== "POST") return notAllowed("POST");
    if (refusedHere(req)) return setupWrong();
    if (await off(req)) return page(503, "off");
    if (!setup) return page(503, "notSetUp");
    if (!ownOrigin(req, o.origins)) return page(403, "notOwnPage");
    if (!(await limit("confirm", req))) return page(429, "tooMany");
    // Every refusal from here on drops the pending cookie (Arcade's): a cookie that was refused once is never pressed again.
    const clear = [cookieOut(req, PENDING_COOKIE, "", 0)];
    const pending = await readPending(keyNow(), req, now(), origins);
    if (!pending) return page(400, "ranOut", clear);
    // The press must be from the screen that this cookie made: a second callback in this browser has replaced the cookie since the screen was drawn.
    if (!(await sameText(await bindField(req), await bindOf(pending.token)))) return page(400, "changed", clear);
    if (!(await o.once(pending.id, pending.exp, "confirm"))) return page(400, "used", clear);
    const made = await o.signIn(req, pending.player, { via: "confirm", id: pending.id });
    return made instanceof Response ? withCookies(made, clear) : go([...cookiesOf(made), ...clear]);
  }

  /** POST /nanoterra/cancel: the player pressed "Not me" (or Stay). Uses the pending token up, drops the cookie, makes no session, and goes to the game. */
  async function cancel(req: Request): Promise<Response> {
    if (req.method !== "POST") return notAllowed("POST");
    if (refusedHere(req)) return setupWrong();
    // From this game's own page only (Arcade's; the starter took it from anywhere): another site cannot spend a player's screen.
    if (!ownOrigin(req, o.origins)) return page(403, "notOwnPage");
    const pending = keyNow() ? await readPending(keyNow(), req, now(), origins) : null;
    if (pending) await o.once(pending.id, pending.exp, "cancel");
    return go([cookieOut(req, PENDING_COOKIE, "", 0)]);
  }

  async function handle(req: Request): Promise<Response | null> {
    const path = new URL(req.url).pathname;
    if (path === CONNECT_PATHS.start) return start(req);
    if (path === CONNECT_PATHS.callback) return callback(req);
    if (path === CONNECT_PATHS.confirm) return confirm(req);
    if (path === CONNECT_PATHS.cancel) return cancel(req);
    return null;
  }

  return { ready: setup !== null, start, callback, confirm, cancel, handle };
}

/**
 * The four routes of a game whose setup would let someone forge a sign-in (`connectSetupProblem`): each answers a 500 page ("set up wrong") that names
 * no value, with a fixed log line; `ready` is false. The Worker's adapter answers with it, because a Worker reads its secret at each request: there is
 * no start-up to throw at.
 */
export function setupWrongConnect(o: Pick<ConnectOptions, "screens" | "after" | "log">): Connect {
  const after = afterPath(o.after);
  const s = o.screens ?? {};
  const log = o.log ?? consoleLog;
  const answer = async (): Promise<Response> => {
    log("the setup is wrong: a weak setting");
    return new Response(errorHtml(s, "setupWrong", 500, after), { status: 500, headers: pageHeaders(s, "no-referrer") });
  };
  const handle = async (req: Request) => (Object.values(CONNECT_PATHS).includes(new URL(req.url).pathname as never) ? answer() : null);
  return { ready: false, start: answer, callback: answer, confirm: answer, cancel: answer, handle };
}

// ---- The memory limit and the visitor ----

// Moved from the starter's src/worker/ratelimit.ts (the memory layer) and src/worker/http.ts (visitorIp), unchanged.

const memory = new Map<string, { count: number; until: number }>();

/** True while `key` has made at most `limit` calls in this window (memory only). */
export function memoryLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const hit = memory.get(key);
  if (!hit || hit.until <= now) {
    if (memory.size > 5000) for (const [k, v] of memory) if (v.until <= now) memory.delete(k);
    memory.set(key, { count: 1, until: now + windowMs });
    return true;
  }
  hit.count += 1;
  return hit.count <= limit;
}

/** The visitor's IP address as Cloudflare saw it; an IPv6 address by its /64 (one home network). */
export function visitorIp(req: Request): string {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  return ip.includes(":") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;
}


// ---- Moved from the starter's src/worker/http.ts (the cookie helpers of this flow) ----

/** Only a space or a tab around a name or a value is dropped: JS `trim()` also drops U+00A0, U+3000 and other Unicode spaces, which would let a name that a browser sees as another name (" __Host-session") pass for the real one. */
const trimAscii = (s: string) => s.replace(/^[ \t]+|[ \t]+$/g, "");

export function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && trimAscii(part.slice(0, i)) === name) {
      try {
        return decodeURIComponent(trimAscii(part.slice(i + 1)));
      } catch {
        // A value that is not valid percent-coding is not ours: look at the next cookie.
      }
    }
  }
  return null;
}

/**
 * True only for a local dev server: plain http on this computer (`npm run dev`, `wrangler dev` on localhost or 127.0.0.1). A browser refuses a
 * Secure cookie on plain http, so only there do the sign-in cookies go without the `__Host-` prefix. Everywhere else (the game on https, and an
 * http request that reached a real host) they are `__Host-` names: no sibling subdomain and no parent domain can plant one, and the plain name
 * is never read (an http request to the live game gets no cookie it can use, so its sign-in fails).
 *
 * With `origins` (the game's public origins), the FIRST origin decides, never the request: on Node the request's address comes from the Host header,
 * and a proxy that sends `Host: localhost` must not turn the live game's cookies into plain names (F5 of the review).
 */
export function localDev(req: Request, origins?: readonly string[]): boolean {
  return origins && origins.length ? origins.every((x) => localUrl(new URL(x))) : localUrl(new URL(req.url));
}
/** Plain http on this computer: localhost, 127.0.0.1 or [::1]. */
const localUrl = (u: URL) => u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");

/** A cookie for this site only: the `__Host-` prefix and Secure (Path=/, no Domain), except on a local dev server (`localDev`). */
export function setCookie(req: Request, name: string, value: string, maxAgeSec: number, origins?: readonly string[]): string {
  const plain = localDev(req, origins);
  return `${plain ? "" : "__Host-"}${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${plain ? "" : "; Secure"}`;
}

/** A cookie that `setCookie` set: by its `__Host-` name, or by the plain name on a local dev server only. */
export function readCookie(req: Request, name: string, origins?: readonly string[]): string | null {
  return cookie(req, localDev(req, origins) ? name : `__Host-${name}`);
}
