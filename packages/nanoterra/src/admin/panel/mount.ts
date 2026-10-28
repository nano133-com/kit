// The admin panel: orders, owned looks, totals and the two game switches, from the game's own database. Only the game's owner can read them (the
// handler checks it on every call); this page only shows them. `mountAdmin(element, options)` draws the panel into `element`.

import type { Look } from "../../looks/look.js";
import type { AdminSummary } from "../store.js";
import type { GameState } from "../switches.js";
import { ApiError, createApi, type Api } from "./api.js";
import { h, shortAddress } from "./dom.js";
import { gameCard } from "./gameCard.js";
import { shelfView } from "./shelf.js";

export type MountOptions = {
  /** The game's looks now (its looks.json). The Shelf starts from them. */
  looks: readonly Look[];
  /** Draws the wallet sign-in of the game into `into` and calls `done` when the owner has signed in. Only a wallet signature opens the admin: use the game's admin scope. */
  signIn: (into: HTMLElement, done: () => void) => void;
  /** Signs out of the ADMIN login only (the game's own login, another person's perhaps, stays). */
  signOut: () => Promise<unknown>;
  /** Where the routes are (the handler's basePath). Default "/api/admin". */
  api?: string;
  /** What to tell a game that has no owner address yet. */
  noAddressHelp?: string;
  /** Where the game's default switches are written ("game.config.json"). */
  defaultsFile?: string;
  /** A picture of a look for the Shelf (default: a flat one). */
  lookPicture?: (look: Look) => Element;
  /** What the Shelf says when the status gives no repository. */
  repoHelp?: string;
  /** The `fetch` to use (default: the page's). */
  fetch?: typeof fetch;
};

export type MountedAdmin = {
  /** Reads everything again and redraws. */
  reload(): Promise<void>;
  /** Resolves when the first read has been drawn (a test waits for it). */
  ready: Promise<void>;
};

const STATUS_WORDS: Record<string, string> = { open: "Open", paid: "Paid", expired: "Expired", paid_late: "Paid late" };
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "");

