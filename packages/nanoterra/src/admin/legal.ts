// The settings of the "Legal" card in /admin (the Settings tab): the creator's own rules for paid rounds (plays.json). The admin store keeps them as it keeps
// the Game card's settings; the game's routes read them (loadGameSettings or loadLegal) and hand them to the shop (createShopHandler's `legal`). No DOM,
// no package, no network: the shop's server path loads this file, so it stays small.
//
// Fixed in the kit, never a setting: no cash prize, no prize of value, nothing random bought, no credit converted or moved (checkPlays and the shop's
// routes hold these). A setting that allowed them would make the kit a tool for gambling games.

/** The creator's rules for paid rounds, as they are now. */
export type LegalState = {
  /** Paid rounds for players 18 and up only. On: before a player's first paid play order, the shop asks "I am 18 or older" once and keeps the yes. */
  adultsOnly: boolean;
  /** Plays whose use is a life or a continue are on sale. Off: an order for one is refused (credits already paid stay usable). */
  sellLives: boolean;
  /** The refund rule: for how many days a player may ask for the money back. The creator sends it by hand (the kit holds no key). */
  refundDays: number;
  /** The words the pay sheet of a play shows before any step. Plain text; "{days}" stands for `refundDays`. */
  refundWords: string;
  /**
   * When the owner confirmed "You are responsible for the laws where you sell.", or null. Outside test mode the shop refuses every play order until then
   * (looks are not affected).
   */
  lawsConfirmedAt: number | null;
};

/** What a press on the Legal card can set. `confirmLaws` is the owner's one confirmation: the store keeps the time of the press. */
export type LegalPatch = { adultsOnly?: "on" | "off"; sellLives?: "on" | "off"; refundDays?: number; refundWords?: string; confirmLaws?: true };

/** The longest refund rule in days, and the most characters of the refund words. */
export const REFUND_DAYS_MAX = 365;
export const REFUND_WORDS_MAX = 280;
/** The sample refund words: short, plain and honest (refunds are by hand, by the creator). */
export const DEFAULT_REFUND_WORDS = "Not used? Ask for your money back within {days} days. Write to the game's owner.";

export const DEFAULT_LEGAL: LegalState = { adultsOnly: true, sellLives: false, refundDays: 14, refundWords: DEFAULT_REFUND_WORDS, lawsConfirmedAt: null };

/** The uses that the "Sell an extra life or a continue" switch holds back while it is off. */
export const LIFE_USES: readonly string[] = ["life", "continue"];

const onOff = (v: unknown): v is "on" | "off" => v === "on" || v === "off";
/** A refund rule in days: a whole number from 0 to REFUND_DAYS_MAX. */
export const isRefundDays = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= REFUND_DAYS_MAX;
/** Refund words: plain text of 1 to REFUND_WORDS_MAX characters on one line, never HTML (no "<" or ">"), no control character. */
export const isRefundWords = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= REFUND_WORDS_MAX && v === v.trim() && !/[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v);

/** The refund words with the days filled in: what the player reads. */
export const refundText = (s: Pick<LegalState, "refundDays" | "refundWords">): string => s.refundWords.replace(/\{days\}/g, String(s.refundDays));

/** The stored words of the Legal card (as an admin store keeps them: text), read back. Anything that is not a known value is the default. */
export function mergeLegal(stored: { adultsOnly?: unknown; sellLives?: unknown; refundDays?: unknown; refundWords?: unknown; lawsConfirmedAt?: unknown }): LegalState {
  const days = typeof stored.refundDays === "string" && /^\d{1,3}$/.test(stored.refundDays) ? Number(stored.refundDays) : NaN;
  const at = typeof stored.lawsConfirmedAt === "string" && /^[1-9]\d{0,15}$/.test(stored.lawsConfirmedAt) ? Number(stored.lawsConfirmedAt) : null;
  return {
    adultsOnly: onOff(stored.adultsOnly) ? stored.adultsOnly === "on" : DEFAULT_LEGAL.adultsOnly,
    sellLives: onOff(stored.sellLives) ? stored.sellLives === "on" : DEFAULT_LEGAL.sellLives,
    refundDays: isRefundDays(days) ? days : DEFAULT_LEGAL.refundDays,
    refundWords: isRefundWords(stored.refundWords) ? stored.refundWords : DEFAULT_LEGAL.refundWords,
    lawsConfirmedAt: at,
  };
}

/** One key of a press on the Legal card: the patch it gives, an error in words, or null when the key is not the card's. */
export function parseLegalKey(key: string, value: unknown): { patch: LegalPatch } | { error: string } | null {
  if (key === "adultsOnly") return onOff(value) ? { patch: { adultsOnly: value } } : { error: '"adultsOnly" must be "on" or "off".' };
  if (key === "sellLives") return onOff(value) ? { patch: { sellLives: value } } : { error: '"sellLives" must be "on" or "off".' };
  if (key === "refundDays") return isRefundDays(value) ? { patch: { refundDays: value } } : { error: `"refundDays" must be a whole number of days from 0 to ${REFUND_DAYS_MAX}.` };
  if (key === "refundWords")
    return isRefundWords(value) ? { patch: { refundWords: value } } : { error: `"refundWords" must be plain text of 1 to ${REFUND_WORDS_MAX} characters on one line, with no "<" or ">".` };
  if (key === "confirmLaws") return value === true ? { patch: { confirmLaws: true } } : { error: '"confirmLaws" must be true.' };
  return null;
}
