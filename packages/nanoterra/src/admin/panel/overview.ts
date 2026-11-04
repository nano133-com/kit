// The Overview tab of /admin: the game at a glance. The best-selling looks and rounds with their share of the money, what to send back by hand (late
// payments, rounds not used in time, the unused rounds of deleted players), the last five orders, the two game switches as On or Off, and the shelf in
// numbers; each part has a key to its own tab. A game with no sale yet gets three first steps instead of empty lists.

import type { Look } from "../../looks/look.js";
import { priceText } from "../../looks/ladder.js";
import type { AdminSummary } from "../store.js";
import { FRIENDS_CHOICES, FRIENDS_TITLE, SWITCHES, stateOf, type GameState } from "../switches.js";
import { copyKey, dollars, h, plural, shortAddress } from "./dom.js";
import { icon } from "./icons.js";
import { orderRow, type OrderFilter } from "./orders.js";
import { shelfStats } from "./shelfData.js";
import type { TabId } from "./tabs.js";

/** A best seller: a look id, its name, its paid orders and their cents, its owners. */
export type BestSeller = { id: string; name: string; paid: number; cents: number; owners: number };

/** The looks that sold, best first (by money, then by owners), at most `n`. A look that is no longer in looks.json keeps the name its orders give. Pure. */
export function bestSellers(s: Pick<AdminSummary, "orders" | "players">, looks: readonly Look[], n = 5): BestSeller[] {
  const names = new Map<string, string>();
  for (const o of s.orders) names.set(o.lookId, o.look);
  for (const l of looks) names.set(l.id, l.name);
  return [...shelfStats(s.orders, s.players)]
    .filter(([, st]) => st.paid > 0)
    .map(([id, st]) => ({ id, name: names.get(id) ?? id, paid: st.paid, cents: st.paidCents, owners: st.owners }))
    .sort((a, b) => b.cents - a.cents || b.owners - a.owners || a.name.localeCompare(b.name))
    .slice(0, n);
}

export type OverviewView = {
  el: HTMLElement;
  update(s: AdminSummary): void;
  /** Brings the "To send back" card into view (a press on the number does it). */
  showSendBack(): void;
  /** The game switches as they are now (null: they could not be read). */
  setGame(state: GameState | null): void;
};

/** Why a paid round is to be sent back, in words. */
const BACK_WHY: Record<string, string> = { not_used_in_time: "Not used in time", no_play: "No longer sold", deleted_player: "The player deleted their data", paid_late: "Paid after the order ended" };

