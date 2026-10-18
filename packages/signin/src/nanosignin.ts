import { createHash, randomBytes } from "node:crypto";
import { validAddress, verifyBytes } from "./verify.js";
import { checkOf, WalletRefused, type RequestCheck, type RequestStore } from "./requests.js";

// Sign in with a wallet that speaks "nano-signin-v1": Berry Wallet does (2026-10), and any wallet may read the same
// request. No guide is published: the format below was read from the real app against a live site (2026-10-17),
// and the signature it sent was checked byte for byte (test/nanosignin.test.ts holds it).
//
// 1. The browser starts a request (startNanoSignin): a random id and nonce, tied to the browser's starter hash, at
//    most 5 minutes long (Berry refuses a longer one: "invalid sign-in lifetime"). Its links:
//      berrypay://signin?request_uri=<the request's address>   Berry Wallet
//      nano://signin?request_uri=<the request's address>       any wallet that reads the same request
// 2. The wallet GETs the request's address and reads nanoSigninRequest's JSON: the domain and page it signs in to,
//    the nonce, the network, when it was issued and when it expires, the id and the address itself.
// 3. When the person agrees, the wallet POSTs to the same address { protocol, requestId, address, signatureType:
//    "nano-ed25519-blake2b-sha256", message, signature }: `message` is exactly nanoSigninMessage(request, address)
//    and `signature` is Ed25519-BLAKE2b, by the account's key, over the SHA-256 of the message's UTF-8 bytes.
//    answerNanoSignin checks all of it and signs the request in, once.
// 4. The browser that started it asks (checkNanoSignin) and is signed in as `account` when `mine` is true.
//
// Reply to the wallet's POST with HTTP 204 and no body (NANO_SIGNIN_ACCEPTED) when it is accepted, and with HTTP
// 401 and nanoSigninRefusal(error.message) for a WalletRefused. The browser is signed in by the check, whatever the
// wallet shows of the reply.

export const NANO_SIGNIN_PROTOCOL = "nano-signin-v1";
export const NANO_SIGNIN_SIGNATURE = "nano-ed25519-blake2b-sha256";
/** The longest request a wallet takes (Berry Wallet refuses a longer lifetime). */
export const NANO_SIGNIN_MAX_MS = 5 * 60_000;
/** A request's id: 16 random bytes as lowercase hex (the form the wallets were seen with). */
export const NANO_SIGNIN_ID = /^[0-9a-f]{32}$/;

export type NanoSigninOptions = {
  /** The site's domain as the wallet shows it and signs it: "example.com". */
  domain: string;
  /** The page the person signs in to: "https://example.com/". */
  uri: string;
  store: RequestStore;
  /** How long a request takes a signature (default and most: 5 minutes). */
  ttlMs?: number;
  now?: () => number;
};

/** What a wallet reads from the request's address (GET): the same keys, in this order, as wallets were seen to read. */
export type NanoSigninRequest = {
  uri: string;
  nonce: string;
  domain: string;
  network: "nano:mainnet";
  issuedAt: string;
  protocol: typeof NANO_SIGNIN_PROTOCOL;
  requestId: string;
  requestUri: string;
  expirationTime: string;
};

export type NanoSigninStart = {
  id: string;
  /** Berry Wallet's link (berrypay://signin): the "Open Berry Wallet" button and its QR code. */
  link: string;
  /** Any wallet's link (nano://signin). */
  walletLink: string;
  expiresAt: number;
};

const ADDRESS = /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;
const SIGNATURE = /^[0-9a-fA-F]{128}$/;

const lifeOf = (o: Pick<NanoSigninOptions, "ttlMs">) => Math.min(NANO_SIGNIN_MAX_MS, Math.max(30_000, o.ttlMs ?? NANO_SIGNIN_MAX_MS));

/** The two links of a request whose address is `requestUri`. */
export function nanoSigninLinks(requestUri: string) {
  const q = `request_uri=${encodeURIComponent(requestUri)}`;
  return { berry: `berrypay://signin?${q}`, wallet: `nano://signin?${q}` };
}

/** The JSON a wallet reads for a stored request. `requestUrl(id)`: the request's public address. */
export function nanoSigninRequest(o: Pick<NanoSigninOptions, "domain" | "uri">, r: { id: string; nonce: string; issuedAt: number; expiresAt: number }, requestUrl: (id: string) => string): NanoSigninRequest {
  return {
    uri: o.uri,
    nonce: r.nonce,
    domain: o.domain,
    network: "nano:mainnet",
    issuedAt: new Date(r.issuedAt).toISOString(),
    protocol: NANO_SIGNIN_PROTOCOL,
    requestId: r.id,
    requestUri: requestUrl(r.id),
    expirationTime: new Date(r.expiresAt).toISOString(),
  };
}

/** The exact text a wallet signs for `request` and `address` (one line each, a blank line twice, a newline at the end). */
export function nanoSigninMessage(request: NanoSigninRequest, address: string) {
  return (
    `${request.domain} wants you to sign in with your Nano account:\n${address}\n\n` +
    "Sign in to this website. This does not authorize any transactions.\n\n" +
    `URI: ${request.uri}\nVersion: 1\nNetwork: ${request.network}\nNonce: ${request.nonce}\n` +
    `Issued At: ${request.issuedAt}\nExpiration Time: ${request.expirationTime}\n` +
    `Request ID: ${request.requestId}\nRequest URI: ${request.requestUri}\n`
  );
}

