// The admin panel: orders, owned looks, totals and the two game switches, from the game's own database. Only the game's owner can read them (the
// handler checks it on every call); this page only shows them. `mountAdmin(element, options)` draws the panel into `element`.
//
// The page: a top bar (who is signed in, Live or Test mode, Sign out), what is still off (one banner), four numbers (earned, open now, to send back, players;
// each opens its list), then five tabs: Overview, Cosmetics (the Shelf), Orders, Players and Settings (the Game card, the sign-ins, the facts). Every tab is
// made once; a new read of the summary fills them again and keeps the chosen tab, the Shelf's draft, a search and the Game card.

import type { Look } from "../../looks/look.js";
import type { AdminSummary } from "../store.js";
import type { GameState } from "../switches.js";
import { ApiError, createApi, type Api } from "./api.js";
import { copyKey, h, plural, shortAddress } from "./dom.js";
import { gameCard } from "./gameCard.js";
import { icon, type IconName } from "./icons.js";
import { ordersView, type OrderFilter } from "./orders.js";
import { overviewView } from "./overview.js";
import { playersView } from "./players.js";
import { shelfView } from "./shelf.js";
import { signinsCard } from "./signins.js";
import { tabBar, type TabId } from "./tabs.js";

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
  /** What the Sign-ins card says about what the game keeps and for how long ("30 days"). Default: only the time, the rough country and a short browser name. */
  loginsNote?: string;
  /** The `fetch` to use (default: the page's). */
  fetch?: typeof fetch;
};

export type MountedAdmin = {
  /** Reads everything again and redraws. */
  reload(): Promise<void>;
  /** Resolves when the first read has been drawn (a test waits for it). */
  ready: Promise<void>;
};

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "");

/** The drawn page, made at the first read that the owner may see. */
type Dashboard = { update(s: AdminSummary): void; setGame(state: GameState | null): void };

