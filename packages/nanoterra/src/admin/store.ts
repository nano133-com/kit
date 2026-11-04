// What a game gives the admin handler: a store (an adapter for its database) and a status. The package has no database of its own.

import type { GamePatch } from "./switches.js";

/** Money as the admin page shows it: a count, the XNO text and the US dollars as text. */
export type Money = { count: number; xno: string; usd: string };

export type OrderStatus = "open" | "paid" | "expired" | "paid_late";

export type AdminOrder = {
  id: string;
  /** The player's Nano address. */
  player: string;
  /** The id of what the order sells: a look's, or a play's (`kind` "play"). */
  lookId: string;
  /** Only on a play's order (a round, a level, a life or a continue): "play". */
  kind?: "play";
  /** What the player reads for the look or the play (the handler fills it from `lookName`, or from plays.json). */
  look: string;
  usd: string;
  xno: string;
  status: OrderStatus | string;
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  payer: string | null;
  hash: string | null;
};

/** A player, the looks that paid orders gave them, and (only when they have some) their credits that wait for a round, by play. */
export type AdminPlayer = { player: string; looks: { id: string; name: string; at: number }[]; ready?: { id: string; name: string; ready: number }[] };

/**
 * What one play (plays.json) has done: `sold` paid orders, `used` credits that a round used, `ready` credits that wait in their time, `late` payments
 * that came after the order ended (no credit: to send back), `notUsedInTime` credits past their wait (to send back).
 */
export type PlayStats = { playId: string; sold: number; used: number; ready: number; late: number; notUsedInTime: number };

/**
 * A paid play to send back by hand (the kit holds no key): a credit not used in its time ("not_used_in_time"), or the unused credit of a player who used
 * "Delete my data" ("deleted_player": the credit went, the order kept its payer). The payer and the amount say where and how much.
 */
export type SendBack = { orderId: string; playId: string; payer: string; xno: string; usd: string; paidAt: number | null; why: "not_used_in_time" | "deleted_player" };

/** What the store needs to know of the plays: how many days a credit of each waits (plays.json's useWithinDays; 30 when it does not say). */
export type SummaryOptions = { waitDays?: (playId: string) => number };

/** The numbers of the orders and the looks that players own. */
export type StoreSummary = {
  counts: { open: number; paid: number; expired: number; paid_late: number };
  /** `sendBack`: the late payments and the paid plays to send back, together (the "To send back" number). A store with no plays may leave it out. */
  totals: { paid: Money; paidLate: Money; sendBack?: Money };
  /** Newest first, at most 500. `look` is filled by the handler. */
  orders: Omit<AdminOrder, "look">[];
  /** Players and the looks that a paid order gave them (and their ready credits). `name` is filled by the handler. */
  players: { player: string; looks: { id: string; at: number }[]; ready?: { id: string; ready: number }[] }[];
  /** The price of XNO in US dollars that the game uses, and where it came from. */
  rate: { usd: number; sources: string[]; at: number } | null;
  /** Each play that sold or has credits (a store that sells no plays leaves it out or gives none). */
  plays?: PlayStats[];
  /** The paid plays to send back by hand, oldest payment first. */
  sendBack?: SendBack[];
};

/**
 * One admin sign-in, as the panel lists it: when, the rough country (two letters, or null when the game did not know it) and a short browser name ("Chrome on macOS").
 * Nothing else: no address, no IP, no browser text. The game writes these when it makes an admin login; the package only reads them.
 */
export type AdminLogin = { at: number; country: string | null; browser: string };

/** How many sign-ins the panel lists. */
export const ADMIN_LOGINS_SHOWN = 10;

/**
 * The settings an admin store keeps, by name, and the key of each in the game's meta table (D1) or meta collection (Firestore). The Game card's five and
 * the Legal card's five. A value is kept as text: "14" for the refund days, the time in ms for the owner's confirmation (`confirmLaws` in a patch).
 */
export const SETTING_KEYS = {
  character: "setting:character",
  signin: "setting:signin",
  friends: "setting:friends",
  emotes: "setting:emotes",
  freePlay: "setting:freePlay",
  adultsOnly: "setting:adultsOnly",
  sellLives: "setting:sellLives",
  refundDays: "setting:refundDays",
  refundWords: "setting:refundWords",
  lawsConfirmedAt: "setting:lawsConfirmedAt",
} as const;
export type SettingName = keyof typeof SETTING_KEYS;
/** The settings as a store holds them: each one as it was kept (text), or missing. */
export type StoredSettings = { [K in SettingName]?: unknown };

