// The Emotes key and the emote wheel of a game: `mountEmotes(element, options)`. Plain DOM, no framework, no Three.js: nano133.com's EmoteKeys.tsx and
// EmoteWheel.tsx (Nano Island), for any game. The key goes into `element`; it opens the wheel in the middle of the screen over a dim page: eight round
// places on a ring, slot 1 at the top and on clockwise, each the emote's picture and name, and a middle disc with the name of the place under the
// finger and Edit. Two ways with a finger or a mouse: a tap on the key opens the wheel and a tap on a place plays it; or a hold on the key opens it at
// once, and sliding onto a place and letting go plays that one (a slide under 14 px is a tap, a let-go in the middle leaves the wheel open). A press
// beside the wheel, Escape or the key closes it. On a keyboard B opens and closes it (not while a field has the keys, or when the game's `keyAllowed`
// says no) and 1 to 8 play its places while it is open. Edit shows every emote: a tap puts one on the wheel in its first empty place or takes it off,
// and a ninth is refused with WHEEL_FULL; in Edit a tap on a place takes its emote off.
//
// The list is Nanoterra's (each id names one of EMOTES: its name and picture come from the kit), the game's own ({ id, label, icon }), or both. The
// wheel only calls `onPlay(id)`: the game plays it (Nanoterra's on the kit's character: createEmotes(...).play, from "@nano133/nanoterra/emotes/player").

import { h } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import { EMOTE_ICONS_URL } from "../icons.js";
import { EMOTES, emoteOf, isEmote, type EmoteId } from "../list.js";
import { readEmoteOptions, type EmoteOptionsStore } from "../options.js";
import { WHEEL_FULL, WHEEL_SLOTS, createWheel, type Slots } from "../wheel.js";

/** One of the game's own emotes: its id (what `onPlay` gets), the name on the wheel, and a picture's address (square; left out: the name alone). */
export type OwnEmote = { id: string; label: string; icon?: string };
/** A Nanoterra emote by its id, or one of the game's own. */
export type WheelEmote = EmoteId | OwnEmote;

export type EmotesMountOptions = {
  /** The game's id: the wheel's eight places are kept per game, in this browser (`n133-emotes:<game>`). */
  game: string;
  /** The player picked an emote. Play it: Nanoterra's with `createEmotes(...).play(id)`, the game's own with its own animation. */
  onPlay: (id: string) => void;
  /** The emotes the player may put on the wheel, in the order Edit shows them. Default: Nanoterra's eleven. */
  emotes?: readonly WheelEmote[];
  /** The admin's `emotes` setting: "off" leaves Nanoterra's emotes out (the game's own stay). With nothing left, nothing is drawn. Default "on". */
  nanoterraEmotes?: "on" | "off";
  /** The eight places before the player changes them (ids, or null for an empty place). Default: the island's wheel, or the list's first eight. */
  defaults?: readonly (string | null)[];
  /** The options menu's store: `emotes.show` off hides the key (B still opens the wheel); `keys.emotes` is the wheel's key. Left out: the key shows, and B. */
  options?: EmoteOptionsStore | null;
  /** The address of Nanoterra's picture strip. Default: the package's icons.webp (see the README for bundlers). */
  icons?: string;
  /** B (or the player's own key: the options' "keys.emotes") opens and closes the wheel, and 1 to 8 play its places. Default true. */
  keys?: boolean;
  /** Asked before B opens or closes the wheel: false when the game uses the key now (a dialog of its own, B bound to an action). */
  keyAllowed?: (e: KeyboardEvent) => boolean;
  /** The wheel opened. Load the clips here the first time: `loadEmotes` of "@nano133/nanoterra/emotes/player". */
  onOpen?: () => void;
  /** "light", "dark", or "device" (the default): the page's `data-n133-theme` when it has one, else the device's setting. */
  theme?: "light" | "dark" | "device";
  /** Where the wheel is kept (default: the page's localStorage). null keeps it only for the life of the page. */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
};

export type MountedEmotes = {
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /** The eight places now. */
  readonly slots: Slots;
  /** Removes the key and the wheel, and stops listening to the keyboard and the options. */
  destroy(): void;
};

/** How far a finger moves on the key before it is a slide, not a tap (CSS pixels). */
export const SLIDE_PX = 14;

