// Just enough of the nano_ address format to compare a block's link with an
// address: base32 with Nano's alphabet, 4 padding bits, the 256-bit public key,
// then an 8-character checksum (not checked here; the node checks addresses).

const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";

/** The public key (64 upper-case hex) of a nano_ or xrb_ address. */
export function publicKeyOf(address: string): string {
  const body = address.replace(/^(nano|xrb)_/, "").slice(0, 52);
  if (body.length !== 52) throw new Error("not a Nano address");
  let bits = "";
  for (const c of body) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error("not a Nano address");
    bits += v.toString(2).padStart(5, "0");
  }
  bits = bits.slice(4);
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex.toUpperCase();
}

/** The same account, written with the nano_ prefix. */
export const nanoPrefix = (a: string) => a.replace(/^xrb_/, "nano_");
