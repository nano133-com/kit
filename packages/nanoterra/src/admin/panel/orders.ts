// The Orders tab of /admin: every order of the game (the summary gives the newest 500), a filter by status with its count, a search (a look, a player's or a
// payer's address, a block), and "Check payments now" when the game gave a check. A row is a card on a phone and a line of a table on a wide screen. A
// payment that came after its order ran out says what to do: the game holds no key, so the owner sends the amount back by hand.

import type { AdminOrder, AdminSummary } from "../store.js";
import type { Api } from "./api.js";
import { ago, copyKey, h, plural, shortAddress } from "./dom.js";
import { icon } from "./icons.js";

export type OrderFilter = "all" | "open" | "paid" | "expired" | "paid_late";

/** How many orders the list draws at first, and how many more each "Show more" adds. */
export const ORDERS_PAGE = 20;

export const STATUS_WORDS: Record<string, string> = { open: "Open", paid: "Paid", expired: "Expired", paid_late: "Paid late" };
const FILTERS: readonly OrderFilter[] = ["all", "paid", "open", "paid_late", "expired"];

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "");
/** "A1B2C3D4…E5F6A7" */
const shortHash = (hash: string) => (hash.length > 16 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash);

/** Whether an order matches a search: its look's name or id, the player's or the payer's address, or its block. Upper or lower case does not matter. Pure. */
export function orderMatches(o: AdminOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [o.look, o.lookId, o.player, o.payer ?? "", o.hash ?? ""].some((v) => v.toLowerCase().includes(q));
}

/** A status as a coloured badge. */
export const badge = (status: string) => h("span", { class: `badge badge-${status}` }, STATUS_WORDS[status] ?? status);

/** One order: a card on a phone, a line of the table on a wide screen. `colourOf` gives the look's body colour for its dot, when the game still has the look. */
export function orderRow(o: AdminOrder, colourOf: (lookId: string) => string | null, compact = false): HTMLElement {
  const dot = h("span", { class: "look-dot", "aria-hidden": "true" });
  const c = colourOf(o.lookId);
  if (c) dot.style.setProperty("--swatch", c);
  const row = h(
    "article",
    { class: `order order-${o.status}${compact ? " is-compact" : ""}` },
    h("div", { class: "order-look" }, dot, h("strong", {}, o.look)),
    h("div", { class: "order-status" }, badge(o.status)),
    h("div", { class: "order-amount" }, h("strong", {}, `${o.xno} XNO`), h("span", { class: "fine" }, `$${o.usd}`)),
    h("div", { class: "order-player" }, h("span", { class: "fine cell-label" }, "Player "), h("code", { title: o.player }, shortAddress(o.player)), compact ? null : copyKey(o.player, "Copy the player's address", icon("copy", 14))),
    compact
      ? h("div", { class: "order-when" }, o.paidAt ? h("span", { title: when(o.paidAt) }, `Paid ${ago(o.paidAt)}`) : h("span", { title: when(o.createdAt) }, `Made ${ago(o.createdAt)}`))
      : h(
          "div",
          { class: "order-when" },
          h("span", { title: when(o.createdAt) }, `Made ${ago(o.createdAt)}`),
          o.paidAt ? h("span", { class: "fine", title: when(o.paidAt) }, `Paid ${ago(o.paidAt)}${o.payer && o.payer !== o.player ? ` from ${shortAddress(o.payer)}` : ""}`) : null,
        ),
  );
  if (compact) return row;
  if (o.status === "paid_late" && o.payer)
    row.append(h("div", { class: "late-note order-extra" }, icon("back", 16), h("span", {}, "Send this amount back by hand to ", h("code", {}, o.payer), ". The game holds no key, so it cannot send it."), copyKey(o.payer, "Copy the address to send it back to", icon("copy", 14))));
  if (o.hash) row.append(h("div", { class: "fine order-extra order-hash" }, h("span", {}, "Block "), h("code", { title: o.hash }, shortHash(o.hash)), copyKey(o.hash, "Copy the block hash", icon("copy", 14))));
  return row;
}

export type OrdersView = {
  el: HTMLElement;
  update(s: AdminSummary): void;
  /** Shows only one status (a press on a number of the Overview does it). */
  setFilter(f: OrderFilter): void;
};

/**
 * The tab's content, made once: its filter, its search and its check keep their state when the summary is read again. `colourOf` gives a look's body colour;
 * `onSummary` hears the summary that "Check payments now" answers with (the panel draws it everywhere).
 */
