// Read and check a Nanoterra sign-in ticket, in the player's browser. For a game on a STATIC site: no server to trade a one-time code.
//
// Nanoterra (nano133.com) opens the game's own address with the ticket after a `#`:  https://game.example/#nanoterra=<ticket>.
// A fragment is never sent to a server. `readTicket()` takes the ticket out of the address bar at once, checks its signature with
// nano133.com's public key and answers with the player's username, Nano address and character.
//
// WHAT A TICKET PROVES: that nano133.com said "this player, for this game, a moment ago". Anyone who sees the address can use the
// ticket until it runs out (two minutes), so it proves nothing to YOUR SERVER. Use it to show the player's name and character. Never
// give a sale, a prize or a score on a ticket alone: for that, use the code exchange (a server that holds a secret).
//
// Format (the same as nano133.com's receipts): base64url(JSON claims) "." base64url(Ed25519 signature over the first part).
// Web Crypto only (Ed25519: Chrome 137, Safari 17, Firefox 129, Node 20 and later). The one import is the character's record (the pure part of
// "@nano133/nanoterra/character/record": it imports no package, so a page that only reads a ticket loads no Three.js).
//
// THE CHARACTER IN A TICKET: `look` is the player's five colours (every ticket has them). `record` is the whole character (the base, face, hair,
// clothes, sizes and colours) as nano133.com keeps it, when the ticket carries one: a ticket from before the record has none, and then the answer
// has no `record` field at all and reads exactly as it did. `createCharacter({ record: ticket.record, look: ticket.look })` takes both.
import { unpackRecord, type LookRecord } from "../character/pure.js";

export const TICKET_PARAM = "nanoterra";
export const DEFAULT_KEYS_URL = "https://nano133.com/api/nanoterra/keys";
export const ISSUER = "nano133.com";
/** A ticket longer than this is not one. */
export const MAX_LENGTH = 4096;
/** A ticket lives this long (seconds). A longer life is refused. */
export const MAX_LIFE_SECONDS = 120;
/** A player's clock may be this far off (seconds), either way. */
export const SLACK_SECONDS = 60;

export type Look = { skin: string; hair: string; shirt: string; pants: string; shoes: string };
export type { LookRecord };

/** What a ticket says about the player. Times are in milliseconds since 1970. */
export type Ticket = {
  username: string;
  /** The player's whole Nano address. It is also the player's id. */
  address: string;
  look: Look;
  /** The player's whole character, when the ticket carries it (two numbers on the closed lists, read back: see `unpackRecord`). A ticket without one has no `record` at all. */
  record?: LookRecord;
  /** The Nanoterra cosmetics the player owns, in the island character's slots (catalogue ids). */
  items: string[];
  /** The game's id at nano133.com, and the origin the ticket is for. */
  game: string;
  audience: string;
  issuedAt: number;
  expiresAt: number;
  /** A random id of this ticket. */
  id: string;
};

/** One public key of GET https://nano133.com/api/nanoterra/keys (a JWK, RFC 8037: Ed25519). */
export type PublicKey = { kid: string; x: string; kty?: string; crv?: string; alg?: string; use?: string };
export type Keys = { keys: PublicKey[] };

export type Refusal =
  | "none" // no ticket in the address: a plain visit
  | "unsupported" // this browser has no Ed25519 in Web Crypto
  | "malformed" // not a ticket
  | "keys" // the public keys could not be read
  | "unknown-key" // signed with a key that is not in the list
  | "signature" // the signature does not hold
  | "wrong-kind" // signed right, but not a version 1 ticket from nano133.com
  | "audience" // a ticket for another origin
  | "expired"
  | "early" // issued in the future (a clock that is far off)
  | "life"; // asks for a life longer than a ticket may have
export type Result = { ok: true; ticket: Ticket } | { ok: false; reason: Refusal };

const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const ADDRESS = /^nano_[13][13-9a-km-uw-z]{59}$/;
const dec = new TextDecoder();
const enc = new TextEncoder();

