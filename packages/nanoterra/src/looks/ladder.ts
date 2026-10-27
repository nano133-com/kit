// The price ladder: the six steps from a cent to a dollar that nano133.com uses for its own cosmetics and shows on /build/cosmetics.
// It is a suggestion. A look can have any price with at most 2 decimals, up to $1000.

export type Rung = {
  name: "dye" | "charm" | "piece" | "statement" | "set" | "outfit";
  /** The price in cents. */
  cents: number;
  /** What the step is for, in a few words. */
  for: string;
};

export const PRICE_LADDER: readonly Rung[] = [
  { name: "dye", cents: 1, for: "a colour" },
  { name: "charm", cents: 2, for: "a small mark or a badge" },
  { name: "piece", cents: 5, for: "one worn thing, like a hat or a scarf" },
  { name: "statement", cents: 25, for: "a bigger piece that people notice" },
  { name: "set", cents: 50, for: "a few pieces that go together" },
  { name: "outfit", cents: 100, for: "a whole look" },
];

/** A rung's price in dollars: 0.01, 0.02, 0.05, 0.25, 0.5, 1. */
export const rungUsd = (r: Rung): number => r.cents / 100;

/** The rung that has exactly this price, or undefined. */
export function rungOf(usd: number): Rung | undefined {
  return PRICE_LADDER.find((r) => Math.abs(rungUsd(r) - usd) < 1e-9);
}

/** A price as a page writes it: 1¢, 25¢, $1, $1.10. */
export function priceText(usd: number): string {
  const cents = Math.round(usd * 100);
  if (cents < 100) return `${cents}¢`;
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
