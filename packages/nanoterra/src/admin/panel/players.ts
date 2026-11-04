// The Players tab of /admin: each player who owns a look that a paid order gave them, or who has paid rounds ready (credits), with the looks and the ready
// rounds as chips, and a search (an address, a look or a round). It shows only what the summary gives: the player's address, their looks, their credits.

import type { AdminPlayer, AdminSummary } from "../store.js";
import { copyKey, h, plural, shortAddress } from "./dom.js";
import { icon } from "./icons.js";

/** Whether a player matches a search: their address or the name or id of a look they own. Pure. */
export function playerMatches(p: AdminPlayer, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return p.player.toLowerCase().includes(q) || [...p.looks, ...(p.ready ?? [])].some((l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
}

/** A colour for a player's round mark, from their address: the same address always has the same colour. */
function hueOf(address: string): number {
  let n = 0;
  for (const ch of address.slice(5)) n = (n * 31 + ch.charCodeAt(0)) % 360;
  return n;
}

export function playersView(colourOf: (lookId: string) => string | null): { el: HTMLElement; update(s: AdminSummary): void } {
  let s: AdminSummary | null = null;
  let query = "";
  const search = h("input", { class: "input search-input", type: "search", placeholder: "Address or look", "aria-label": "Search the players", autocomplete: "off", spellcheck: false });
  search.addEventListener("input", () => {
    query = search.value;
    draw();
  });
  const sub = h("p", { class: "fine card-sub" });
  const list = h("div", { class: "players" });
  const tools = h("div", { class: "toolbar" }, h("label", { class: "search" }, icon("search", 18), search));
  const heading = h("h2", {}, "Players who own a look");
  const el = h("section", { class: "admin-card players-card" }, h("div", { class: "card-head" }, h("div", { class: "card-title" }, heading, sub)), tools, list);

  function draw() {
    if (!s) return;
    const owned = s.players.reduce((n, p) => n + p.looks.length, 0);
    const ready = s.players.reduce((n, p) => n + (p.ready ?? []).reduce((m, r) => m + r.ready, 0), 0);
    const rounds = (s.plays ?? []).length > 0;
    heading.textContent = rounds ? "Players" : "Players who own a look";
    sub.textContent = s.players.length
      ? `${plural(s.players.length, "player")} own ${plural(owned, "look")} that a paid order gave them${rounds ? `, and have ${plural(ready, "paid round")} ready` : ""}.`
      : rounds
        ? "A player shows here when a paid order gives them a look or a round."
        : "A player shows here when a paid order gives them a look.";
    tools.hidden = s.players.length < 2;
    const rows = s.players.filter((p) => playerMatches(p, query));
    list.replaceChildren(
      ...rows.map((p) => {
        const mark = h("span", { class: "player-mark", "aria-hidden": "true" });
        mark.style.setProperty("--hue", String(hueOf(p.player)));
        return h(
          "article",
          { class: "player" },
          mark,
          h(
            "div",
            { class: "player-main" },
            h("div", { class: "player-id" }, h("code", { title: p.player }, shortAddress(p.player)), copyKey(p.player, "Copy the player's address", icon("copy", 14))),
            h(
              "ul",
              { class: "look-chips", "aria-label": "Looks they own" },
              ...p.looks.map((l) => {
                const dot = h("span", { class: "look-dot", "aria-hidden": "true" });
                const c = colourOf(l.id);
                if (c) dot.style.setProperty("--swatch", c);
                return h("li", { class: "look-chip" }, dot, l.name);
              }),
            ),
            p.ready?.length ? h("ul", { class: "look-chips ready-chips", "aria-label": "Paid rounds ready" }, ...p.ready.map((r) => h("li", { class: "look-chip ready-chip" }, h("span", { class: "mark mark-round" }, `${r.ready} ready`), r.name))) : null,
          ),
          h("span", { class: "player-count" }, plural(p.looks.length, "look")),
        );
      }),
    );
    if (!s.players.length) list.append(h("p", { class: "empty" }, rounds ? "Nobody owns a paid look or has a round ready yet." : "Nobody owns a paid look yet."));
    else if (!rows.length) list.append(h("p", { class: "empty" }, "No player matches your search."));
  }

  return {
    el,
    update(next) {
      s = next;
      draw();
    },
  };
}
