// The Options key and panel of a game: `mountOptions(element, store, options)`. Plain DOM, no framework, no Three.js. It draws the store's defs (../core.ts)
// in two tabs, Basic and Advanced, each in its groups, and writes every change to the store at once: there is no Save key. A change from elsewhere (the game
// sets a value, another view resets one) shows at once too, and a section a module adds later (store.add) is drawn when it comes.
//
//   toggle   a switch: the whole row is the key (role="switch").
//   choice   a row of keys (role="radiogroup", the arrow keys move) for at most 4 short choices, else a drop-down; a def's `display` chooses.
//   range    a slider with its value and unit beside the label. A slider that a finger or the mouse holds is never drawn again under it.
//   key      a key binding: the key's name; pressed, it waits for the next key (Escape or Tab stops waiting). A key another binding has is swapped (the store does it).
//
// Rows are drawn once and changed in place; the panel never scrolls back to the top on a change (Echo Island's draft, 2026-11-01).
// "Reset to defaults" asks in the panel (a question and a key for each answer), never in a browser dialog. Escape answers the question first, then closes.
// The panel is phone first: a sheet from the bottom on a phone held upright, from the right on a wide or sideways screen; every key is 44 px or more.
// `key: false` draws no key, for a game that opens the panel from its own pause menu (`open()`).

import { h, releaseFocus } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import { helpKeys, helpText, keyLabel, type ChoiceDef, type KeyDef, type OptionDef, type OptionsStore, type OptionValue, type RangeDef, type Tab, type ToggleDef } from "../core.js";

export type OptionsMountOptions = {
  /** The panel's heading and the key's word. Default "Options". */
  title?: string;
  /** Draw the Options key (a gear and the word). Default true; false for a game that calls `open()` from its own menu. */
  key?: boolean;
  /** Called when the panel opens and closes (a game may pause under it). */
  onOpen?: () => void;
  onClose?: () => void;
  /** A slider was let go (a game plays a sound at the new level). */
  onRangeDone?: (key: string, value: number) => void;
  /** Asks the player a yes or no question (default: a question in the panel, with a key for each answer; never a browser dialog). */
  confirm?: (question: string) => boolean | Promise<boolean>;
  /**
   * Where the keyboard focus goes when the panel closes. "game" (the default): out of the key and the panel, to the page, so Space and the game's
   * other keys reach the game again (a focused key would take Space and open the panel again). "key": back to the key, for a page with no keys of its own.
   */
  focusAfterClose?: "game" | "key";
};

export type MountedOptions = {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** Removes the key and the panel and stops hearing the store. */
  destroy(): void;
};

export const TAB_WORDS: Record<Tab, string> = { basic: "Basic", advanced: "Advanced" };
const TABS: readonly Tab[] = ["basic", "advanced"];
export const RESET_QUESTION = "Put every option back to its default?";
/** On a key binding while it waits for its key. */
export const PRESS_A_KEY = "Press a key";

/** "80%", "3 s", "50". */
export const rangeText = (def: Pick<RangeDef, "unit">, v: number): string => `${v}${def.unit ?? ""}`;

/** Buttons for at most 4 choices of at most 10 characters, else a list; the def's `display` wins. */
export const choiceDisplay = (def: ChoiceDef): "buttons" | "list" => def.display ?? (def.choices.length <= 4 && def.choices.every((c) => c.label.length <= 10) ? "buttons" : "list");

let mounts = 0;

