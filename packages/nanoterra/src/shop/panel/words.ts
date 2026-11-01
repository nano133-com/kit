// Every word that the shop's sheets show: the looks sheet, Buy and the pay sheet. A game gives `words` to `mountShop` (or to `looksView` and `payPanel`)
// with the keys it wants to change, in its own words or language; the rest stay these. A text with a value in it is a function of that value.
//
// Two things a game cannot change, because a player's money depends on them: the stamp "TEST MODE: DO NOT PAY" (it is not a key), and the words
// "Powered by CoinGecko" while CoinGecko is one of the price feeds (CoinGecko's API terms ask for them: `priceLine` adds them when `prices` leaves
// them out).
//
// The defaults are short on purpose (Wes, 2026-11-01: fewer words): the pay sheet shows at most 30 words, and no sentence has more than 10.

import type { Hat } from "../../looks/look.js";

export type ShopWords = {
  // ---- the looks sheet ----
  /** The sheet's title, the Looks key's word and the sheet's name for a screen reader. The option `title` wins over it. */
  title: string;
  /** The close key's name for a screen reader. */
  close: string;
  /** The tabs' name for a screen reader. */
  kinds: string;
  /** The outfits' tab. */
  outfits: string;
  /** The tab of a wear slot of the game's own ("shovel"). The option `slots` wins over it. */
  slotTab: (slot: string) => string;
  /** The plain choice of a wear slot ("No shovel"). The option `slots` wins over it. */
  slotPlain: (slot: string) => string;
  /** The line under an outfit: what it changes (its hat, or the colour only). */
  outfitLine: (hat: Hat | null) => string;
  /** The line under an item of a wear slot. */
  itemLine: (slot: string) => string;
  /** Added to the line of a free look, and the plain choice's line. */
  free: string;
  /** Added to the line of a look the player owns. */
  yours: string;
  wear: string;
  wearing: string;
  /** The Buy key, with the look's price ("$0.25"). */
  buy: (price: string) => string;
  /** Under the list. */
  looksNote: string;
  /** Under the list and at Buy, while nobody is signed in. */
  signInFirst: string;

  // ---- Buy ----
  /** The title of Buy and of the pay sheet. */
  buyTitle: (look: string) => string;
  making: string;
  /** An order that did not start, with no words from the server. */
  orderFailed: string;
  /** The words of a refusal: the server's own (`text`, in English) and its HTTP status (0: no answer). Default: the server's words. */
  refusal: (text: string, status: number) => string;
  /** The key back to the looks. */
  back: string;
  /** The key that signs in again after "Sign in first." (401). */
  signIn: string;

  // ---- the pay sheet ----
  /** The line under the title. */
  lookLine: (look: string) => string;
  /** The amount in XNO, large ("0.25 XNO"). */
  amount: (xno: string) => string;
  /** The amount in dollars, beside it ("= $0.25"). */
  usd: (usd: string) => string;
  /** Above the amount, live only: the player must send this exact amount. */
  sendExactly: string;
  /** Under the stamp in test mode: nothing can be paid here. */
  testNote: string;
  /** The wallet key in test mode, off, with its reason. */
  walletOff: string;
  /** The wallet key (live). */
  wallet: string;
  /** The QR code's name for a screen reader. */
  qrLabel: (xno: string) => string;
  /** The fold with the amount and the address to type by hand. */
  byHand: string;
  amountLabel: string;
  /** The address's label in the fold. */
  toLabel: string;
  /** In the fold: another amount does not match the order. */
  byHandNote: string;
  copy: string;
  copied: string;
  copyFailed: string;
  /** The time left (live only): the order ends then. */
  endsIn: (time: string) => string;
  waiting: string;
  noConnection: string;
  stillWaiting: string;
  checkAgain: string;
  paid: string;
  paidLine: (look: string) => string;
  /** A payment after the order ended: it gives no look, and the creator sends it back. */
  paidLate: string;
  /** The order ended: a payment sent in time still counts. */
  expired: string;
  /** The price's sources ("CoinGecko", "Kraken", "KuCoin"). "Powered by CoinGecko" is added when CoinGecko is one and the words leave it out. */
  prices: (sources: readonly string[]) => string;
};

const HATS: Record<Hat, string> = { cap: "with a cap", beanie: "with a beanie", crown: "with a crown", tophat: "with a top hat" };
const spaced = (slot: string) => slot.replace(/-/g, " ");

/** CoinGecko's words: its API terms ask for them wherever its price shows. */
export const COINGECKO_CREDIT = "Powered by CoinGecko";

export const SHOP_WORDS: ShopWords = {
  title: "Looks",
  close: "Close",
  kinds: "Kinds of looks",
  outfits: "Outfits",
  slotTab: (slot) => spaced(slot.charAt(0).toUpperCase() + slot.slice(1)),
  slotPlain: (slot) => `No ${spaced(slot)}`,
  outfitLine: (hat) => (hat ? HATS[hat] : "colour only"),
  itemLine: (slot) => spaced(slot),
  free: "free",
  yours: "yours",
  wear: "Wear",
  wearing: "Wearing",
  buy: (price) => `Buy ${price}`,
  looksNote: "Looks never change play. Pay in Nano, straight to the creator.",
  signInFirst: "Sign in first to buy a look.",

  buyTitle: (look) => `Buy ${look}`,
  making: "Making your order…",
  orderFailed: "The order did not start. Try again.",
  refusal: (text) => text,
  back: "Back",
  signIn: "Sign in",

  lookLine: () => "It never changes play.",
  amount: (xno) => `${xno} XNO`,
  usd: (usd) => `= ${usd}`,
  sendExactly: "Send exactly",
  testNote: "Nothing can be paid here.",
  walletOff: "Wallet off: test mode",
  wallet: "Open wallet",
  qrLabel: (xno) => `QR code to pay ${xno} XNO`,
  byHand: "Enter by hand",
  amountLabel: "Amount",
  toLabel: "To",
  byHandNote: "Another amount does not match.",
  copy: "Copy",
  copied: "Copied",
  copyFailed: "Copy failed",
  endsIn: (time) => `Ends in ${time}.`,
  waiting: "Waiting for payment…",
  noConnection: "No connection. Trying again…",
  stillWaiting: "Still waiting. Already paid? Press Check again.",
  checkAgain: "Check again",
  paid: "Paid. Thank you!",
  paidLine: (look) => `${look} is yours.`,
  paidLate: "Paid after the order ended, so no look. The creator sends it back.",
  expired: "This order ended. Paid in time? Wait here: it still counts.",
  prices: (sources) => {
    const others = sources.filter((s) => s !== "CoinGecko");
    const credit = sources.includes("CoinGecko") ? ` ${COINGECKO_CREDIT}.` : "";
    return others.length ? `Price: ${others.join(", ")}.${credit}` : credit.trim();
  },
};

/** The game's words over the defaults. A key the game leaves out, or gives as undefined, keeps its default. */
export function shopWords(over?: Partial<ShopWords>): ShopWords {
  const out = { ...SHOP_WORDS };
  for (const [k, v] of Object.entries(over ?? {})) if (v !== undefined && k in SHOP_WORDS) (out as Record<string, unknown>)[k] = v;
  return out;
}

/** The price's line: the game's words, with "Powered by CoinGecko" added when CoinGecko is a source and the words leave it out. */
export function priceLine(words: ShopWords, sources: readonly string[]): string {
  const line = words.prices(sources).trim();
  if (!sources.includes("CoinGecko") || line.includes(COINGECKO_CREDIT)) return line;
  return `${line}${line ? " " : ""}${COINGECKO_CREDIT}.`;
}
