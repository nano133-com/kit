// The numbers and the words of the Shelf screen in /admin (shelf.ts draws it). Pure: no page, no network. Everything
// here comes from the game's own database (the admin summary) and from looks.json; nothing is sent anywhere.

import type { LooksDiff } from "../../looks/change.js";
import { ID_PATTERN, type Look } from "../../looks/look.js";

export type ShelfOrder = { lookId: string; status: string; usd: string };
export type ShelfPlayer = { looks: { id: string }[] };

/** What one look has done in this game. */
export type LookStats = {
  /** Players who own it (a paid order gave it to them). */
  owners: number;
  /** Paid orders, and their dollars in cents. */
  paid: number;
  paidCents: number;
  /** Orders that were paid after the order ran out (the money is to be sent back; the look was not given). */
  late: number;
};

const none = (): LookStats => ({ owners: 0, paid: 0, paidCents: 0, late: 0 });

/** "0.25" is 25 cents. */
export const centsOf = (usd: string): number => Math.round(Number(usd) * 100) || 0;

/** The stats for each look id that appears in the orders or in a player's looks. */
export function shelfStats(orders: readonly ShelfOrder[], players: readonly ShelfPlayer[]): Map<string, LookStats> {
  const stats = new Map<string, LookStats>();
  const of = (id: string) => stats.get(id) ?? stats.set(id, none()).get(id)!;
  for (const o of orders) {
    if (o.status === "paid") {
      const s = of(o.lookId);
      s.paid++;
      s.paidCents += centsOf(o.usd);
    } else if (o.status === "paid_late") of(o.lookId).late++;
  }
  for (const p of players) for (const l of new Set(p.looks.map((x) => x.id))) of(l).owners++;
  return stats;
}

/** Every look id that a player owns. */
export function ownedIds(players: readonly ShelfPlayer[]): Set<string> {
  return new Set(players.flatMap((p) => p.looks.map((l) => l.id)));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "1 added, 2 changed, 0 removed" */
export function changeText(d: LooksDiff): string {
  return `${d.added.length} added, ${d.changed.length} changed, ${d.removed.length} removed`;
}

/** What to say when a player's money is in a look: "3 sold, $0.75, 3 owners", or "Not sold yet". */
export function soldText(s: LookStats | undefined): string {
  if (!s || (!s.paid && !s.owners)) return "Not sold yet";
  return `${s.paid} sold, $${(s.paidCents / 100).toFixed(2)}, ${plural(s.owners, "owner")}`;
}

/**
 * A message to give to an AI assistant that works in the game's repository: the whole new looks.json, what changed, and the rules.
 * It holds no address, no order and no secret: only the looks, and the ids that players own.
 */
export function aiPrompt(text: string, diff: LooksDiff, owned: readonly string[], before: readonly Look[]): string {
  // Only a real id goes in, written as a JSON string: an id that comes from a database is data, and a message that a person pastes into an AI assistant must not carry a line
  // that an attacker wrote there.
  const quote = (ids: readonly string[]) => ids.filter((id) => ID_PATTERN.test(id)).map((id) => JSON.stringify(id)).join(", ");
  const names = (ls: readonly Look[]) => quote(ls.map((l) => l.id));
  const ownedOk = owned.filter((id) => ID_PATTERN.test(id));
  const odd = owned.length - ownedOk.length;
  const lines = [
    "Replace looks.json at the top of this game with the text below, then run `npm run check` and push to GitHub. Do not change anything else.",
    "",
    `The change: ${changeText(diff)}.`,
    diff.added.length ? `Added: ${names(diff.added)}.` : "",
    diff.removed.length ? `Removed: ${names(diff.removed)}.` : "",
    diff.changed.length ? `Changed: ${names(diff.changed.map((c) => c.after))}.` : "",
    "",
    `Looks that players own and that must stay in the file with the same id: ${ownedOk.length ? quote(ownedOk) : "none yet"}${odd ? ` (and ${odd} more with an id that is not a valid look id: do not remove any look)` : ""}.`,
    `Rules: keep one free look (priceUsd 0), prices in US dollars with at most 2 decimals, never change or remove the id of a look that someone owns, and a look never changes a score or a rule. (The file had ${before.length} looks before.)`,
    "",
    "looks.json:",
    "```json",
    text.trimEnd(),
    "```",
  ];
  return lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}