export function mountAdmin(root: HTMLElement, options: MountOptions): MountedAdmin {
  const api: Api = createApi(options.api ?? "/api/admin", options.fetch);
  const gate = h("section", { id: "n133-gate", class: "admin-card gate", "aria-live": "polite" });
  const data = h("section", { id: "n133-data" });
  data.hidden = true;
  root.classList.add("n133-admin");
  root.replaceChildren(gate, data);

  /** The Shelf keeps its draft while the page redraws (a tab, a payment check): one view for the life of the page. */
  let shelf: ReturnType<typeof shelfView> | null = null;
  /** The "Game" card keeps its own state for the life of the page (a payment check redraws the rest, not this). */
  let game: HTMLElement | null = null;
  let gameState: GameState | null = null;
  let dash: Dashboard | null = null;

  /** The card, made once. A fault in reading the two switches must not hide the orders: the card is left out and the rest still shows. */
  async function gameSection(): Promise<HTMLElement | null> {
    if (game) return game;
    try {
      gameState = await api.get<GameState>("/game");
      game = gameCard(api, gameState, options.defaultsFile, (state) => {
        gameState = state;
        dash?.setGame(state);
      });
    } catch {
      game = null;
      gameState = null;
    }
    return game;
  }

  /** The gate's screen: an icon, a title and what to do. The data drawn before goes (a signed-out page holds none); the Shelf's draft and the Game card stay in memory. */
  function showGate(kind: IconName, title: string, ...body: (Node | null)[]) {
    data.hidden = true;
    data.replaceChildren();
    dash = null;
    gate.hidden = false;
    gate.replaceChildren(h("div", { class: "gate-icon", "aria-hidden": "true" }, icon(kind, 28)), h("h2", {}, title), ...body.filter((b): b is Node => b !== null));
  }

  async function load(): Promise<void> {
    try {
      const s = await api.get<AdminSummary>("/summary");
      await gameSection();
      gate.hidden = true;
      render(s);
    } catch (e) {
      if (!(e instanceof ApiError)) {
        // The data already drawn (if any) stays: a failed new read does not take it away.
        gate.hidden = false;
        gate.replaceChildren(h("div", { class: "gate-icon", "aria-hidden": "true" }, icon("alert", 28)), h("p", {}, "The game's server did not answer. Try again."), h("button", { class: "btn", type: "button", onclick: () => void load() }, "Try again"));
        return;
      }
      if (e.status === 403 && e.body.signedInAs) {
        showGate("lock", "Not the game's address", h("p", {}, `You are signed in as ${shortAddress(String(e.body.signedInAs))}. Only the game's owner address can open this page.`), signOutButton());
        return;
      }
      if (e.status === 403 && e.body.reason === "nanoterra") {
        showGate("lock", "You signed in from Nanoterra", h("p", {}, "A Nanoterra sign-in names your address but proves no key, so it cannot open this page. Sign out, then sign in with the wallet that holds your game's address."), signOutButton());
        return;
      }
      if (e.status === 403 && e.body.reason === "no_address") {
        showGate("alert", "No owner address yet", h("p", {}, e.message), h("p", { class: "fine" }, options.noAddressHelp ?? "Set the game's owner address, then deploy again."));
        return;
      }
      if (e.status === 403) {
        showGate("lock", "This page is closed to you", h("p", {}, e.message), signOutButton());
        return;
      }
      if (e.status === 401) {
        const into = h("div", { class: "gate-signin" });
        showGate("lock", "Sign in with your game's address", h("p", {}, e.message), into);
        options.signIn(into, () => void load());
        return;
      }
      showGate("alert", "Something went wrong", h("p", {}, e.message));
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
      icon("out", 18),
      "Sign out",
    );
  }

  function shelfCard(s: AdminSummary): HTMLElement {
    const d = { orders: s.orders, players: s.players, repo: s.repo ?? null };
    if (shelf) shelf.update(d);
    else shelf = shelfView(d, options.looks, options.lookPicture, options.repoHelp);
    return shelf.el;
  }

  /** A look's body colour, while the game still has the look (for the dots in the lists). */
  const colourOf = (id: string): string | null => options.looks.find((l) => l.id === id)?.change.body ?? null;

  function build(): Dashboard {
    const tabs = tabBar("overview");
    const go = (tab: TabId, filter?: OrderFilter) => {
      if (filter) orders.setFilter(filter);
      tabs.select(tab);
    };
    const overview = overviewView(options.looks, colourOf, go);
    const orders = ordersView(api, colourOf, (s) => render(s));
    const players = playersView(colourOf);
    tabs.panels.overview.append(overview.el);
    tabs.panels.orders.append(orders.el);
    tabs.panels.players.append(players.el);

    const who = h("div", { class: "who" });
    const chips = h("div", { class: "chips" });
    const top = h("header", { class: "topbar" }, h("div", { class: "who-mark", "aria-hidden": "true" }, icon("lock", 18)), who, chips, h("div", { class: "topbar-keys" }, signOutButton()));
    const banner = h("div", { class: "banner warnings", role: "alert" });
    const kpis = h("div", { class: "kpis", role: "group", "aria-label": "Your game in numbers" });
    const settings = h("div", { class: "settings-grid" });
    tabs.panels.settings.append(settings);
    data.replaceChildren(top, banner, kpis, tabs.bar, ...Object.values(tabs.panels));

    const kpi = (cls: string, mark: IconName, label: string, value: string, sub: string, open: () => void, alert = false) =>
      h("button", { class: `kpi kpi-${cls}${alert ? " is-alert" : ""}`, type: "button", onclick: open }, h("span", { class: "kpi-top" }, h("span", { class: "kpi-icon", "aria-hidden": "true" }, icon(mark, 18)), h("span", { class: "kpi-label" }, label)), h("strong", { class: "kpi-value" }, value), h("span", { class: "kpi-sub" }, sub));

    function about(s: AdminSummary): HTMLElement {
      const facts: [string, Node | string][] = [];
      if (s.address) facts.push(["Signed in as", h("span", { class: "fact-address" }, h("code", {}, s.address), copyKey(s.address, "Copy your address", icon("copy", 14)))]);
      facts.push(["Mode", s.testMode ? "Test mode: payments are not real" : "Live: payments are real"]);
      if (s.turnstile !== undefined) facts.push(["Bot check", s.turnstile ? "On" : "Off"]);
      if (s.nodes?.length) facts.push(["Payments are checked on", s.nodes.join(", ")]);
      if (s.rate) facts.push(["Last price", `$${s.rate.usd} per XNO (${s.rate.sources.join(", ")}), ${when(s.rate.at)}`]);
      return h(
        "section",
        { class: "admin-card about-card", "aria-labelledby": "n133-about-title" },
        h("h2", { id: "n133-about-title" }, "About this admin"),
        h("dl", { class: "facts" }, ...facts.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))),
        signOutButton(),
      );
    }

    return {
      setGame: (state) => overview.setGame(state),
      update(s) {
        who.replaceChildren(h("span", { class: "who-label" }, "Signed in as"), s.address ? h("span", { class: "who-address" }, h("code", { title: s.address }, shortAddress(s.address)), copyKey(s.address, "Copy your address", icon("copy", 14))) : h("span", {}, "the game's owner"));
        chips.replaceChildren(
          h("span", { class: `chip ${s.testMode ? "chip-warn" : "chip-ok"}`, title: s.testMode ? "Payments are not real" : "Payments are real" }, h("span", { class: "chip-dot", "aria-hidden": "true" }), s.testMode ? "Test mode" : "Live"),
          s.turnstile === undefined ? "" : h("span", { class: `chip ${s.turnstile ? "chip-ok" : "chip-warn"}` }, h("span", { class: "chip-dot", "aria-hidden": "true" }), s.turnstile ? "Bot check on" : "Bot check off"),
        );
        banner.hidden = !s.warnings.length;
        banner.replaceChildren(h("div", { class: "banner-icon", "aria-hidden": "true" }, icon("alert", 20)), h("div", {}, h("h2", {}, "Check these"), h("ul", {}, ...s.warnings.map((w) => h("li", {}, w)))));

        const ownedLooks = s.players.reduce((n, p) => n + p.looks.length, 0);
        const late = s.totals.paidLate.count;
        kpis.replaceChildren(
          kpi("earned", "coin", "Earned", `${s.totals.paid.xno} XNO`, `$${s.totals.paid.usd} · ${plural(s.totals.paid.count, "order")}`, () => go("orders", "paid")),
          kpi("open", "clock", "Open now", String(s.counts.open), `${s.counts.expired} expired`, () => go("orders", "open")),
          kpi("late", "back", "To send back", `${s.totals.paidLate.xno} XNO`, late ? `$${s.totals.paidLate.usd} · ${plural(late, "order")}` : "Nothing to send back", () => go("orders", "paid_late"), late > 0),
          kpi("players", "players", "Players", String(s.players.length), `${plural(ownedLooks, "look")} owned`, () => go("players")),
        );

        tabs.setCount("cosmetics", options.looks.length);
        tabs.setCount("orders", s.orders.length);
        tabs.setCount("players", s.players.length);
        overview.update(s);
        overview.setGame(gameState);
        const shelfEl = shelfCard(s);
        if (shelfEl.parentNode !== tabs.panels.cosmetics) tabs.panels.cosmetics.replaceChildren(shelfEl);
        orders.update(s);
        players.update(s);
        // The Game card is the same element at every redraw: moving it keeps its state.
        settings.replaceChildren(...[game, signinsCard(s, api, () => void load(), options.loginsNote), about(s)].filter((p): p is HTMLElement => p !== null));
      },
    };
  }

  function render(s: AdminSummary): void {
    data.hidden = false;
    dash ??= build();
    dash.update(s);
  }

  return { reload: () => load(), ready: load() };
}

