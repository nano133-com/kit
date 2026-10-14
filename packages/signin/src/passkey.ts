// The passkey purse, in the browser: a passkey gives the page 32 secret bytes (its PRF output), and those bytes
// become the seed of a Nano account, the purse. The purse then signs the sign-in message (./purse) and the server
// checks it (./signature). The server has no part in the passkey: no credential is kept and no assertion is
// checked; the proof of the account is the purse's signature. This file makes no request at all.
//
// THE SCHEME IS YOURS, AND IT IS FROZEN. A person's account (and any XNO in it) lies at the address that these
// exact bytes give:
//
//   PRF input   = UTF-8 scheme.input
//   seed        = HKDF-SHA-256(ikm = PRF output, salt = UTF-8 scheme.salt, info = UTF-8 scheme.info, 32 bytes)
//   account     = the seed as 64 hex characters, account 0 (./purse)
//
// Pick your scheme one time, write it in your code, and test it with fixed vectors (PRF output → seed → address).
// A change of one character makes another account for every person. A new scheme is a new versionByte with new
// texts, never an edit. No default is offered on purpose: a library default could change under you.
//
// A passkey belongs to one domain (its relying party id), so each site gets its own account for one person.
// Losing the passkey loses the purse: offer a spare key (the seed, written down) before any XNO goes in.

export type PasskeyScheme = {
  /** What the passkey is asked to evaluate, for example "example.com purse v1". */
  input: string;
  /** The HKDF salt, for example "example.com". */
  salt: string;
  /** The HKDF info, for example "example.com purse seed v1". */
  info: string;
  /** The first byte of each passkey's user id (1 for a first scheme): a use names its scheme by it. */
  versionByte: number;
};

export type PasskeyFault = "cancelled" | "no-prf" | "other-form" | "unsupported" | "not-a-purse" | "failed" | "wrong-host" | "exists" | "unstable" | "other-passkey";

