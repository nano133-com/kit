// The Overview tab of /admin: the game at a glance. The best-selling looks with their share of the money, the last five orders, the two game switches as On or
// Off, and the shelf in numbers; each part has a key to its own tab. A game with no sale yet gets three first steps instead of empty lists.

import type { Look } from "../../looks/look.js";
import { priceText } from "../../looks/ladder.js";
import type { AdminSummary } from "../store.js";
import { SWITCHES, stateOf, type GameState } from "../switches.js";
import { dollars, h, plural } from "./dom.js";
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
  /** The two switches as they are now (null: they could not be read). */
  setGame(state: GameState | null): void;
};

export function overviewView(looks: readonly Look[], colourOf: (lookId: string) => string | null, go: (tab: TabId, filter?: OrderFilter) => void): OverviewView {
  let game: GameState | null = null;
  const sellers = h("section", { class: "admin-card best-card", "aria-labelledby": "n133-best-title" });
  const recent = h("section", { class: "admin-card recent-card", "aria-labelledby": "n133-recent-title" });
  const gameBox = h("section", { class: "admin-card glance-card", "aria-labelledby": "n133-glance-game" });
  const shelfBox = h("section", { class: "admin-card glance-card", "aria-labelledby": "n133-glance-shelf" });
  const start = h("section", { class: "admin-card start-card", "aria-labelledby": "n133-start-title" });
  const main = h("div", { class: "overview-main" }, start, sellers, recent);
  const side = h("div", { class: "overview-side" }, gameBox, shelfBox);
  const el = h("div", { class: "overview" }, main, side);

  const linkKey = (words: string, to: () => void) => h("button", { class: "btn btn-small btn-quiet link-key", type: "button", onclick: to }, words, h("span", { "aria-hidden": "true" }, "→"));

  function drawGame() {
    const rows = (["character", "signin"] as const).map((id) => {
      const on = game ? stateOf(id, game) : null;
      return h("li", {}, h("span", {}, SWITCHES[id].title), on === null ? h("span", { class: "pill" }, "Unknown") : h("span", { class: `pill ${on ? "pill-on" : "pill-off"}` }, on ? "On" : "Off"));
    });
    gameBox.replaceChildren(
      h("div", { class: "card-head" }, h("h2", { id: "n133-glance-game" }, "Game switches"), linkKey("Change", () => go("settings"))),
      game ? h("ul", { class: "glance-list" }, ...rows) : h("p", { class: "fine" }, "The two switches could not be read. Reload the page to try again."),
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

  return {
    el,
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

      sellers.hidden = !best.length;
      sellers.replaceChildren(
        h("div", { class: "card-head" }, h("h2", { id: "n133-best-title" }, "Best sellers"), linkKey("All looks", () => go("cosmetics"))),
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
              h("div", { class: "best-main" }, h("div", { class: "best-top" }, h("strong", {}, b.name), h("span", { class: "best-money" }, dollars(b.cents))), h("div", { class: "share", title: `${share}% of the money from sales` }, bar, h("span", { class: "fine" }, `${plural(b.paid, "sale")} · ${share}%`))),
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