function unb64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** The ticket in an address's fragment (`location.hash`), or null. Other fragment parts are left alone. */
export function ticketFromHash(hash: string): string | null {
  for (const part of hash.replace(/^#/, "").split("&")) {
    if (part.startsWith(`${TICKET_PARAM}=`)) {
      const value = part.slice(TICKET_PARAM.length + 1);
      return value.length <= MAX_LENGTH && TOKEN.test(value) ? value : null;
    }
  }
  return null;
}

/** The fragment without the ticket ("" when nothing else is in it, else "#" and the rest). */
export function hashWithoutTicket(hash: string): string {
  const rest = hash.replace(/^#/, "").split("&").filter((part) => !part.startsWith(`${TICKET_PARAM}=`) && part !== "");
  return rest.length ? `#${rest.join("&")}` : "";
}

/** How long the page waits for the keys (milliseconds). A slow nano133.com must not hold a game's first screen. */
export const KEYS_TIMEOUT_MS = 5000;

/** The public keys, as nano133.com publishes them (any origin may read them). `cache: "reload"` skips the browser's copy. Rejects after KEYS_TIMEOUT_MS. */
export async function fetchKeys(url: string = DEFAULT_KEYS_URL, fetcher: typeof fetch = fetch, cache: RequestCache = "default", timeoutMs: number = KEYS_TIMEOUT_MS): Promise<Keys> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), timeoutMs);
  try {
    const r = await fetcher(url, { credentials: "omit", cache, signal: stop.signal });
    if (!r.ok) throw new Error(`keys answered ${r.status}`);
    return readKeys(await r.json());
  } finally {
    clearTimeout(timer);
  }
}

function readKeys(j: Partial<Keys>): Keys {
  if (!j || !Array.isArray(j.keys)) throw new Error("keys: not a list");
  return { keys: j.keys.filter((k): k is PublicKey => !!k && typeof k.kid === "string" && typeof k.x === "string") };
}

export type VerifyOptions = {
  /** The origin this page is on, e.g. "https://game.example". A ticket for another origin is refused. */
  audience: string;
  keys: Keys;
  /** Milliseconds since 1970 (for tests). */
  now?: number;
  /** Web Crypto's `subtle` (for tests). */
  subtle?: SubtleCrypto;
};

type Claims = { v?: unknown; typ?: unknown; iss?: unknown; kid?: unknown; aud?: unknown; game?: unknown; sub?: unknown; name?: unknown; look?: unknown; record?: unknown; items?: unknown; iat?: unknown; exp?: unknown; jti?: unknown };

/** The record of a claim `{ v: 2, k: [a, b] }`, or null when there is none or it is not whole. */
function recordOf(claim: unknown): LookRecord | null {
  const c = claim as { v?: unknown; k?: unknown } | null;
  if (!c || typeof c !== "object" || c.v !== 2 || !Array.isArray(c.k) || c.k.length !== 2) return null;
  return unpackRecord(c.k[0], c.k[1]);
}

/** Checks a ticket: the key, the signature, the kind, the audience and the time. Never throws. */
export async function verifyTicket(token: string, o: VerifyOptions): Promise<Result> {
  const no = (reason: Refusal): Result => ({ ok: false, reason });
  if (typeof token !== "string" || token.length > MAX_LENGTH || !TOKEN.test(token)) return no("malformed");
  const subtle = o.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) return no("unsupported");
  const [body, sig] = token.split(".") as [string, string];
  let claims: Claims;
  try {
    claims = JSON.parse(dec.decode(unb64url(body))) as Claims;
  } catch {
    return no("malformed");
  }
  if (!claims || typeof claims !== "object" || typeof claims.kid !== "string") return no("malformed");
  const key = o.keys.keys.find((k) => k.kid === claims.kid);
  if (!key) return no("unknown-key");
  try {
    const publicKey = await subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: key.x }, { name: "Ed25519" }, false, ["verify"]);
    if (!(await subtle.verify("Ed25519", publicKey, unb64url(sig), enc.encode(body)))) return no("signature");
  } catch (e) {
    return no((e as { name?: string })?.name === "NotSupportedError" ? "unsupported" : "signature");
  }
  // The signature holds: the claims are nano133.com's. They still must be what a ticket is, for this page, now.
  if (claims.v !== 1 || claims.typ !== "ticket" || claims.iss !== ISSUER) return no("wrong-kind");
  if (claims.aud !== o.audience) return no("audience");
  const { iat, exp } = claims;
  if (typeof iat !== "number" || typeof exp !== "number") return no("malformed");
  const now = (o.now ?? Date.now()) / 1000;
  if (!(exp > now - SLACK_SECONDS)) return no("expired");
  if (!(iat < now + SLACK_SECONDS)) return no("early");
  if (!(exp - iat <= MAX_LIFE_SECONDS)) return no("life");
  const { sub, name, look, items, game, jti } = claims;
  const l = look as Record<string, unknown> | null;
  if (typeof sub !== "string" || !ADDRESS.test(sub) || typeof name !== "string" || !name || name.length > 60 || typeof game !== "string" || typeof jti !== "string") return no("malformed");
  if (!l || typeof l !== "object" || !(["skin", "hair", "shirt", "pants", "shoes"] as const).every((p) => typeof l[p] === "string" && COLOUR.test(l[p] as string))) return no("malformed");
  if (!Array.isArray(items) || items.length > 64 || !items.every((i) => typeof i === "string" && i.length <= 48)) return no("malformed");
  const clean: Look = { skin: l.skin as string, hair: l.hair as string, shirt: l.shirt as string, pants: l.pants as string, shoes: l.shoes as string };
  const ticket: Ticket = { username: name, address: sub, look: clean, items: [...(items as string[])], game, audience: claims.aud as string, issuedAt: iat * 1000, expiresAt: exp * 1000, id: jti };
  // The character's record is optional and read with care: a claim that is not two whole numbers on the closed lists is left out (the ticket is still good).
  const record = recordOf(claims.record);
  if (record) ticket.record = record;
  return { ok: true, ticket };
}

