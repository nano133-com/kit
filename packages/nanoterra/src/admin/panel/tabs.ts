// The panel's tab bar: Overview, Cosmetics, Orders, Players and Settings. Real tabs (role tablist, tab and tabpanel): a press or the arrow keys, Home and End
// choose one, and only the chosen tab is in the Tab order. Every panel is made once and only hidden, so a draft, a search or a switch keeps its state when
// the creator goes to another tab and back. The choice lives in this page's memory only: the panel never writes the page's address (the host page owns it).

import { h } from "./dom.js";
import { icon, type IconName } from "./icons.js";

export type TabId = "overview" | "cosmetics" | "orders" | "players" | "settings";

export const TABS: readonly { id: TabId; label: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", icon: "overview" },
  { id: "cosmetics", label: "Cosmetics", icon: "shirt" },
  { id: "orders", label: "Orders", icon: "receipt" },
  { id: "players", label: "Players", icon: "players" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export type TabBar = {
  /** The bar (role tablist). */
  bar: HTMLElement;
  /** The panel of each tab (role tabpanel), empty: the caller fills it. */
  panels: Record<TabId, HTMLElement>;
  /**
   * Shows a tab. `focus` moves the keyboard to it (an arrow key does; a link from another tab does not). When the page was scrolled into the panels, the top of
   * the new panel comes up under the bar (a short tab after a long one must not open at its end).
   */
  select(id: TabId, focus?: boolean): void;
  /** The tab that shows now. */
  readonly current: TabId;
  /** The small number on a tab ("Orders 25"); null takes it away. */
  setCount(id: TabId, n: number | null): void;
};

export function tabBar(first: TabId = "overview"): TabBar {
  let current: TabId = first;
  const bar = h("div", { class: "tabbar", role: "tablist", "aria-label": "Admin sections" });
  const buttons = {} as Record<TabId, HTMLButtonElement>;
  const counts = {} as Record<TabId, HTMLElement>;
  const panels = {} as Record<TabId, HTMLElement>;

  for (const t of TABS) {
    counts[t.id] = h("span", { class: "tab-count" });
    counts[t.id].hidden = true;
    const b = h(
      "button",
      { class: "tabbar-tab", type: "button", role: "tab", id: `n133-tab-${t.id}`, "aria-controls": `n133-panel-${t.id}` },
      icon(t.icon, 18),
      h("span", { class: "tab-label" }, t.label),
      counts[t.id],
    );
    b.addEventListener("click", () => select(t.id));
    b.addEventListener("keydown", (e: KeyboardEvent) => {
      const i = TABS.findIndex((x) => x.id === t.id);
      const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : null;
      if (next === null) return;
      e.preventDefault();
      select(TABS[(next + TABS.length) % TABS.length].id, true);
    });
    buttons[t.id] = b;
    bar.append(b);
    panels[t.id] = h("section", { class: `tabpanel tabpanel-${t.id}`, role: "tabpanel", id: `n133-panel-${t.id}`, "aria-labelledby": `n133-tab-${t.id}`, tabindex: 0 });
  }

  function select(id: TabId, focus = false) {
    current = id;
    for (const t of TABS) {
      const on = t.id === id;
      buttons[t.id].setAttribute("aria-selected", on ? "true" : "false");
      buttons[t.id].tabIndex = on ? 0 : -1;
      buttons[t.id].classList.toggle("is-on", on);
      panels[t.id].hidden = !on;
    }
    if (focus) buttons[id].focus({ preventScroll: true });
    // Keep the chosen tab in view in the bar, when the bar scrolls sideways (only the bar moves).
    const b = buttons[id];
    if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft = Math.max(0, b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2);
    const panel = panels[id];
    if (panel.isConnected && panel.getBoundingClientRect().top < bar.getBoundingClientRect().bottom) panel.scrollIntoView?.({ block: "start" });
  }

  select(first);
  return {
    bar,
    panels,
    select,
    get current() {
      return current;
    },
    setCount(id, n) {
      counts[id].hidden = n === null;
      counts[id].textContent = n === null ? "" : n.toLocaleString("en-US");
    },
  };
}