const NOTHING: MountedEmotes = { open() {}, close() {}, isOpen: false, slots: [], destroy() {} };
/** Each place's direction from the middle: slot 1 at the top, then clockwise. */
const AT = Array.from({ length: WHEEL_SLOTS }, (_, i) => {
  const a = ((-90 + i * (360 / WHEEL_SLOTS)) * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
});
const DIGITS: Record<string, number> = Object.fromEntries(
  Array.from({ length: WHEEL_SLOTS }, (_, i) => [
    [`Digit${i + 1}`, i],
    [`Numpad${i + 1}`, i],
  ]).flat(),
);

/** A key that a field, or a page's own editable text, is holding. */
const inField = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable === true);
};

/** The place under a point of the screen, by its angle from the wheel's middle, outside the middle disc; null in the middle or with no wheel. */
export function placeAt(rect: { left: number; top: number; width: number; height: number } | null, x: number, y: number): number | null {
  if (!rect || !rect.width) return null;
  const dx = x - (rect.left + rect.width / 2);
  const dy = y - (rect.top + rect.height / 2);
  if (Math.hypot(dx, dy) < rect.width * 0.2) return null;
  const turn = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
  return ((Math.round(turn / (360 / WHEEL_SLOTS)) % WHEEL_SLOTS) + WHEEL_SLOTS) % WHEEL_SLOTS;
}

let mounts = 0;