export function mountAdmin(root: HTMLElement, options: MountOptions): MountedAdmin {
  const api: Api = createApi(options.api ?? "/api/admin", options.fetch);
  const gate = h("section", { id: "n133-gate", class: "admin-card", "aria-live": "polite" });
  const data = h("section", { id: "n133-data" });
  data.hidden = true;
  root.classList.add("n133-admin");
  root.replaceChildren(gate, data);

  let filter = "all";
  /** The Shelf keeps its draft while the page redraws (a tab, a payment check): one view for the life of the page. */
  let shelf: ReturnType<typeof shelfView> | null = null;
  /** The "Game" card keeps its own state for the life of the page (a payment check redraws the rest, not this). */
  let game: HTMLElement | null = null;

  /** The card, made once. A fault in reading the two switches must not hide the orders: the card is left out and the rest still shows. */
  async function gameSection(): Promise<HTMLElement | null> {
    if (game) return game;
    try {
      game = gameCard(api, await api.get<GameState>("/game"), options.defaultsFile);
    } catch {
      game = null;
    }
    return game;
  }

  async function load(): Promise<void> {
    try {
      const s = await api.get<AdminSummary>("/summary");
      await gameSection();
      gate.hidden = true;
      render(s);
    } catch (e) {
      if (!(e instanceof ApiError)) {
        gate.hidden = false;
        gate.replaceChildren(h("p", {}, "The game's server did not answer. Try again."));
        return;
      }
      data.hidden = true;
      gate.hidden = false;
      if (e.status === 403 && e.body.signedInAs) {
        gate.replaceChildren(
          h("h2", {}, "Not the game's address"),
          h("p", {}, `You are signed in as ${shortAddress(String(e.body.signedInAs))}. Only the game's owner address can open this page.`),
          signOutButton(),
        );
        return;
      }
      if (e.status === 403 && e.body.reason === "nanoterra") {
        gate.replaceChildren(
          h("h2", {}, "You signed in from Nanoterra"),
          h("p", {}, "A Nanoterra sign-in names your address but proves no key, so it cannot open this page. Sign out, then sign in with the wallet that holds your game's address."),
          signOutButton(),
        );
        return;
      }
      if (e.status === 403 && e.body.reason === "no_address") {
        gate.replaceChildren(h("h2", {}, "No owner address yet"), h("p", {}, e.message), h("p", { class: "fine" }, options.noAddressHelp ?? "Set the game's owner address, then deploy again."));
        return;
      }
      if (e.status === 403) {
        gate.replaceChildren(h("h2", {}, "This page is closed to you"), h("p", {}, e.message), signOutButton());
        return;
      }
      if (e.status === 401) {
        const into = h("div", {});
        gate.replaceChildren(h("h2", {}, "Sign in with your game's address"), h("p", {}, e.message), into);
        options.signIn(into, () => void load());
        return;
      }
      gate.replaceChildren(h("p", {}, e.message));
    }
  }

  function signOutButton(): HTMLButtonElement {
    return h(
      "button",
      {
        class: "btn",
        type: "button",
        onclick: async () => {
          await options.signOut().catch(() => null);
          void load();
        },
      },
      "Sign out",
    );
  }

  function shelfCard(s: AdminSummary): HTMLElement {
    const d = { orders: s.orders, players: s.players, repo: s.repo ?? null };
    if (shelf) shelf.update(d);
    else shelf = shelfView(d, options.looks, options.lookPicture, options.repoHelp);
    return shelf.el;
  }

  function render(s: AdminSummary): void {
    data.hidden = false;
    const check = h("button", { class: "btn btn-primary", type: "button" }, "Check payments now");
    const checkNote = h("span", { class: "fine", role: "status" });
    check.addEventListener("click", async () => {
      check.disabled = true;
      checkNote.textContent = "Checking…";
      try {
        const r = await api.post<{ scan: { scanned: boolean; settled: unknown[]; error?: string }; summary: AdminSummary }>("/check");
        render(r.summary);
      } catch (e) {
        checkNote.textContent = e instanceof Error ? e.message : "The check failed.";
        check.disabled = false;
      }
    });

    const tabs = h("div", { class: "tabs", role: "group", "aria-label": "Show orders" });
    for (const key of ["all", "open", "paid", "expired", "paid_late"]) {
      const n = key === "all" ? s.orders.length : s.counts[key as keyof AdminSummary["counts"]];
      tabs.append(
        h(
          "button",
          {
            class: `tab${filter === key ? " tab-on" : ""}`,
            type: "button",
            "aria-pressed": filter === key ? "true" : "false",
            onclick: () => {
              filter = key;
              render(s);
            },
          },
          `${key === "all" ? "All" : STATUS_WORDS[key]} (${n})`,
        ),
      );
    }

    const rows = s.orders.filter((o) => filter === "all" || o.status === filter);
    const orders = h("div", { class: "orders" });
    if (!rows.length) orders.append(h("p", { class: "fine" }, "No orders here yet."));
    for (const o of rows) {
      orders.append(
        h(
          "article",
          { class: `order order-${o.status}` },
          h("div", { class: "order-top" }, h("strong", {}, o.look), h("span", { class: `badge badge-${o.status}` }, STATUS_WORDS[o.status] ?? o.status)),
          h("div", { class: "order-amount" }, `${o.xno} XNO · $${o.usd}`),
          h("div", { class: "fine" }, `Player ${shortAddress(o.player)} · made ${when(o.createdAt)}`),
          o.paidAt ? h("div", { class: "fine" }, `Payment seen ${when(o.paidAt)}${o.payer ? ` from ${shortAddress(o.payer)}` : ""}`) : null,
          o.status === "paid_late" && o.payer ? h("div", { class: "late-note" }, "Send this amount back by hand to ", h("code", {}, o.payer), ". The game holds no key, so it cannot send it.") : null,
          o.hash ? h("div", { class: "fine hash" }, `Block ${o.hash}`) : null,
        ),
      );
    }

    const players = h("div", { class: "players" });
    if (!s.players.length) players.append(h("p", { class: "fine" }, "Nobody owns a paid look yet."));
    for (const p of s.players) players.append(h("div", { class: "player" }, h("code", {}, p.player), h("span", {}, p.looks.map((l) => l.name).join(", "))));

    const parts: (Node | null)[] = [
      s.warnings.length ? h("section", { class: "admin-card warnings", role: "alert" }, h("h2", {}, "Check these"), h("ul", {}, ...s.warnings.map((w) => h("li", {}, w)))) : null,
      game,
      h(
        "section",
        { class: "totals" },
        h("div", { class: "total" }, h("span", {}, "Paid"), h("strong", {}, `${s.totals.paid.xno} XNO`), h("small", {}, `$${s.totals.paid.usd} · ${plural(s.totals.paid.count, "order")}`)),
        h("div", { class: "total" }, h("span", {}, "Paid late (send back)"), h("strong", {}, `${s.totals.paidLate.xno} XNO`), h("small", {}, `$${s.totals.paidLate.usd} · ${plural(s.totals.paidLate.count, "order")}`)),
        h("div", { class: "total" }, h("span", {}, "Open now"), h("strong", {}, String(s.counts.open)), h("small", {}, `${s.counts.expired} expired`)),
      ),
      shelfCard(s),
      h("section", { class: "admin-card" }, h("div", { class: "card-head" }, h("h2", {}, "Orders"), h("div", {}, ...(s.canCheck === false ? [] : [check, " ", checkNote]))), tabs, orders),
      h("section", { class: "admin-card" }, h("h2", {}, "Owned looks"), players),
      h(
        "section",
        { class: "admin-card fine" },
        s.address ? h("p", {}, "Signed in as ", h("code", {}, s.address), ".") : null,
        s.nodes?.length ? h("p", {}, `Payments are checked on: ${s.nodes.join(", ")}.`) : null,
        s.rate ? h("p", {}, `Last price: $${s.rate.usd} per XNO (${s.rate.sources.join(", ")}), ${when(s.rate.at)}.`) : null,
        signOutButton(),
      ),
    ];
    data.replaceChildren(...parts.filter((p): p is Node => p !== null));
  }

  return { reload: () => load(), ready: load() };
}
