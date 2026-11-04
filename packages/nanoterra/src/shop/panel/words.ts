// Every word that the shop's sheets show: the looks sheet, Buy, the pay sheet, and a play's (a round, a level, a life or a continue: the Play key, the
// "18 or older" step, its pay sheet). A game gives `words` to `mountShop` (or to `looksView` and `payPanel`)
// with the keys it wants to change, in its own words or language; the rest stay these. A text with a value in it is a function of that value.
//
// Two things a game cannot change, because a player's money depends on them: the stamp "TEST MODE: DO NOT PAY" (it is not a key), and the words
// "Powered by CoinGecko" while CoinGecko is one of the price feeds (CoinGecko's API terms ask for them: `priceLine` adds them when `prices` leaves
// them out).
//
// The defaults are short on purpose (Wes, 2026-11-01: fewer words): the pay sheet shows at most 30 words, and no sentence has more than 10.

import { usdText, type Hat } from "../../looks/look.js";

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

  // ---- a play (plays.json) ----
  /** The Play key while no credit is ready, with the price ("5¢"): a press buys one. */
  playFor: (price: string) => string;
  /** The Play key while credits are ready (a press starts one): "1 round ready". `use` is the play's use word ("round", "level", "life", "continue"). */
  playReady: (use: string, n: number) => string;
  /** The title of a play's sheets: the play's name. */
  playTitle: (play: string) => string;
  /** The line under the title of a play's pay sheet: one use, used once. */
  playLine: (use: string) => string;
  /** The paid play's words, where the QR code was. */
  playPaid: (use: string) => string;
  /** A play's payment after the order ended: it gives no credit, and the creator sends it back. */
  playLate: (use: string) => string;
  /** At a play's Buy, while nobody is signed in. */
  playSignIn: (use: string) => string;
  /** The "18 or older" step before a player's first paid play (the creator's Legal card): the line, the yes key and the key that stops. */
  ageLine: string;
  ageYes: string;
  ageNo: string;
};

/** A use word for `n` of them: "round", "rounds"; "life", "lives"; "continue", "continues". */
export const useWord = (use: string, n = 1): string => (n === 1 ? use : use === "life" ? "lives" : `${use}s`);

/** A play's price on its key: cents under a dollar ("5¢", "0.5¢"), dollars from one dollar ("$1.50"). */
export const playPrice = (usd: number): string => (usd < 1 ? `${Math.round(usd * 10_000) / 100}¢` : usdText(usd));

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

  playFor: (price) => `Play for ${price}`,
  playReady: (use, n) => `${n} ${useWord(use, n)} ready`,
  playTitle: (play) => play,
  playLine: (use) => `1 ${use}. Used once.`,
  playPaid: (use) => `Paid. Your ${use} is ready.`,
  playLate: (use) => `Paid after the order ended, so no ${use}. The creator sends it back.`,
  playSignIn: (use) => `Sign in first to buy a ${use}.`,
  ageLine: "Paid rounds are for players 18 and up.",
  ageYes: "I am 18 or older",
  ageNo: "Not now",
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
