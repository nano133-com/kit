// What a game gives the admin handler: a store (an adapter for its database) and a status. The package has no database of its own.

import type { GamePatch } from "./switches.js";

/** Money as the admin page shows it: a count, the XNO text and the US dollars as text. */
export type Money = { count: number; xno: string; usd: string };

export type OrderStatus = "open" | "paid" | "expired" | "paid_late";

export type AdminOrder = {
  id: string;
  /** The player's Nano address. */
  player: string;
  lookId: string;
  /** What the player reads for the look (the handler fills it from `lookName`). */
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

export type AdminPlayer = { player: string; looks: { id: string; name: string; at: number }[] };

/** The numbers of the orders and the looks that players own. */
export type StoreSummary = {
  counts: { open: number; paid: number; expired: number; paid_late: number };
  totals: { paid: Money; paidLate: Money };
  /** Newest first, at most 500. `look` is filled by the handler. */
  orders: Omit<AdminOrder, "look">[];
  /** Players and the looks that a paid order gave them. `name` is filled by the handler. */
  players: { player: string; looks: { id: string; at: number }[] }[];
  /** The price of XNO in US dollars that the game uses, and where it came from. */
  rate: { usd: number; sources: string[]; at: number } | null;
};

/**
 * The game's database, as the handler needs it. An adapter writes ONLY what these three calls say: the two settings and nothing else.
 * (There is no call that writes a look, a price or an order: the Shelf gives text to copy, and a change of looks is a change of the repository.)
 */
export interface AdminStore {
  /** The settings that /admin has saved. A value that is not a known word is ignored by the handler, so an adapter returns what it holds. */
  readSettings(): Promise<{ character?: unknown; signin?: unknown }>;
  /** Saves a checked patch: all of it or none of it. */
  saveSettings(patch: GamePatch, now: number): Promise<void>;
  summary(now: number): Promise<StoreSummary>;
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
  Omit<StoreSummary, "orders" | "players"> & {
    orders: AdminOrder[];
    players: AdminPlayer[];
    /** Whether the game gave a payment check (POST check). The panel shows "Check payments now" only then. */
    canCheck: boolean;
  };
