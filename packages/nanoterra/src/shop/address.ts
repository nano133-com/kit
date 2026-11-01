// The creator's address (the payee): a whole Nano address, its shape AND its checksum. A typo in a receive address would send every payment to an
// account nobody holds the key for, so the shop sells only to an address whose checksum is right (the game starter checks it with @nano133/signin's
// `validAddress`; this package has no dependency, so it carries the 5-byte BLAKE2b that the checksum needs, and nothing else of it).

/** The address that belongs to nobody (its key is all zeros): the example in the game starter's wrangler.jsonc. A shop with it is in test mode. */
export const EXAMPLE_ADDRESS = "nano_1111111111111111111111111111111111111111111111111111hifc8npp";

const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";
const SHAPE = /^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;

const MASK = (1n << 64n) - 1n;
const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];
const rotr = (x: bigint, n: bigint) => ((x >> n) | (x << (64n - n))) & MASK;

/** BLAKE2b of at most 128 bytes (one block), `outLen` bytes, no key (RFC 7693). Enough for a checksum of a 32-byte key. */
export function blake2bShort(input: Uint8Array, outLen: number): Uint8Array {
  if (input.length > 128 || outLen < 1 || outLen > 64) throw new Error("blake2bShort: one block of at most 128 bytes, 1 to 64 bytes out");
  const h = IV.slice();
  h[0] ^= 0x01010000n ^ BigInt(outLen);
  const block = new Uint8Array(128);
  block.set(input);
  const m: bigint[] = [];
  for (let i = 0; i < 16; i++) {
    let w = 0n;
    for (let b = 7; b >= 0; b--) w = (w << 8n) | BigInt(block[i * 8 + b]);
    m.push(w);
  }
  const v = [...h, ...IV];
  v[12] ^= BigInt(input.length);
  v[14] ^= MASK;
  const g = (a: number, b: number, c: number, d: number, x: bigint, y: bigint) => {
    v[a] = (v[a] + v[b] + x) & MASK;
    v[d] = rotr(v[d] ^ v[a], 32n);
    v[c] = (v[c] + v[d]) & MASK;
    v[b] = rotr(v[b] ^ v[c], 24n);
    v[a] = (v[a] + v[b] + y) & MASK;
    v[d] = rotr(v[d] ^ v[a], 16n);
    v[c] = (v[c] + v[d]) & MASK;
    v[b] = rotr(v[b] ^ v[c], 63n);
  };
  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r % 10];
    g(0, 4, 8, 12, m[s[0]], m[s[1]]);
    g(1, 5, 9, 13, m[s[2]], m[s[3]]);
    g(2, 6, 10, 14, m[s[4]], m[s[5]]);
    g(3, 7, 11, 15, m[s[6]], m[s[7]]);
    g(0, 5, 10, 15, m[s[8]], m[s[9]]);
    g(1, 6, 11, 12, m[s[10]], m[s[11]]);
    g(2, 7, 8, 13, m[s[12]], m[s[13]]);
    g(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  const out = new Uint8Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = Number(((h[i >> 3] ^ v[i >> 3] ^ v[(i >> 3) + 8]) >> BigInt(8 * (i & 7))) & 0xffn);
  return out;
}

/** Base-32 text (Nano's alphabet) as a big number. */
const bitsOf = (text: string): bigint => [...text].reduce((n, c) => (n << 5n) | BigInt(ALPHABET.indexOf(c)), 0n);

/**
 * True for a whole Nano address: "nano_" (or "xrb_"), its shape, and its checksum (the last 8 characters: the BLAKE2b-40 of the key, bytes reversed).
 * One wrong character fails it.
 */
export function validAddress(address: unknown): address is string {
  if (typeof address !== "string") return false;
  const a = address.replace(/^xrb_/, "nano_");
  if (!SHAPE.test(a)) return false;
  const body = a.slice(5);
  // 52 characters are 260 bits: 4 bits that must be zero, then the 32-byte key.
  const key = bitsOf(body.slice(0, 52));
  if (key >> 256n !== 0n) return false;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number((key >> BigInt(8 * (31 - i))) & 0xffn);
  const check = blake2bShort(bytes, 5).reverse();
  const want = check.reduce((n, b) => (n << 8n) | BigInt(b), 0n);
  return bitsOf(body.slice(52)) === want;
}

/**
 * The payee as the shop uses it: a whole address in lower case with the "nano_" prefix, or null (no address, the example, or a wrong checksum). With
 * null the shop is in test mode: no pay screen shows an address, a QR code or a wallet link.
 */
export function payeeOf(address: unknown): string | null {
  if (typeof address !== "string") return null;
  const a = address.trim().toLowerCase().replace(/^xrb_/, "nano_");
  if (!a || a === EXAMPLE_ADDRESS) return null;
  return validAddress(a) ? a : null;
}
