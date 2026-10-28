import { createHash, randomBytes } from "node:crypto";
import { validAddress, verifyText } from "./verify.js";
import { checkOf, REQUEST_ID, WalletRefused, type RequestCheck, type RequestStore } from "./requests.js";

// Sign in with NanChat, with no payment: NanChat's "nanauth" request (its developer page,
// https://nanchat.com/developers/, and its public source; it has worked with the real app on nano133.com).
//
// 1. The browser starts one (startNanchat): a request with a random id for the browser's checks and a one-time
//    number (the nonce) for the wallet, tied to the browser's starter hash, and a link to nanchat.com that holds
//    the text to sign and where to post the answer.
// 2. NanChat shows "Login to <host>" and, when the person agrees, signs "Signed Message: " + the text with the
//    wallet's key and posts { account, signature, message } to your route, through its own relay server
//    (answerNanchat). So that request does not come from the person's device: every answer comes from one
//    address, and a rate limit per IP address is one limit for all NanChat users. Limit the total, and each nonce.
// 3. The browser that started it asks (checkNanchat) and is signed in as `account` when `mine` is true.
//
// The text holds the site's host as a setting (never from a request) and the nonce, and WE build the text that the
// signature is checked against: nothing of the posted message but its nonce is used. NanChat shows the reply's text
// under "Success" whatever it says, so a refusal must say so in its words (nanchatReply starts it "NOT signed in").

export type NanchatOptions = {
  /** The site's host exactly as people see it ("example.com"). NanChat refuses a text whose host is not the answer URL's. */
  host: string;
  store: RequestStore;
  /** How long a request takes a signature (default 5 minutes). */
  ttlMs?: number;
  now?: () => number;
};

/** NanChat puts this before the text that it signs, so that a signed text can never be a block. */
export const NANCHAT_PREFIX = "Signed Message: ";
const ADDRESS = /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text NanChat is asked to sign for a nonce. "Login to <host>" makes NanChat show its login sheet. */
export const nanchatMessage = (host: string, nonce: string) => `Login to ${host} nonce: ${nonce}`;

/** The store key of a request: a hash of its nonce (the answer names only the nonce). */
export const nanchatKey = (nonce: string) => sha(nonce);

/**
 * The link that opens NanChat (its universal link; a phone opens the app, a computer its web page), byte for byte
 * as its developer page builds it: the message and the answer URL each URL-encoded one time.
 */
export function nanchatLink(message: string, url: string) {
  return `https://nanchat.com/?uri=nanauth://sign?message=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`;
}

/** The nonce in a posted message (with or without NanChat's prefix: its page and its app differ), or null when it is not exactly our text. */
export function nanchatNonce(host: string, message: unknown): string | null {
  if (typeof message !== "string" || message.length > 200) return null;
  return new RegExp(`^(?:${escape(NANCHAT_PREFIX)})?Login to ${escape(host)} nonce: ([0-9a-f]{32})$`).exec(message)?.[1] ?? null;
}

export type NanchatStart = { id: string; link: string; expiresAt: number };

/** Starts a request for the browser whose starter hash is `starter`. `answerUrl`: your public route for NanChat's answer (no id, no secret in it). */
export async function startNanchat(o: NanchatOptions, p: { starter: string; answerUrl: string }): Promise<NanchatStart> {
  if (typeof o.host !== "string" || !o.host.trim()) throw new Error("set the site's host");
  const now = o.now?.() ?? Date.now();
  const id = randomBytes(18).toString("base64url");
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = now + (o.ttlMs ?? 5 * 60_000);
  await o.store.create(nanchatKey(nonce), { id, starter: p.starter, status: "waiting", expiresAt });
  return { id, link: nanchatLink(nanchatMessage(o.host, nonce), p.answerUrl), expiresAt };
}

/**
 * NanChat's answer. Returns the account it signed in; throws WalletRefused with what to tell the person. Only a
 * signature of exactly this request's text, by the account's own key, within its time, counts, once.
 */
export async function answerNanchat(o: NanchatOptions, body: Record<string, unknown>): Promise<string> {
  const now = o.now?.() ?? Date.now();
  const again = `Start again on ${o.host}.`;
  const account = typeof body.account === "string" ? body.account.toLowerCase() : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  // NanChat holds wallets of other networks too (ban_, usd_): only a whole Nano address is an account here.
  if (account.length > 65 || !ADDRESS.test(account) || !validAddress(account)) throw new WalletRefused("that is not a Nano address. Choose your Nano account in NanChat.");
  if (!/^[0-9A-Fa-f]{128}$/.test(signature)) throw new WalletRefused("the signature could not be read.");
  const nonce = nanchatNonce(o.host, body.message);
  if (!nonce) throw new WalletRefused(`the signed text is not a sign-in to ${o.host}.`);
  const key = nanchatKey(nonce);
  const rec = await o.store.get(key);
  if (!rec) throw new WalletRefused(`this sign-in is not known. ${again}`);
  if (rec.status !== "waiting") throw new WalletRefused(`this sign-in was already used. ${again}`);
  if (now > rec.expiresAt) throw new WalletRefused(`this sign-in expired. ${again}`);
  // The text is ours, built from the nonce: the posted message is not what is checked.
  if (!verifyText(account, NANCHAT_PREFIX + nanchatMessage(o.host, nonce), signature)) throw new WalletRefused("the signature does not match this wallet.");
  if (!(await o.store.finish(key, account))) throw new WalletRefused(`this sign-in was already used. ${again}`);
  return account;
}

/** Where the request with the browser's id `id` stands. `starter`: that browser's starter hash (gives `mine`). */
export async function checkNanchat(o: Pick<NanchatOptions, "store" | "now"> & { deliverMs?: number }, id: string, starter?: string): Promise<RequestCheck> {
  if (!REQUEST_ID.test(id)) return { status: "expired" };
  return checkOf(await o.store.find(id), o.now?.() ?? Date.now(), starter, o.deliverMs);
}

/**
 * The JSON body of your answer route's reply. NanChat shows its text whatever it says: a success says where the
 * sign-in landed (the person who agreed may not be the one whose browser asked), and a refusal starts "NOT signed in".
 */
export function nanchatReply(host: string, refusal?: string) {
  return refusal === undefined
    ? { ok: true, message: `Signed in to ${host}, in the browser that showed this request. If that was not your browser, sign in on ${host} yourself and sign the other one out.` }
    : { ok: false, error: `NOT signed in: ${refusal}` };
}
