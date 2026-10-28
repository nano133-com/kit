// Nano amounts for the summary. 1 XNO is 10^30 raw, more than a JavaScript number holds exactly, so amounts are decimal strings and the sums are BigInt.

export const RAW_PER_XNO = 10n ** 30n;

/** A raw amount as XNO with every significant digit: "0.2512". Throws on text that is not a whole number. */
export function xnoText(raw: string): string {
  const n = BigInt(raw);
  const whole = n / RAW_PER_XNO;
  const frac = (n % RAW_PER_XNO).toString().padStart(30, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/** A raw amount that can be added: digits only, at most 39 of them. Anything else is not counted (a bad row must not break the summary). */
export const isRawText = (s: unknown): s is string => typeof s === "string" && /^[0-9]{1,39}$/.test(s);