export function mountEmotes(root: HTMLElement, options: EmotesMountOptions): MountedEmotes {
  const nanoOn = options.nanoterraEmotes !== "off";
  const list: { id: string; label: string; sheet: number; icon: string | null }[] = [];
  for (const e of options.emotes ?? EMOTES.map((x) => x.id)) {
    if (typeof e === "string") {
      if (nanoOn && isEmote(e)) list.push({ id: e, label: emoteOf(e)!.label, sheet: EMOTES.findIndex((x) => x.id === e), icon: null });
    } else if (e && typeof e.id === "string" && typeof e.label === "string") list.push({ id: e.id, label: e.label, sheet: -1, icon: typeof e.icon === "string" ? e.icon : null });
  }
  // Each id once: the first wins.
  const items = list.filter((x, i) => list.findIndex((y) => y.id === x.id) === i);
  if (!items.length) return NOTHING;
  const byId = new Map(items.map((x) => [x.id, x]));
  const n = ++mounts;
  const sheet = options.icons ?? EMOTE_ICONS_URL;
  const wheel = createWheel({ game: options.game, ids: items.map((x) => x.id), defaults: options.defaults, storage: options.storage });
  const keys = options.keys !== false;
  let isOpen = false;
  let edit = false;
  let full = false;
  let hover: number | null = null;
  let mouse: number | null = null;
  let destroyed = false;
  const cleanup: (() => void)[] = [];

  /** An emote's picture: its cell of the strip, or the game's own picture; nothing when it has none. */
  const picture = (id: string, cls: string): HTMLElement | null => {
    const it = byId.get(id);
    if (!it) return null;
    if (it.sheet >= 0) {
      const count = EMOTES.length;
      const el = h("span", { class: cls, "aria-hidden": "true" });
      el.style.backgroundImage = `url("${sheet}")`;
      el.style.backgroundSize = `${count * 100}% 100%`;
      el.style.backgroundPosition = `${(it.sheet / (count - 1)) * 100}% 0`;
      return el;
    }
    if (!it.icon) return null;
    const el = h("span", { class: `${cls} is-own`, "aria-hidden": "true" });
    el.style.backgroundImage = `url("${it.icon.replace(/["\\\n\r]/g, "")}")`;
    return el;
  };
  const labelOf = (id: string) => byId.get(id)?.label ?? id;

  const key = h("button", { class: "n133e-key", type: "button", "aria-expanded": "false", "aria-haspopup": "dialog", "aria-controls": `n133e-wheel-${n}` }, icon("smile", 20), h("span", {}, "Emotes"));
  const hubName = h("span", { class: "n133e-hub-name", "aria-live": "polite" });
  const editKey = h("button", { class: "n133e-edit", type: "button", "aria-pressed": "false" }, "Edit");
  const slotKeys = AT.map((p, i) => {
    const b = h("button", { class: "n133e-slot", type: "button", "data-slot": i });
    b.style.setProperty("--x", String(p.x));
    b.style.setProperty("--y", String(p.y));
    b.addEventListener("pointerenter", () => {
      mouse = i;
      drawLit();
    });
    b.addEventListener("pointerleave", () => {
      if (mouse === i) mouse = null;
      drawLit();
    });
    b.addEventListener("click", () => pick(i));
    return b;
  });
  const ring = h("div", { class: "n133e-wheel", id: `n133e-wheel-${n}`, role: "dialog", "aria-label": "Emotes" }, h("div", { class: "n133e-ring", "aria-hidden": "true" }), ...slotKeys, h("div", { class: "n133e-hub" }, hubName, editKey));
  const fullLine = h("p", { class: "n133e-list-line", "aria-live": "polite" });
  const grid = h("div", { class: "n133e-grid" });
  const editList = h("div", { class: "n133e-list", role: "group", "aria-label": "All emotes" }, fullLine, grid);
  const layer = h("div", { class: "n133e-layer", "data-open": "false" }, ring, editList);
  layer.hidden = true;
  const wrap = h("div", { class: "n133-emotes" }, key, layer);
  root.append(wrap);

  // The theme: the game's word, or the page's (data-n133-theme, which the admin panel sets too), or the device's setting.
  let media: MediaQueryList | null = null;
  try {
    media = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(prefers-color-scheme: dark)") : null;
  } catch {
    media = null;
  }
  const drawTheme = () => {
    const want = options.theme ?? "device";
    const page = globalThis.document?.documentElement?.getAttribute("data-n133-theme");
    const dark = want === "device" ? (page === "dark" || page === "light" ? page === "dark" : media?.matches === true) : want === "dark";
    wrap.setAttribute("data-theme", dark ? "dark" : "light");
  };
  drawTheme();
  media?.addEventListener?.("change", drawTheme);
  cleanup.push(() => media?.removeEventListener?.("change", drawTheme));

  // The options: `emotes.show` off hides the key; `keys.emotes` is the key that opens the wheel (B unless the player changed it).
  let openCode = "KeyB";
  const drawShow = () => {
    const o = readEmoteOptions(options.options);
    key.hidden = !o.show;
    openCode = o.key;
    if (keys) key.setAttribute("aria-keyshortcuts", openCode.replace(/^(Key|Digit)/, ""));
  };
  drawShow();
  const unOptions = options.options?.subscribe?.((k) => {
    if (k === "emotes.show" || k === "keys.emotes") drawShow();
  });
  if (unOptions) cleanup.push(unOptions);

  function drawLit() {
    const lit = hover ?? mouse;
    const slots = wheel.slots;
    slotKeys.forEach((b, i) => b.classList.toggle("is-lit", lit === i && slots[i] !== null));
    const id = lit !== null ? slots[lit] : null;
    hubName.textContent = id ? labelOf(id) : edit ? "Your wheel" : "Emotes";
  }
  function drawSlots() {
    const slots = wheel.slots;
    slotKeys.forEach((b, i) => {
      const id = slots[i];
      b.classList.toggle("is-empty", !id);
      b.setAttribute("aria-label", id ? (edit ? `Take ${labelOf(id)} off the wheel` : labelOf(id)) : edit ? "Empty place" : "Empty place: edit the wheel");
      if (id && !edit && keys) b.setAttribute("aria-keyshortcuts", String(i + 1));
      else b.removeAttribute("aria-keyshortcuts");
      b.replaceChildren(
        ...(id
          ? [picture(id, "n133e-pic") ?? "", h("span", { class: "n133e-name" }, labelOf(id)), !edit && keys ? h("span", { class: "n133e-num", "aria-hidden": "true" }, String(i + 1)) : "", edit ? h("span", { class: "n133e-off", "aria-hidden": "true" }, "×") : ""]
          : [h("span", { class: "n133e-plus", "aria-hidden": "true" }, "+")]),
      );
    });
    layer.classList.toggle("is-edit", edit);
    editKey.textContent = edit ? "Done" : "Edit";
    editKey.setAttribute("aria-pressed", String(edit));
    editList.hidden = !edit;
    fullLine.textContent = full ? WHEEL_FULL : `Tap to put on the wheel or take off. Up to ${WHEEL_SLOTS}.`;
    fullLine.classList.toggle("is-full", full);
    if (edit) {
      grid.replaceChildren(
        ...items.map((it) => {
          const at = slots.indexOf(it.id);
          return h(
            "button",
            { class: `n133e-tile${at >= 0 ? " is-on" : ""}`, type: "button", "aria-pressed": String(at >= 0), "data-emote": it.id, onclick: () => tap(it.id) },
            picture(it.id, "n133e-tile-pic") ?? h("span", { class: "n133e-tile-pic is-blank", "aria-hidden": "true" }),
            h("span", { class: "n133e-tile-name" }, it.label),
            at >= 0 ? h("span", { class: "n133e-badge", "aria-label": `place ${at + 1}` }, String(at + 1)) : null,
          );
        }),
      );
    }
    drawLit();
  }
  const unWheel = wheel.subscribe(drawSlots);
  cleanup.push(unWheel);

  function tap(id: string) {
    full = wheel.toggle(id) === "full";
    drawSlots();
    // The tile that was pressed keeps the focus after the grid is drawn again.
    for (const el of Array.from(grid.children)) if ((el as HTMLElement).dataset.emote === id) (el as HTMLElement).focus();
  }
  function play(id: string) {
    close(false);
    options.onPlay(id);
  }
  function pick(i: number) {
    const id = wheel.slots[i];
    if (edit) {
      if (id) wheel.clear(i);
      full = false;
      drawSlots();
      return;
    }
    if (!id) {
      edit = true;
      drawSlots();
      return;
    }
    play(id);
  }
  function open(focusFirst = false) {
    if (destroyed || isOpen) return;
    isOpen = true;
    edit = false;
    full = false;
    hover = null;
    mouse = null;
    drawTheme();
    drawSlots();
    layer.hidden = false;
    layer.dataset.open = "true";
    key.setAttribute("aria-expanded", "true");
    options.onOpen?.();
    if (focusFirst) slotKeys[Math.max(0, wheel.slots.findIndex((x) => x !== null))].focus();
  }
  function close(focusKey: boolean) {
    if (destroyed || !isOpen) return;
    isOpen = false;
    hover = null;
    press = null;
    layer.hidden = true;
    layer.dataset.open = "false";
    key.setAttribute("aria-expanded", "false");
    if (focusKey && !key.hidden) key.focus();
  }

  editKey.addEventListener("click", () => {
    edit = !edit;
    full = false;
    drawSlots();
  });
  // A press on the dim page beside the wheel closes it.
  layer.addEventListener("pointerdown", (e) => {
    if (e.target === layer) close(false);
  });

  // The key: a press opens the wheel at once; a slide from it onto a place and a let-go plays that place.
  let press: { id: number; x: number; y: number; slid: boolean } | null = null;
  key.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || isOpen) return;
    open();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, slid: false };
    try {
      key.setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is already gone: the wheel stays open for a tap.
    }
  });
  key.addEventListener("pointermove", (e) => {
    const p = press;
    if (!p || p.id !== e.pointerId) return;
    if (!p.slid && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLIDE_PX) p.slid = true;
    if (p.slid) {
      hover = placeAt(ring.getBoundingClientRect(), e.clientX, e.clientY);
      drawLit();
    }
  });
  key.addEventListener("pointerup", (e) => {
    const p = press;
    press = null;
    if (!p || !p.slid || p.id !== e.pointerId) return;
    const i = placeAt(ring.getBoundingClientRect(), e.clientX, e.clientY);
    const id = i === null ? null : wheel.slots[i];
    if (id) play(id);
    else {
      hover = null;
      drawLit();
    }
  });
  key.addEventListener("pointercancel", () => {
    press = null;
    hover = null;
    drawLit();
  });
  // Enter or Space is a click with no pointer: it opens and closes the wheel. A pointer's click is already handled.
  key.addEventListener("click", (e) => {
    if ((e as MouseEvent).detail !== 0) return;
    if (isOpen) close(true);
    else open(true);
  });

  const onKey = (e: KeyboardEvent) => {
    if (destroyed) return;
    if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      close(true);
      return;
    }
    if (!keys || e.repeat || e.ctrlKey || e.metaKey || e.altKey || inField(e.target)) return;
    if (e.code === openCode) {
      if (options.keyAllowed && !options.keyAllowed(e)) return;
      e.preventDefault();
      if (isOpen) close(true);
      else open(true);
      return;
    }
    const i = DIGITS[e.code];
    if (i === undefined || !isOpen || edit) return;
    const id = wheel.slots[i];
    if (!id) return;
    e.preventDefault();
    play(id);
  };
  document.addEventListener("keydown", onKey);
  cleanup.push(() => document.removeEventListener("keydown", onKey));

  return {
    open: () => open(false),
    close: () => close(false),
    get isOpen() {
      return isOpen;
    },
    get slots() {
      return wheel.slots;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const f of cleanup) f();
      wrap.remove();
    },
  };
}
