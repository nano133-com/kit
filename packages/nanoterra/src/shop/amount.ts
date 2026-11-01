// Nano amounts for the shop, in raw. 1 XNO is 10^30 raw, more than a JavaScript number holds exactly, so amounts are decimal strings and the math is
// BigInt. Never use a float for an amount that is paid or compared. (The game starter's src/shared/amount.ts, moved here unchanged.)
//
// Every order asks for a CLEAN amount: the price, rounded up to a step of 0.0001 XNO. While another held order has that exact amount, the next order
// asks for one step more (./orders.ts). So an amount has at most four decimals. Wallets that shorten an amount (Cake Wallet cuts a link's amount to
// 6 decimals; Natrium and Nautilus send 6 decimals when the payer touches the amount field) still send it exactly, and the payment matches its order.

export { RAW_PER_XNO, xnoText } from "../admin/amount.js";

/** One step: 0.0001 XNO. */
export const STEP_RAW = 10n ** 26n;
/** Sane bounds for dollars per XNO: outside them a price feed is wrong, not the market. */
export const MIN_RATE = 0.05;
export const MAX_RATE = 100;
/** The highest price a look can have, in US dollars (the looks file allows up to PRICE_MAX_USD, $1000). */
export const MAX_USD = 10_000;

/** A raw amount: digits only, no leading zero, not zero, at most 39 digits. */
export function isRaw(s: unknown): s is string {
  return typeof s === "string" && /^[1-9][0-9]{0,38}$/.test(s);
}

/** Whole steps of 0.0001 XNO, so at most four decimals. */
export function isClean(raw: unknown): raw is string {
  return isRaw(raw) && BigInt(raw) % STEP_RAW === 0n;
}

/**
 * The number of 0.0001 XNO steps for `usd` dollars at `rate` dollars per XNO, rounded UP (the creator never gets less than the price), or null when
 * the price or the rate can't be used.
 */
export function stepsFromUsd(usd: number, rate: number): number | null {
  if (!Number.isFinite(usd) || !Number.isFinite(rate) || usd <= 0 || usd > MAX_USD || rate < MIN_RATE || rate > MAX_RATE) return null;
  // A tiny allowance, so float noise (0.01 / 0.5 * 10000 = 200.00000000000003) doesn't add a whole step.
  return Math.max(1, Math.ceil((usd / rate) * 10_000 - 1e-6));
}

export function rawFromSteps(steps: number | bigint): string {
  const n = BigInt(steps);
  if (n <= 0n) throw new Error("an amount must be above zero");
  return (n * STEP_RAW).toString();
}

/** The clean price in raw, or null. */
export function priceRaw(usd: number, rate: number): string | null {
  const steps = stepsFromUsd(usd, rate);
  return steps === null ? null : rawFromSteps(steps);
}

/** A clean amount plus `more` steps. */
export function plusSteps(raw: string, more: number): string {
  if (!isClean(raw)) throw new Error("not a clean amount");
  return (BigInt(raw) + BigInt(more) * STEP_RAW).toString();
}

/** -1, 0 or 1. */
export function compareRaw(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** The standard payment link: the amount in raw, every digit (docs.nano.org, URI and QR code standards). */
export function nanoUri(address: string, raw: string): string {
  return `nano:${address}?amount=${raw}`;
}