/**
 * Starts a request for the browser whose starter hash is `starter`. `requestUrl(id)`: your public route for this
 * request (the wallet GETs and POSTs it), on your own domain: `https://example.com/signin/nano/<id>`.
 */
export async function startNanoSignin(o: NanoSigninOptions, p: { starter: string; requestUrl: (id: string) => string }): Promise<NanoSigninStart> {
  const now = o.now?.() ?? Date.now();
  const id = randomBytes(16).toString("hex");
  const nonce = randomBytes(32).toString("hex");
  const expiresAt = now + lifeOf(o);
  await o.store.create(id, { id, starter: p.starter, status: "waiting", expiresAt, nonce, issuedAt: now });
  const links = nanoSigninLinks(p.requestUrl(id));
  return { id, link: links.berry, walletLink: links.wallet, expiresAt };
}

/** The request's JSON for the wallet's GET, or null when it is not known, was used or expired. */
export async function readNanoSignin(o: NanoSigninOptions, id: string, requestUrl: (id: string) => string): Promise<NanoSigninRequest | null> {
  if (!NANO_SIGNIN_ID.test(id)) return null;
  const r = await o.store.get(id);
  const now = o.now?.() ?? Date.now();
  if (!r || r.status !== "waiting" || now > r.expiresAt || typeof r.nonce !== "string" || typeof r.issuedAt !== "number") return null;
  return nanoSigninRequest(o, { id, nonce: r.nonce, issuedAt: r.issuedAt, expiresAt: r.expiresAt }, requestUrl);
}

/**
 * The wallet's answer (its POST) for request `id`. Returns the account it signed in; throws WalletRefused with what
 * to tell the person. Only exactly this request's message, signed by the account's own key, counts, once.
 */
export async function answerNanoSignin(o: NanoSigninOptions, id: string, body: Record<string, unknown>, requestUrl: (id: string) => string): Promise<string> {
  const now = o.now?.() ?? Date.now();
  const again = `Start again on ${o.domain}.`;
  if (!NANO_SIGNIN_ID.test(id)) throw new WalletRefused(`This sign-in is not known. ${again}`);
  if (body.protocol !== NANO_SIGNIN_PROTOCOL || body.requestId !== id) throw new WalletRefused("This answer is not for this sign-in.");
  if (body.signatureType !== NANO_SIGNIN_SIGNATURE) throw new WalletRefused("This wallet signs in a way this site does not read.");
  const address = String(body.address ?? "").toLowerCase();
  if (!ADDRESS.test(address) || !validAddress(address)) throw new WalletRefused("That is not a Nano address.");
  const signature = String(body.signature ?? "");
  if (!SIGNATURE.test(signature)) throw new WalletRefused("The signature does not match this wallet.");
  const r = await o.store.get(id);
  if (!r || typeof r.nonce !== "string" || typeof r.issuedAt !== "number") throw new WalletRefused(`This sign-in is not known. ${again}`);
  // A wallet may send the same answer again (Berry Wallet sent it 3 times when it did not read our reply): the same
  // account's valid answer to a request it already signed is answered as accepted again. It signs in no one new:
  // the browser that started the request is signed in by its own check, once.
  const repeat = r.status === "signedin" && r.account === address;
  if (r.status !== "waiting" && !repeat) throw new WalletRefused(`This sign-in was already used. ${again}`);
  if (now > r.expiresAt) throw new WalletRefused(`This sign-in expired. ${again}`);
  const expected = nanoSigninMessage(nanoSigninRequest(o, { id, nonce: r.nonce, issuedAt: r.issuedAt, expiresAt: r.expiresAt }, requestUrl), address);
  if (body.message !== expected) throw new WalletRefused("The signed text is not this sign-in's.");
  const digest = new Uint8Array(createHash("sha256").update(expected, "utf8").digest());
  if (!verifyBytes(address, digest, signature)) throw new WalletRefused("The signature does not match this wallet.");
  if (repeat) return address;
  if (!(await o.store.finish(id, address))) throw new WalletRefused(`This sign-in was already used. ${again}`);
  return address;
}

/** Where request `id` stands, for the browser that asks. `starter`: that browser's starter hash (gives `mine`). */
export async function checkNanoSignin(o: Pick<NanoSigninOptions, "store" | "now">, id: string, starter?: string): Promise<RequestCheck> {
  if (!NANO_SIGNIN_ID.test(id)) return { status: "expired" };
  const request = await o.store.get(id);
  return checkOf(request ? { key: id, request } : null, o.now?.() ?? Date.now(), starter);
}

/**
 * The HTTP status of the reply to an accepted answer, with no body. Berry Wallet shows its success screen for it; a
 * 200 with a JSON body (whatever it said) showed "The website could not accept this sign-in request" (2026-10-17,
 * the real app against nano133.com, one form per "Retry delivery").
 */
export const NANO_SIGNIN_ACCEPTED = 204;

/** The JSON body of the reply (HTTP 401) to a refused answer: the words for the person. */
export function nanoSigninRefusal(message: string) {
  return { error: true, statusCode: 401, message };
}
