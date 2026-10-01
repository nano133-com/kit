import { createHmac, timingSafeEqual } from "node:crypto";

// A receipt: a short signed token that says "this payer paid for this item",
// for a cookie or a "restore my purchase" link. HMAC-SHA256 with your own
// secret: only your server can make or check one.
//
// Format: base64url(JSON claims) "." base64url(MAC over "nano-checkout-receipt|" + the first part).

export type ReceiptClaims = { v: 1; item: string; checkout: string; payer: string; hash: string; exp: number };

const b64 = (b: Buffer) => b.toString("base64url");
const mac = (secret: string | Buffer, body: string) => createHmac("sha256", secret).update(`nano-checkout-receipt|${body}`).digest();

export function signReceipt(secret: string | Buffer, claims: Omit<ReceiptClaims, "v">): string {
  const body = b64(Buffer.from(JSON.stringify({ v: 1, ...claims })));
  return `${body}.${b64(mac(secret, body))}`;
}

/** The claims of a valid, unexpired receipt for `item`, or null. */
export function verifyReceipt(secret: string | Buffer, token: unknown, want: { item: string; now?: number }): ReceiptClaims | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || token.split(".").length !== 2) return null;
  const expected = mac(secret, body);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString()) as ReceiptClaims;
    if (c.v !== 1 || c.item !== want.item || !(c.exp > (want.now ?? Date.now()) / 1000)) return null;
    return c;
  } catch {
    return null;
  }
}