/** `cards`: more cards for the main column, after "To send back" (the panel's "Unmatched payments"). */
export function overviewView(looks: readonly Look[], colourOf: (lookId: string) => string | null, go: (tab: TabId, filter?: OrderFilter) => void, playIds: ReadonlySet<string> = new Set(), cards: readonly HTMLElement[] = []): OverviewView {
  let game: GameState | null = null;
  const sellers = h("section", { class: "admin-card best-card", "aria-labelledby": "n133-best-title" });
  const sendBack = h("section", { class: "admin-card send-back-card", "aria-labelledby": "n133-back-title", tabindex: -1 });
  const recent = h("section", { class: "admin-card recent-card", "aria-labelledby": "n133-recent-title" });
  const gameBox = h("section", { class: "admin-card glance-card", "aria-labelledby": "n133-glance-game" });
  const shelfBox = h("section", { class: "admin-card glance-card", "aria-labelledby": "n133-glance-shelf" });
  const start = h("section", { class: "admin-card start-card", "aria-labelledby": "n133-start-title" });
  const main = h("div", { class: "overview-main" }, start, sendBack, ...cards, sellers, recent);
  const side = h("div", { class: "overview-side" }, gameBox, shelfBox);
  const el = h("div", { class: "overview" }, main, side);

  const linkKey = (words: string, to: () => void) => h("button", { class: "btn btn-small btn-quiet link-key", type: "button", onclick: to }, words, h("span", { "aria-hidden": "true" }, "→"));

  function drawGame() {
    const rows = (["character", "signin", "emotes", "freePlay"] as const).map((id) => {
      const on = game ? stateOf(id, game) : null;
      return h("li", {}, h("span", {}, SWITCHES[id].title), on === null ? h("span", { class: "pill" }, "Unknown") : h("span", { class: `pill ${on ? "pill-on" : "pill-off"}` }, on ? "On" : "Off"));
    });
    if (game) rows.push(h("li", {}, h("span", {}, FRIENDS_TITLE), h("span", { class: `pill ${game.friends === "off" ? "pill-off" : "pill-on"}` }, FRIENDS_CHOICES[game.friends]?.name ?? "Unknown")));
    gameBox.replaceChildren(
      h("div", { class: "card-head" }, h("h2", { id: "n133-glance-game" }, "Game switches"), linkKey("Change", () => go("settings"))),
      game ? h("ul", { class: "glance-list" }, ...rows) : h("p", { class: "fine" }, "The game switches could not be read. Reload the page to try again."),
    );
  }

  function drawShelf() {
    const sale = looks.filter((l) => l.priceUsd > 0);
    const prices = sale.map((l) => l.priceUsd);
    const range = prices.length ? (Math.min(...prices) === Math.max(...prices) ? priceText(prices[0]) : `${priceText(Math.min(...prices))} to ${priceText(Math.max(...prices))}`) : "none";
    shelfBox.replaceChildren(
      h("div", { class: "card-head" }, h("h2", { id: "n133-glance-shelf" }, "Shelf"), linkKey("Open", () => go("cosmetics"))),
      h(
        "ul",
        { class: "glance-list" },
        h("li", {}, h("span", {}, "Looks"), h("strong", {}, String(looks.length))),
        h("li", {}, h("span", {}, "For sale"), h("strong", {}, String(sale.length))),
        h("li", {}, h("span", {}, "Prices"), h("strong", {}, range)),
      ),
    );
  }

  drawGame();
  drawShelf();

  function drawSendBack(s: AdminSummary) {
    // Every payment the creator sends back by hand (the game holds no key): the late payments, and the paid rounds not used in time or of deleted players.
    const late = s.orders.filter((o) => o.status === "paid_late" && o.payer).map((o) => ({ key: o.id, name: o.look, payer: o.payer!, xno: o.xno, usd: o.usd, why: "paid_late" }));
    const rows = [...s.sendBack.map((b) => ({ key: b.orderId, name: b.name, payer: b.payer, xno: b.xno, usd: b.usd, why: b.why })), ...late];
    sendBack.hidden = !s.sendBack.length;
    sendBack.replaceChildren(
      h("div", { class: "card-head" }, h("h2", { id: "n133-back-title" }, "To send back"), h("span", { class: "fine" }, `${s.totals.sendBack.xno} XNO · $${s.totals.sendBack.usd}`)),
      h("p", { class: "fine" }, "The game holds no key, so it sends nothing back. Send each amount by hand from your wallet to the address it came from."),
      h(
        "ul",
        { class: "send-back-list" },
        ...rows.map((r) =>
          h(
            "li",
            { class: "late-note", "data-order": r.key },
            icon("back", 16),
            h("span", {}, h("strong", {}, `${r.xno} XNO`), ` ($${r.usd}) · ${r.name} · ${BACK_WHY[r.why] ?? r.why} · to `, h("code", { title: r.payer }, shortAddress(r.payer))),
            copyKey(r.payer, "Copy the address to send it back to", icon("copy", 14)),
          ),
        ),
      ),
    );
  }

  return {
    el,
    showSendBack() {
      if (sendBack.hidden) return;
      sendBack.scrollIntoView?.({ block: "start" });
      sendBack.focus({ preventScroll: true });
    },
    setGame(state) {
      game = state;
      drawGame();
    },
    update(s) {
      const best = bestSellers(s, looks);
      const total = best.length ? [...shelfStats(s.orders, s.players).values()].reduce((n, x) => n + x.paidCents, 0) : 0;
      start.hidden = s.orders.length > 0;
      start.replaceChildren(
        h("div", { class: "start-icon", "aria-hidden": "true" }, icon("sparkle", 28)),
        h("h2", { id: "n133-start-title" }, "No sales yet"),
        h("p", { class: "fine" }, "When a player buys a look, the money and the order show here. Three things to do first:"),
        h(
          "ol",
          { class: "start-steps" },
          h("li", {}, h("strong", {}, "Check your looks and prices."), " ", linkKey("Open the shelf", () => go("cosmetics"))),
          h("li", {}, h("strong", {}, "Choose the two game switches."), " ", linkKey("Open the settings", () => go("settings"))),
          h("li", {}, h("strong", {}, "Share your game's address"), " with your players."),
        ),
      );

      drawSendBack(s);
      sellers.hidden = !best.length;
      sellers.replaceChildren(
        h("div", { class: "card-head" }, h("h2", { id: "n133-best-title" }, "Best sellers"), linkKey(playIds.size ? "All looks and rounds" : "All looks", () => go("cosmetics"))),
        h(
          "ol",
          { class: "best-list" },
          ...best.map((b, i) => {
            const share = total ? Math.round((b.cents / total) * 100) : 0;
            const dot = h("span", { class: "look-dot", "aria-hidden": "true" });
            const c = colourOf(b.id);
            if (c) dot.style.setProperty("--swatch", c);
            const bar = h("div", { class: "share-bar" });
            bar.style.setProperty("--share", `${share}%`);
            return h(
              "li",
              {},
              h("span", { class: "best-rank" }, String(i + 1)),
              dot,
              h("div", { class: "best-main" }, h("div", { class: "best-top" }, h("strong", {}, b.name, playIds.has(b.id) ? h("span", { class: "mark mark-round" }, "Round") : null), h("span", { class: "best-money" }, dollars(b.cents))), h("div", { class: "share", title: `${share}% of the money from sales` }, bar, h("span", { class: "fine" }, `${plural(b.paid, "sale")} · ${share}%`))),
            );
          }),
        ),
      );

      const last = s.orders.slice(0, 5);
      recent.hidden = !last.length;
      recent.replaceChildren(
        h("div", { class: "card-head" }, h("h2", { id: "n133-recent-title" }, "Recent orders"), linkKey("See all orders", () => go("orders", "all"))),
        h("div", { class: "orders is-compact" }, ...last.map((o) => orderRow(o, colourOf, true))),
      );
    },
  };
}
