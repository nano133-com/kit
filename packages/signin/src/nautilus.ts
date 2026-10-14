import { randomBytes } from "node:crypto";
import { validAddress, verifyBytes } from "./verify.js";
import { checkOf, REQUEST_ID, WalletRefused, type RequestCheck, type RequestStore } from "./requests.js";

// Sign in with Nautilus, with no payment: Nautilus's own "nanoauth" request. Nautilus publishes no guide for it:
// the format below was read in the app's source (2026-10-04) and has worked with the real app on nano133.com.
//
// 1. The browser starts one (startNautilus): a request with a random id and a short code, tied to the browser's
//    starter hash, and a `nanoauth:` link whose JSON names a label ("<site> sign-in <code>"), the site's Nano
//    address and where to post the answer (your route, with the id in its query).
// 2. Nautilus shows the label and, when the person agrees, signs the text "<seconds now>:<label>:<site address>"
//    with the wallet's key (Ed25519-BLAKE2b over its UTF-8 bytes, as a block hash is signed: verifyBytes) and
//    posts { account, signature, signed, formatted, message, label } to that URL (answerNautilus).
// 3. The browser that started it asks (checkNautilus) and is signed in as `account` when `mine` is true.
//
// The URL is not signed, so the code in the signed label is what ties a signature to one request. Each request
// takes one signature, for five minutes. Nautilus shows the reply's `message` when its `status` is not 0, and a
// generic error for any HTTP status but 200: answer every refusal with 200 and nautilusReply.

export type NautilusOptions = {
  /** The site's name as people see it ("example.com"): in the label, the request's message and every reply. */
  site: string;
  /** A Nano address of the site's own. Only named in the request and the signed text: no key is needed. */
  siteAddress: string;
  store: RequestStore;
  /** The line the app shows under the label (default: "Sign in to <site>. No payment: your wallet only signs this request."). */
  message?: string;
  /** How long a request takes a signature (default 5 minutes). */
  ttlMs?: number;
  /** How far the phone's clock may be from the server's, in seconds (default 300). */
  skewS?: number;
  now?: () => number;
};

/** Letters a person can read out without mixing them up. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ADDRESS = /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;

export const nautilusLabel = (site: string, code: string) => `${site} sign-in ${code}`;

/** "ABCD-EFGH": 8 letters from CODE_ALPHABET. */
export function nautilusCode() {
  const b = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[b[i]! % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** The nanoauth: link Nautilus reads (base64url JSON, which Nautilus pads back itself). */
export function nanoauthLink(o: Pick<NautilusOptions, "site" | "siteAddress" | "message">, label: string, url: string, now = Date.now()) {
  const item = {
    label,
    message: o.message ?? `Sign in to ${o.site}. No payment: your wallet only signs this request.`,
    timestamp: now,
    account: o.siteAddress,
    method: { type: "post", url },
    separator: ":",
  };
  return `nanoauth:${Buffer.from(JSON.stringify(item), "utf8").toString("base64url")}`;
}

export type NautilusStart = { id: string; code: string; link: string; expiresAt: number };

/**
 * Starts a request for the browser whose starter hash is `starter`. `answerUrl(id)`: your public route that takes
 * Nautilus's answer for this id, for example `https://example.com/signin/nautilus?id=<id>`.
 */
export async function startNautilus(o: NautilusOptions, p: { starter: string; answerUrl: (id: string) => string }): Promise<NautilusStart> {
  if (!validAddress(o.siteAddress)) throw new Error("set the site's own Nano address (siteAddress)");
  const now = o.now?.() ?? Date.now();
  const id = randomBytes(18).toString("base64url");
  const code = nautilusCode();
  const label = nautilusLabel(o.site, code);
  const expiresAt = now + (o.ttlMs ?? 5 * 60_000);
  await o.store.create(id, { id, starter: p.starter, status: "waiting", expiresAt, label });
  return { id, code, link: nanoauthLink(o, label, p.answerUrl(id), now), expiresAt };
}

/**
 * Nautilus's answer for request `id`. Returns the account it signed in; throws WalletRefused with what to tell the
 * person. Only a fresh signature of exactly this request's text, by the account's own key, counts, once.
 */
export async function answerNautilus(o: NautilusOptions, id: string, body: Record<string, unknown>): Promise<string> {
  const now = o.now?.() ?? Date.now();
  const again = `Start again on ${o.site}.`;
  if (!REQUEST_ID.test(id)) throw new WalletRefused(`This sign-in is not known. ${again}`);
  const account = String(body.account ?? "").toLowerCase();
  const formatted = String(body.formatted ?? "");
  const signature = String(body.signature ?? "");
  if (!ADDRESS.test(account) || !validAddress(account)) throw new WalletRefused("That is not a Nano address.");
  const rec = await o.store.get(id);
  if (!rec) throw new WalletRefused(`This sign-in is not known. ${again}`);
  if (rec.status !== "waiting") throw new WalletRefused(`This sign-in was already used. ${again}`);
  if (now > rec.expiresAt) throw new WalletRefused(`This sign-in expired. ${again}`);
  // Exactly "<seconds>:<this request's label>:<the site's address>", signed a moment ago.
  const m = /^(\d{1,12}):(.*):(nano_[13a-z0-9]{60})$/.exec(formatted);
  if (!m || m[2] !== rec.label || m[3] !== o.siteAddress) throw new WalletRefused("The signed text is not this sign-in's.");
  if (Math.abs(Number(m[1]) - now / 1000) > (o.skewS ?? 300)) throw new WalletRefused("The time on this phone is too far off. Check it, then start again.");
  if (typeof body.signed === "string" && body.signed.toLowerCase() !== Buffer.from(formatted, "utf8").toString("hex")) throw new WalletRefused("The signed text is not this sign-in's.");
  if (!verifyBytes(account, new Uint8Array(Buffer.from(formatted, "utf8")), signature)) throw new WalletRefused("The signature does not match this wallet.");
  if (!(await o.store.finish(id, account))) throw new WalletRefused(`This sign-in was already used. ${again}`);
  return account;
}

/** Where request `id` stands, for the browser that asks. `starter`: that browser's starter hash (gives `mine`). */
export async function checkNautilus(o: Pick<NautilusOptions, "store" | "now">, id: string, starter?: string): Promise<RequestCheck> {
  if (!REQUEST_ID.test(id)) return { status: "expired" };
  const request = await o.store.get(id);
  return checkOf(request ? { key: id, request } : null, o.now?.() ?? Date.now(), starter);
}

/** The JSON body of your answer route's reply (always with HTTP 200): 0 and the site's line, or 1 and the refusal. */
export function nautilusReply(site: string, refusal?: string) {
  return refusal === undefined ? { status: 0, message: `Signed in to ${site}. You can go back to the page now.`, label: site } : { status: 1, message: refusal, label: site };
}