export function mountOptions(root: HTMLElement, store: OptionsStore, options: OptionsMountOptions = {}): MountedOptions {
  const n = ++mounts;
  const id = (part: string) => `n133o-${n}-${part}`;
  const title = options.title ?? "Options";
  let isOpen = false;
  let destroyed = false;
  let tab: Tab = "basic";
  let returnTo: HTMLElement | null = null;
  const cleanup: (() => void)[] = [];

  const key =
    options.key === false
      ? null
      : h("button", { class: "n133o-key", type: "button", "aria-expanded": "false", "aria-controls": id("panel"), "aria-haspopup": "dialog" }, icon("gear", 20), h("span", { class: "n133o-key-word" }, title));
  const closeKey = h("button", { class: "n133o-close", type: "button", "aria-label": `Close ${title.toLowerCase()}` }, icon("close", 20));
  const tabKeys = Object.fromEntries(
    TABS.map((t) => [t, h("button", { class: "n133o-tab", type: "button", role: "tab", id: id(`tab-${t}`), "aria-controls": id(`pane-${t}`), "data-tab": t }, TAB_WORDS[t])]),
  ) as Record<Tab, HTMLButtonElement>;
  const tabList = h("div", { class: "n133o-tabs", role: "tablist", "aria-label": title }, tabKeys.basic, tabKeys.advanced);
  const panes = Object.fromEntries(TABS.map((t) => [t, h("div", { class: "n133o-pane", role: "tabpanel", id: id(`pane-${t}`), "aria-labelledby": id(`tab-${t}`), "data-tab": t })])) as Record<Tab, HTMLDivElement>;
  const body = h("div", { class: "n133o-body" }, panes.basic, panes.advanced);

  const question = h("p", { class: "n133o-ask-q", id: id("ask") });
  const yesKey = h("button", { class: "n133o-btn n133o-primary", type: "button" });
  const noKey = h("button", { class: "n133o-btn", type: "button" }, "Cancel");
  const askBox = h("div", { class: "n133o-ask", role: "alertdialog", "aria-labelledby": id("ask") }, question, h("div", { class: "n133o-ask-keys" }, yesKey, noKey));
  askBox.hidden = true;
  const resetKey = h("button", { class: "n133o-btn n133o-reset", type: "button" }, icon("refresh", 18), "Reset to defaults");
  const foot = h("footer", { class: "n133o-foot" }, askBox, resetKey);

  const panel = h(
    "section",
    { class: "n133o-panel", id: id("panel"), role: "dialog", "aria-modal": "true", "aria-labelledby": id("title"), "data-open": "false" },
    h("header", { class: "n133o-head" }, h("h2", { class: "n133o-title", id: id("title") }, title), closeKey),
    tabList,
    body,
    foot,
  );
  const scrim = h("div", { class: "n133o-scrim", "data-open": "false", "aria-hidden": "true" });
  const wrap = h("div", { class: "n133-options" }, key, scrim, panel);
  root.append(wrap);

  // ---- the rows ----

  /** Each drawn key's way to show a new value. */
  let shows = new Map<string, (v: OptionValue) => void>();
  /** The help lines that name a key binding ("{key:keys.emotes}"), by that binding's key: each draws its words again when the binding changes. */
  let helps = new Map<string, (() => void)[]>();

  const textOf = (def: OptionDef, labelTag: "span" | "label" = "span", forId?: string) => {
    const label = h(labelTag, { class: "n133o-label", id: id(`l-${def.key}`), for: forId }, def.label);
    const help = def.help ? h("span", { class: "n133o-help", id: id(`h-${def.key}`) }, helpText(def.help, store)) : null;
    if (help && def.help) {
      const words = def.help;
      for (const k of helpKeys(words)) helps.set(k, [...(helps.get(k) ?? []), () => (help.textContent = helpText(words, store))]);
    }
    return { label, help, describedBy: help ? id(`h-${def.key}`) : undefined };
  };

  function toggleRow(def: ToggleDef): HTMLElement {
    const t = textOf(def);
    const row = h(
      "button",
      { class: "n133o-row n133o-toggle", type: "button", role: "switch", "aria-labelledby": id(`l-${def.key}`), "aria-describedby": t.describedBy, "data-key": def.key },
      h("span", { class: "n133o-text" }, t.label, t.help),
      h("span", { class: "n133o-switch", "aria-hidden": "true" }, h("span", { class: "n133o-knob" })),
    );
    row.addEventListener("click", () => store.set(def.key, !store.get<boolean>(def.key)));
    shows.set(def.key, (v) => row.setAttribute("aria-checked", String(v === true)));
    return row;
  }

  function choiceRow(def: ChoiceDef): HTMLElement {
    if (choiceDisplay(def) === "list") {
      const selectId = id(`c-${def.key}`);
      const t = textOf(def, "label", selectId);
      const byIndex = def.choices.map((c) => c.value);
      const select = h("select", { class: "n133o-select", id: selectId, "aria-describedby": t.describedBy }, ...def.choices.map((c, i) => h("option", { value: String(i) }, c.label)));
      select.addEventListener("change", () => store.set(def.key, byIndex[Number(select.value)]));
      shows.set(def.key, (v) => (select.value = String(Math.max(0, byIndex.indexOf(v as never)))));
      return h("div", { class: "n133o-row n133o-choice", "data-key": def.key }, h("span", { class: "n133o-text" }, t.label, t.help), select);
    }
    const t = textOf(def);
    const keys = def.choices.map((c) => h("button", { class: "n133o-seg-key", type: "button", role: "radio" }, c.label));
    const group = h("div", { class: "n133o-seg", role: "radiogroup", "aria-labelledby": id(`l-${def.key}`), "aria-describedby": t.describedBy }, ...keys);
    keys.forEach((k, i) => k.addEventListener("click", () => store.set(def.key, def.choices[i].value)));
    group.addEventListener("keydown", (e) => {
      const at = keys.indexOf(document.activeElement as HTMLButtonElement);
      const to = moveKey(e as KeyboardEvent, at, keys.length);
      if (to === null) return;
      e.preventDefault();
      store.set(def.key, def.choices[to].value);
      keys[to].focus();
    });
    shows.set(def.key, (v) =>
      keys.forEach((k, i) => {
        const on = def.choices[i].value === v;
        k.setAttribute("aria-checked", String(on));
        k.tabIndex = on ? 0 : -1;
      }),
    );
    return h("div", { class: "n133o-row n133o-choice", "data-key": def.key }, h("span", { class: "n133o-text" }, t.label, t.help), group);
  }

  function rangeRow(def: RangeDef): HTMLElement {
    const inputId = id(`r-${def.key}`);
    const t = textOf(def, "label", inputId);
    const value = h("output", { class: "n133o-value", for: inputId, "aria-hidden": "true" });
    const input = h("input", { class: "n133o-range-input", type: "range", id: inputId, min: def.min, max: def.max, step: def.step, "aria-describedby": t.describedBy });
    input.addEventListener("input", () => store.set(def.key, Number(input.value)));
    input.addEventListener("change", () => options.onRangeDone?.(def.key, Number(input.value)));
    input.addEventListener("pointerdown", () => {
      held = true;
      const letGo = () => {
        held = false;
        window.removeEventListener("pointerup", letGo);
        window.removeEventListener("pointercancel", letGo);
        if (drawLater) draw();
      };
      window.addEventListener("pointerup", letGo);
      window.addEventListener("pointercancel", letGo);
    });
    shows.set(def.key, (v) => {
      const num = v as number;
      if (Number(input.value) !== num) input.value = String(num);
      value.textContent = rangeText(def, num);
      input.setAttribute("aria-valuetext", rangeText(def, num));
      // The filled part of the track, for the stylesheet.
      input.style.setProperty("--n133o-fill", `${((num - def.min) / (def.max - def.min)) * 100}%`);
    });
    return h("div", { class: "n133o-row n133o-range", "data-key": def.key }, h("span", { class: "n133o-text n133o-range-text" }, t.label, value, t.help), input);
  }

  /** The binding that waits for its key, and the call that stops it. */
  let waiting: { key: string; stop: () => void } | null = null;
  const stopWaiting = () => waiting?.stop();

  function keyRow(def: KeyDef): HTMLElement {
    const t = textOf(def);
    const cap = h("button", { class: "n133o-keycap", type: "button", "aria-describedby": t.describedBy });
    const show = (v: OptionValue) => {
      if (waiting?.key === def.key) return;
      cap.textContent = keyLabel(String(v));
      cap.setAttribute("aria-label", `${def.label}: ${keyLabel(String(v))}. Press to change`);
      cap.setAttribute("aria-pressed", "false");
    };
    cap.addEventListener("click", () => {
      if (waiting?.key === def.key) return stopWaiting();
      stopWaiting();
      const onKey = (e: KeyboardEvent) => {
        // Tab stops waiting and moves the focus as usual.
        if (e.code === "Tab") return stop();
        // The capture phase of the window: the game and the panel's Escape never hear this key.
        e.preventDefault();
        e.stopImmediatePropagation();
        stop();
        if (e.code && e.code !== "Escape") store.set(def.key, e.code);
      };
      const stop = () => {
        window.removeEventListener("keydown", onKey, true);
        waiting = null;
        show(store.get(def.key));
      };
      waiting = { key: def.key, stop };
      window.addEventListener("keydown", onKey, true);
      cap.textContent = PRESS_A_KEY;
      cap.setAttribute("aria-label", `${def.label}: ${PRESS_A_KEY.toLowerCase()}. Escape keeps the old key`);
      cap.setAttribute("aria-pressed", "true");
    });
    shows.set(def.key, show);
    return h("div", { class: "n133o-row n133o-key-row", "data-key": def.key }, h("span", { class: "n133o-text" }, t.label, t.help), cap);
  }

  const rowFor = (def: OptionDef) => (def.kind === "toggle" ? toggleRow(def) : def.kind === "choice" ? choiceRow(def) : def.kind === "key" ? keyRow(def) : rangeRow(def));

  /** A finger or the mouse holds a slider: a new draw waits until it lets go. */
  let held = false;
  let drawLater = false;

  /** Draws both tabs from the store's defs (the ones for this device), in their groups. Keeps the tab and, when it can, the focus. */
  function draw() {
    if (held) {
      drawLater = true;
      return;
    }
    drawLater = false;
    stopWaiting();
    const scroll = body.scrollTop;
    const focusKey = (document.activeElement as HTMLElement | null)?.closest?.("[data-key]")?.getAttribute("data-key") ?? null;
    shows = new Map();
    helps = new Map();
    const shown = store.defs().filter((d) => !d.devices || d.devices.includes(store.device));
    const has: Record<Tab, boolean> = { basic: false, advanced: false };
    for (const t of TABS) {
      const defs = shown.filter((d) => d.tab === t);
      has[t] = defs.length > 0;
      const loose = defs.filter((d) => !d.group);
      const groups = [...new Set(defs.filter((d) => d.group).map((d) => d.group!))];
      const parts: HTMLElement[] = [];
      if (loose.length) parts.push(h("div", { class: "n133o-rows" }, ...loose.map(rowFor)));
      for (const g of groups) {
        const gid = id(`g-${t}-${groups.indexOf(g)}`);
        parts.push(h("section", { class: "n133o-group", "aria-labelledby": gid }, h("h3", { class: "n133o-group-title", id: gid }, g), h("div", { class: "n133o-rows" }, ...defs.filter((d) => d.group === g).map(rowFor))));
      }
      panes[t].replaceChildren(...parts);
    }
    // Both tabs when both have rows; one tab alone needs no tab bar.
    const both = has.basic && has.advanced;
    tabList.hidden = !both;
    if (!has[tab]) tab = has.basic ? "basic" : "advanced";
    if (!has.basic && !has.advanced) panes.basic.replaceChildren(h("p", { class: "n133o-empty" }, "No options yet."));
    for (const t of TABS) {
      if (both) panes[t].setAttribute("role", "tabpanel");
      else panes[t].removeAttribute("role");
    }
    selectTab(tab, false);
    body.scrollTop = scroll;
    for (const [k, show] of shows) show(store.get(k));
    resetKey.disabled = store.isDefault();
    // A key is letters, digits, "_", "-" and dots (core.ts checks it), so it goes into the selector as it is.
    const row = focusKey ? panel.querySelector<HTMLElement>(`[data-key="${focusKey}"]`) : null;
    if (row) (row.tagName === "BUTTON" ? row : row.querySelector<HTMLElement>('button[tabindex="0"], select, input'))?.focus();
  }

  function selectTab(t: Tab, focus: boolean) {
    const moved = t !== tab;
    tab = t;
    for (const x of TABS) {
      const on = x === t;
      tabKeys[x].setAttribute("aria-selected", String(on));
      tabKeys[x].tabIndex = on ? 0 : -1;
      panes[x].hidden = !on;
    }
    if (moved) body.scrollTop = 0;
    if (focus) tabKeys[t].focus();
  }
  for (const t of TABS) tabKeys[t].addEventListener("click", () => selectTab(t, true));
  tabList.addEventListener("keydown", (e) => {
    const visible = TABS.filter((t) => !tabKeys[t].hidden);
    const to = moveKey(e as KeyboardEvent, visible.indexOf(tab), visible.length);
    if (to === null) return;
    e.preventDefault();
    selectTab(visible[to], true);
  });

  cleanup.push(
    store.subscribe((k, v) => {
      shows.get(k)?.(v);
      for (const f of helps.get(k) ?? []) f();
      resetKey.disabled = store.isDefault();
    }),
  );
  cleanup.push(store.subscribeDefs(draw));
  draw();

  // ---- open, close, ask ----

  const open = () => {
    if (destroyed || isOpen) return;
    isOpen = true;
    returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    panel.dataset.open = scrim.dataset.open = "true";
    key?.setAttribute("aria-expanded", "true");
    options.onOpen?.();
    (tabList.hidden ? closeKey : tabKeys[tab]).focus();
  };
  const close = () => {
    if (destroyed || !isOpen) return;
    answer?.(false);
    stopWaiting();
    isOpen = false;
    panel.dataset.open = scrim.dataset.open = "false";
    key?.setAttribute("aria-expanded", "false");
    options.onClose?.();
    if (options.focusAfterClose === "key") (key ?? (returnTo?.isConnected ? returnTo : null))?.focus();
    else releaseFocus(wrap);
  };
  key?.addEventListener("click", () => (isOpen ? close() : open()));
  closeKey.addEventListener("click", close);
  scrim.addEventListener("click", close);

  /** The question in the panel: one at a time (a new one answers the old with no), and closing the panel answers no. */
  let answer: ((yes: boolean) => void) | null = null;
  const askInPanel = (q: string, yesWord: string) =>
    new Promise<boolean>((resolve) => {
      answer?.(false);
      question.textContent = q;
      yesKey.textContent = yesWord;
      askBox.hidden = false;
      resetKey.hidden = true;
      answer = (yes) => {
        answer = null;
        askBox.hidden = true;
        resetKey.hidden = false;
        resolve(yes);
        if (isOpen && !destroyed) resetKey.focus();
      };
      open();
      yesKey.focus();
    });
  yesKey.addEventListener("click", () => answer?.(true));
  noKey.addEventListener("click", () => answer?.(false));
  const ask = (q: string, yesWord: string): Promise<boolean> => (options.confirm ? Promise.resolve(options.confirm(q)) : askInPanel(q, yesWord));
  cleanup.push(() => answer?.(false), stopWaiting);

  resetKey.addEventListener("click", () => {
    void ask(RESET_QUESTION, "Reset").then((yes) => {
      if (yes && !destroyed) store.reset();
    });
  });

  const onKey = (e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === "Escape") {
      // Escape answers an open question first, then closes the panel.
      if (answer) answer(false);
      else close();
      return;
    }
    if (e.key === "Tab") {
      // The panel holds the focus while it is open (it covers the game).
      const all = Array.from(panel.querySelectorAll<HTMLElement>("button, select, input, [tabindex]")).filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && el.closest("[hidden]") === null);
      if (!all.length) return;
      const first = all[0];
      const last = all[all.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener("keydown", onKey);
  cleanup.push(() => document.removeEventListener("keydown", onKey));

  return {
    open,
    close,
    get isOpen() {
      return isOpen;
    },
    destroy() {
      if (destroyed) return;
      if (isOpen) close();
      destroyed = true;
      for (const f of cleanup) f();
      wrap.remove();
    },
  };
}

/** The arrow keys, Home and End in a row of `count` (wrapping): the new place, or null for another key. */
function moveKey(e: KeyboardEvent, at: number, count: number): number | null {
  if (count < 1) return null;
  const from = at < 0 ? 0 : at;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      return (from + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