export function ordersView(api: Api, colourOf: (lookId: string) => string | null, onSummary: (s: AdminSummary) => void): OrdersView {
  let s: AdminSummary | null = null;
  let filter: OrderFilter = "all";
  let query = "";
  let shown = ORDERS_PAGE;

  const check = h("button", { class: "btn btn-primary", type: "button" }, icon("refresh", 18), "Check payments now");
  const checkNote = h("span", { class: "fine", role: "status" });
  check.addEventListener("click", async () => {
    check.disabled = true;
    checkNote.textContent = "Checking…";
    try {
      const r = await api.post<{ scan: { scanned: boolean; settled: unknown[]; error?: string }; summary: AdminSummary }>("/check");
      checkNote.textContent = !r.scan?.scanned ? "The check did not finish. Try again in a moment." : r.scan.settled.length ? `Checked: ${plural(r.scan.settled.length, "payment")} found.` : "Checked: no new payment.";
      onSummary(r.summary);
    } catch (e) {
      checkNote.textContent = e instanceof Error ? e.message : "The check failed.";
    } finally {
      check.disabled = false;
    }
  });

  const seg = h("div", { class: "seg tabs", role: "group", "aria-label": "Show orders" });
  const search = h("input", { class: "input search-input", type: "search", placeholder: "Look, address or block", "aria-label": "Search the orders", autocomplete: "off", spellcheck: false });
  search.addEventListener("input", () => {
    query = search.value;
    shown = ORDERS_PAGE;
    drawList();
  });
  const count = h("p", { class: "fine list-count", role: "status", "aria-live": "polite" });
  const list = h("div", { class: "orders" });
  // The check key is there only when the game gave a check (the summary's canCheck).
  const keys = h("div", { class: "card-keys" });
  const head = h("div", { class: "card-head" }, h("div", { class: "card-title" }, h("h2", {}, "Orders"), h("p", { class: "fine card-sub" }, "Every order your game made, newest first.")), keys);
  const el = h(
    "section",
    { class: "admin-card orders-card" },
    head,
    h("div", { class: "toolbar" }, seg, h("label", { class: "search" }, icon("search", 18), search)),
    count,
    h("div", { class: "order-table-head", "aria-hidden": "true" }, h("span", {}, "Look"), h("span", {}, "Status"), h("span", {}, "Amount"), h("span", {}, "Player"), h("span", {}, "When")),
    list,
  );

  function drawFilter() {
    if (!s) return;
    const sum = s;
    seg.replaceChildren(
      ...FILTERS.map((key) => {
        const n = key === "all" ? sum.orders.length : sum.counts[key];
        return h(
          "button",
          {
            class: `seg-btn tab${filter === key ? " is-on tab-on" : ""}${key === "paid_late" && n > 0 ? " is-alert" : ""}`,
            type: "button",
            "aria-pressed": filter === key ? "true" : "false",
            onclick: () => {
              filter = key;
              shown = ORDERS_PAGE;
              drawFilter();
              drawList();
            },
          },
          `${key === "all" ? "All" : STATUS_WORDS[key]} (${n})`,
        );
      }),
    );
  }

  function drawList() {
    if (!s) return;
    const rows = s.orders.filter((o) => (filter === "all" || o.status === filter) && orderMatches(o, query));
    const total = s.orders.filter((o) => filter === "all" || o.status === filter).length;
    count.textContent = query.trim() ? `${plural(rows.length, "order")} of ${total} match “${query.trim()}”.` : "";
    count.hidden = !query.trim();
    list.replaceChildren(...rows.slice(0, shown).map((o) => orderRow(o, colourOf)));
    if (!rows.length) list.append(h("p", { class: "empty" }, query.trim() ? "No order matches your search." : "No orders here yet."));
    if (rows.length > shown) {
      const more = Math.min(ORDERS_PAGE, rows.length - shown);
      list.append(
        h("button", { class: "btn more-key", type: "button", onclick: () => ((shown += ORDERS_PAGE), drawList()) }, `Show ${more} more`, rows.length - shown > more ? h("span", { class: "fine" }, `of ${rows.length - shown}`) : null),
      );
    }
  }

  return {
    el,
    update(next) {
      s = next;
      if (next.canCheck === false) keys.replaceChildren();
      else if (check.parentNode !== keys) keys.replaceChildren(check, checkNote);
      drawFilter();
      drawList();
    },
    setFilter(f) {
      filter = f;
      shown = ORDERS_PAGE;
      drawFilter();
      drawList();
    },
  };
}
