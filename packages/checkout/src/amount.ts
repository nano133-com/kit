// Amounts in raw (1 XNO = 10^30 raw), as bigint.

export const RAW_PER_XNO = 10n ** 30n;
/** Prices round up to this step: 0.0001 XNO. The unique tail lives below it. */
export const PRICE_STEP_RAW = 10n ** 26n;

/** `usd` dollars at `xnoUsd` dollars per XNO, in raw, rounded up to 0.0001 XNO. */
export function priceRaw(usd: number, xnoUsd: number): bigint {
  if (!(usd > 0) || !(xnoUsd > 0)) throw new Error("price and rate must be positive");
  const steps = Math.ceil((usd / xnoUsd) * 10_000 - 1e-6);
  return BigInt(Math.max(1, steps)) * PRICE_STEP_RAW;
}

/** The price plus a tail of 1 to 999999 raw. */
export const withTail = (price: bigint, tail: number) => price + BigInt(Math.max(1, Math.min(999_999, Math.floor(tail))));

/** A raw amount as XNO, all digits: "0.028100000000000000000000734201". */
export function toXno(raw: bigint | string): string {
  const s = BigInt(raw).toString().padStart(31, "0");
  const whole = s.slice(0, -30).replace(/^0+(?=\d)/, "");
  const frac = s.slice(-30).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

/** A nano: link that wallets open with the exact amount filled in. */
export const nanoUri = (address: string, raw: bigint | string) => `nano:${address}?amount=${BigInt(raw).toString()}`;
