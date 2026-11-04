// The settings of the "Legal" card in /admin (the Settings tab): the creator's own rules for paid rounds (plays.json). The admin store keeps them as it keeps
// the Game card's settings; the game's routes read them (loadGameSettings or loadLegal) and hand them to the shop (createShopHandler's `legal`). No DOM,
// no package, no network: the shop's server path loads this file, so it holds only the types, the defaults and the words' filling. The checks of a press
// and of a stored value are the admin's (./legalRules.ts).
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

/** The sample refund words: short, plain and honest (refunds are by hand, by the creator). */
export const DEFAULT_REFUND_WORDS = "Not used? Ask for your money back within {days} days. Write to the game's owner.";

export const DEFAULT_LEGAL: LegalState = { adultsOnly: true, sellLives: false, refundDays: 14, refundWords: DEFAULT_REFUND_WORDS, lawsConfirmedAt: null };

/** The uses that the "Sell an extra life or a continue" switch holds back while it is off. */
export const LIFE_USES: readonly string[] = ["life", "continue"];

/** The refund words with the days filled in: what the player reads. */
export const refundText = (s: Pick<LegalState, "refundDays" | "refundWords">): string => s.refundWords.replace(/\{days\}/g, String(s.refundDays));