/** The text a store keeps for each setting of a checked patch (`confirmLaws` keeps the time of the press). Only known settings, never anything else. */
export function settingRows(patch: GamePatch, now: number): [SettingName, string][] {
  const rows: [SettingName, string][] = [];
  if (patch.character) rows.push(["character", patch.character]);
  if (patch.signin) rows.push(["signin", patch.signin]);
  if (patch.friends) rows.push(["friends", patch.friends]);
  if (patch.emotes) rows.push(["emotes", patch.emotes]);
  if (patch.freePlay) rows.push(["freePlay", patch.freePlay]);
  if (patch.adultsOnly) rows.push(["adultsOnly", patch.adultsOnly]);
  if (patch.sellLives) rows.push(["sellLives", patch.sellLives]);
  if (patch.refundDays !== undefined) rows.push(["refundDays", String(patch.refundDays)]);
  if (patch.refundWords !== undefined) rows.push(["refundWords", patch.refundWords]);
  if (patch.confirmLaws === true) rows.push(["lawsConfirmedAt", String(Math.floor(now))]);
  return rows;
}

/**
 * The game's database, as the handler needs it. An adapter writes ONLY what these calls say: the ten settings (SETTING_KEYS) and, when the game turns it
 * on, the deletion of the admin sessions (`signOutEverywhere`). Nothing else.
 * (There is no call that writes a look, a play, a price, an order or a credit: the Shelf gives text to copy, and a change of looks or plays is a change of
 * the repository.)
 */
export interface AdminStore {
  /** The settings that /admin has saved. A value that is not a known word is ignored by the handler, so an adapter returns what it holds. */
  readSettings(): Promise<StoredSettings>;
  /** Saves a checked patch: all of it or none of it (`settingRows` gives the text of each setting). */
  saveSettings(patch: GamePatch, now: number): Promise<void>;
  /** The numbers. `options.waitDays` gives each play's wait (the handler passes plays.json's); a store that sells no plays may ignore it. */
  summary(now: number, options?: SummaryOptions): Promise<StoreSummary>;
  /**
   * Optional. The last sign-ins to the admin, newest first, at most `limit`, with only the three things of `AdminLogin`. With it the summary lists them (the "Sign-ins" card).
   * An adapter that has it must never return more than those three things for a sign-in.
   */
  recentLogins?(limit: number): Promise<AdminLogin[]>;
  /**
   * Optional. Deletes EVERY admin session (the admin login of the owner, in every browser, this one too) and no other session; returns how many it deleted. With it the handler has
   * the route `POST {base}/signout-all` and the panel has "Sign out everywhere". An adapter must delete only sessions of the ADMIN scope.
   */
  signOutEverywhere?(): Promise<number>;
}

/** What the game says about itself on the Status card: only the game knows its address, its test mode and what is still off. */
export type AdminStatus = {
  address: string | null;
  testMode: boolean;
  /** Whether Turnstile (the bot check) is on. */
  turnstile?: boolean;
  /** The names of the Nano nodes that check payments. */
  nodes?: string[];
  /** "owner/repo" on GitHub, for the link to looks.json. */
  repo?: string | null;
  /** Plain sentences about what is still off. */
  warnings: string[];
};

/** The whole of GET summary. */
export type AdminSummary = AdminStatus &
  Omit<StoreSummary, "orders" | "players" | "plays" | "sendBack" | "totals"> & {
    totals: { paid: Money; paidLate: Money; sendBack: Money };
    orders: AdminOrder[];
    players: AdminPlayer[];
    /** Every play of plays.json (and any play that sold and is no longer in it), with its name. None when the game sells no plays. */
    plays: (PlayStats & { name: string })[];
    /** The paid plays to send back by hand, with the play's name. */
    sendBack: (SendBack & { name: string })[];
    /** Whether the game gave a payment check (POST check). The panel shows "Check payments now" only then. */
    canCheck: boolean;
    /** The last admin sign-ins (newest first), when the store can list them. */
    logins?: AdminLogin[];
    /** Whether the route "sign out everywhere" exists (the store can do it). */
    canSignOutEverywhere?: boolean;
  };