/** A passkey call that did not give a purse. `code` says why; the words are the site's. */
export class PasskeyError extends Error {
  constructor(public code: PasskeyFault) {
    super(code);
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** The bytes the page asks the passkey to evaluate (`extensions.prf.eval.first`). */
export const prfInput = (scheme: PasskeyScheme) => utf8(scheme.input);

/** A new passkey's user id: the scheme's version byte, then 31 random bytes (it names no person and no address). */
export function newUserId(scheme: PasskeyScheme) {
  const id = new Uint8Array(32);
  crypto.getRandomValues(id);
  id[0] = scheme.versionByte;
  return id;
}

/** True when a passkey's user id (`userHandle`, returned at each use) is one of this scheme's. */
export function isSchemeUser(userHandle: ArrayBuffer | ArrayBufferView | null | undefined, scheme: PasskeyScheme) {
  if (!userHandle) return false;
  const b = userHandle instanceof ArrayBuffer ? new Uint8Array(userHandle) : new Uint8Array(userHandle.buffer, userHandle.byteOffset, userHandle.byteLength);
  return b.length === 32 && b[0] === scheme.versionByte;
}

/**
 * A passkey's PRF answer as 32 bytes in a buffer of their own, or null. STRICT on purpose. Two forms are read:
 * - a real buffer (an ArrayBuffer of this page or another, or a view of one) of exactly 32 bytes: the standard's form;
 * - a plain Array of exactly 32 whole numbers, each 0 to 255: the same 32 bytes written as a list (a password
 *   manager's extension answers so in place of the browser, seen in Chrome on a Mac).
 * Everything else is refused: a text in any encoding, an object with numbered keys, a list of another length or with
 * a hole, a fraction, minus zero, a number out of a byte's range, and an empty, a short or a constant answer. A purse
 * must never come from a guess at what a provider meant.
 */
export function prfBuffer(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value === null || typeof value !== "object") return null;
  let bytes: Uint8Array;
  try {
    if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else if (value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]") bytes = new Uint8Array(value as ArrayBuffer);
    else if (Array.isArray(value)) {
      if (value.length !== 32) return null;
      bytes = new Uint8Array(32);
      // Each place must be the list's OWN, is read once, and is checked by itself (`every` would skip a hole).
      for (let i = 0; i < 32; i++) {
        if (!Object.hasOwn(value, i)) return null;
        const n: unknown = value[i];
        if (typeof n !== "number" || !Number.isInteger(n) || Object.is(n, -0) || n < 0 || n > 255) return null;
        bytes[i] = n;
      }
    } else return null;
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  // 32 equal bytes are not a secret: a faulty provider that hands out a blank buffer would give everyone one purse.
  if (bytes.every((b) => b === bytes[0])) return null;
  return Uint8Array.from(bytes);
}

/** The purse's seed (64 upper-case hex characters) from a passkey's PRF output, by your frozen scheme. */
export async function seedFromPrf(prf: unknown, scheme: PasskeyScheme): Promise<string> {
  const ikm = prfBuffer(prf);
  if (!ikm) throw new PasskeyError("no-prf");
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: utf8(scheme.salt), info: utf8(scheme.info) }, key, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Can this browser make a passkey purse? "yes": it reports passkeys and the PRF extension. "no": it has no passkeys,
 * or reports no PRF. "unknown": it has passkeys and cannot say (older browsers): only a try will tell.
 */
export async function passkeySupport(): Promise<"yes" | "no" | "unknown"> {
  if (typeof window === "undefined" || !window.PublicKeyCredential || !navigator.credentials?.create) return "no";
  const pkc = window.PublicKeyCredential as typeof PublicKeyCredential & { getClientCapabilities?: () => Promise<Record<string, boolean | undefined>> };
  try {
    const caps = await pkc.getClientCapabilities?.();
    if (caps) {
      if (caps["extension:prf"] === true) return "yes";
      if (caps["extension:prf"] === false) return "no";
    }
  } catch {
    // Cannot say.
  }
  return "unknown";
}

/** The setup of every call. */
export type PasskeySetup = {
  /** The relying party id: your exact domain ("example.com"). Refuse to call on any other host. */
  rpId: string;
  /** The name the device shows for your site. */
  rpName: string;
  scheme: PasskeyScheme;
  /** The passkey's name in the device's list (at "make"), for example "example.com purse · 13 Oct 2026". */
  userName?: string;
  /** Ids (base64url) of passkeys this browser made or used: the device refuses a second one ("exists"). */
  exclude?: string[];
};

/** What a passkey gave: the purse's seed (64 hex) and the passkey's id (base64url). */
export type PasskeyPurse = { seed: string; credentialId: string };
/** A passkey that was just made and not used yet. Hold it until firstUse. */
export type NewPasskey = { rawId: ArrayBuffer; credentialId: string; atCreate: Uint8Array<ArrayBuffer> | null };

export const toB64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const challenge = () => crypto.getRandomValues(new Uint8Array(32));
type PrfResults = { enabled?: boolean; results?: { first?: unknown } };
const prfOf = (c: PublicKeyCredential) => (c.getClientExtensionResults() as { prf?: PrfResults }).prf;
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** A browser error as a PasskeyError. */
export function passkeyFault(e: unknown): PasskeyError {
  if (e instanceof PasskeyError) return e;
  const name = (e as { name?: string } | null)?.name;
  // The person closed the device's sheet, or it timed out. (Browsers use the same name for both.)
  if (name === "NotAllowedError" || name === "AbortError") return new PasskeyError("cancelled");
  // The device refused a second passkey: one of `exclude` is on it.
  if (name === "InvalidStateError") return new PasskeyError("exists");
  if (name === "SecurityError") return new PasskeyError("wrong-host");
  if (name === "NotSupportedError") return new PasskeyError("unsupported");
  return new PasskeyError("failed");
}

/** True when an answer that prfBuffer refused is a text, an object or a list (a provider's other form): it only names why. */
const otherForm = (v: unknown) => typeof v === "string" || Array.isArray(v) || (v !== null && typeof v === "object" && !ArrayBuffer.isView(v) && Object.prototype.toString.call(v) !== "[object ArrayBuffer]");

/** The 32 bytes a passkey gave at this use. Taken once and checked once: the bytes that become the purse are the bytes checked. */
function answerOf(cred: PublicKeyCredential): Uint8Array<ArrayBuffer> {
  const answer = prfOf(cred)?.results?.first;
  const first = prfBuffer(answer);
  if (!first) throw new PasskeyError(otherForm(answer) ? "other-form" : "no-prf");
  return first;
}

async function get(o: PasskeySetup, signal: AbortSignal | undefined, only?: ArrayBuffer): Promise<PublicKeyCredential> {
  const cred = (await navigator.credentials.get({
    signal,
    publicKey: {
      rpId: o.rpId,
      challenge: challenge(),
      userVerification: "required",
      allowCredentials: only ? [{ type: "public-key", id: only }] : [],
      extensions: { prf: { eval: { first: prfInput(o.scheme) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new PasskeyError("cancelled");
  return cred;
}

/**
 * Step 1 of "make": the device makes a discoverable passkey with user verification. No purse yet: firstUse makes
 * it. THE SEED ALWAYS COMES FROM A USE of the passkey, never from an answer at create: every later open is a use, and
 * nothing in WebAuthn says that a provider gives the same value at create. Remember `credentialId` at once (to
 * exclude it at the next "make"), before the first use.
 */
export async function makePasskey(o: PasskeySetup, signal?: AbortSignal): Promise<NewPasskey> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) throw new PasskeyError("unsupported");
  try {
    const name = o.userName ?? `${o.rpName} purse`;
    const cred = (await navigator.credentials.create({
      signal,
      publicKey: {
        rp: { id: o.rpId, name: o.rpName },
        user: { id: newUserId(o.scheme), name, displayName: name },
        challenge: challenge(),
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        attestation: "none",
        excludeCredentials: (o.exclude ?? []).map((id) => ({ type: "public-key" as const, id: fromB64url(id) })),
        extensions: { prf: { eval: { first: prfInput(o.scheme) } } } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
    if (!cred) throw new PasskeyError("cancelled");
    const prf = prfOf(cred);
    const answer = prf?.results?.first;
    const atCreate = prfBuffer(answer);
    if (!atCreate && otherForm(answer)) throw new PasskeyError("other-form");
    if (!prf?.enabled && !atCreate) throw new PasskeyError("no-prf");
    return { rawId: cred.rawId, credentialId: toB64url(cred.rawId), atCreate };
  } catch (e) {
    throw passkeyFault(e);
  }
}

/**
 * Step 2 of "make": the first use of the new passkey, and its purse. When the device also answered at create and
 * the two answers differ, no purse is made ("unstable"). `pick`: ask for ANY passkey of the site (a password manager
 * may not find a new passkey by its id a moment later); the answer counts only when it IS the new passkey.
 */
export async function firstUse(o: PasskeySetup, made: NewPasskey, signal?: AbortSignal, pick = false): Promise<PasskeyPurse> {
  try {
    const used = await get(o, signal, pick ? undefined : made.rawId);
    if (!same(new Uint8Array(used.rawId), new Uint8Array(made.rawId))) throw new PasskeyError("other-passkey");
    const atUse = answerOf(used);
    if (made.atCreate && !same(made.atCreate, atUse)) throw new PasskeyError("unstable");
    return { seed: await seedFromPrf(atUse, o.scheme), credentialId: made.credentialId };
  } catch (e) {
    throw passkeyFault(e);
  }
}

/** Uses a passkey the person already has and returns its purse. "not-a-purse": a passkey of the site of another scheme. */
export async function openPasskey(o: PasskeySetup, signal?: AbortSignal): Promise<PasskeyPurse> {
  if (typeof window === "undefined" || !window.PublicKeyCredential) throw new PasskeyError("unsupported");
  try {
    const cred = await get(o, signal);
    if (!isSchemeUser((cred.response as AuthenticatorAssertionResponse).userHandle, o.scheme)) throw new PasskeyError("not-a-purse");
    return { seed: await seedFromPrf(answerOf(cred), o.scheme), credentialId: toB64url(cred.rawId) };
  } catch (e) {
    throw passkeyFault(e);
  }
}