export type ReadOptions = {
  /** Pin the keys (no fetch). Else they are read from `keysUrl` once, and again when a ticket names a key that is not in the list. */
  keys?: Keys;
  keysUrl?: string;
  /** How long to wait for the keys (milliseconds): the default is KEYS_TIMEOUT_MS. */
  keysTimeoutMs?: number;
  /** The origin to expect. Default: this page's own origin. */
  audience?: string;
  location?: Pick<Location, "hash" | "pathname" | "search" | "origin">;
  history?: Pick<History, "replaceState" | "state">;
  fetch?: typeof fetch;
  now?: number;
  subtle?: SubtleCrypto;
};

let cached: Keys | null = null;

/**
 * Reads the ticket from this page's address, if there is one. FIRST it takes the ticket out of the address bar (the page's history
 * entry is replaced), so a reload, a copied link, a screenshot or a bookmark never carries it; then it checks the ticket. Call it once, when
 * the page loads. `{ ok: false, reason: "none" }` is a plain visit (no network call). Anything else that is not ok is a guest.
 *
 * Show "Sign in as <name>? Continue / Not me" before you treat the player as that name: anyone can send a link that holds their own ticket.
 */
export async function readTicket(o: ReadOptions = {}): Promise<Result> {
  const loc = o.location ?? globalThis.location;
  const hist = o.history ?? globalThis.history;
  if (!loc) return { ok: false, reason: "none" };
  // A ticket is taken out of the address bar FIRST, also one that is not a good ticket.
  if (!loc.hash.replace(/^#/, "").split("&").some((part) => part.startsWith(`${TICKET_PARAM}=`))) return { ok: false, reason: "none" };
  const token = ticketFromHash(loc.hash);
  if (hist) hist.replaceState(hist.state, "", loc.pathname + loc.search + hashWithoutTicket(loc.hash));
  if (!token) return { ok: false, reason: "malformed" };
  const audience = o.audience ?? loc.origin;
  const load = async (fresh: boolean): Promise<Keys | null> => {
    if (o.keys) return o.keys;
    if (cached && !fresh) return cached;
    try {
      cached = await fetchKeys(o.keysUrl, o.fetch, fresh ? "reload" : "default", o.keysTimeoutMs);
      return cached;
    } catch {
      return null;
    }
  };
  let keys = await load(false);
  if (!keys) return { ok: false, reason: "keys" };
  let result = await verifyTicket(token, { audience, keys, now: o.now, subtle: o.subtle });
  if (!result.ok && result.reason === "unknown-key" && !o.keys) {
    // nano133.com may have a new key since this page last read the list.
    keys = await load(true);
    if (!keys) return { ok: false, reason: "keys" };
    result = await verifyTicket(token, { audience, keys, now: o.now, subtle: o.subtle });
  }
  return result;
}

/** Forgets the keys read so far (for tests). */
export function forgetKeys(): void {
  cached = null;
}
