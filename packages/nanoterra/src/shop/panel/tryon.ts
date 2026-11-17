// The looks sheet's try-on (`mountShop`'s `tryOn`, since 0.18.0; a chunk of its own: the sheet loads it with import() only when the game gives `tryOn`; Wes, 2026-11-16: "when I'm trying on an item before I buy it, there's a way to
// see my character model up close with that item ... It should be larger and inspectable"). Plain DOM, no Three.js: the stage's canvas is the
// viewer's (./../viewer, loaded by the game's `tryOn` when the sheet opens). This file holds what is tried on, the stage's box and its name for
// a screen reader, Up close, and the tray (each tried look with its price, Take off and Buy).
//
// A tried look is this sheet's state only: it is never worn (the game's `wear` is not called), never saved and never sent. It is forgotten when
// the sheet closes. Buy in the tray is the sheet's own Buy (the same order, the same pay sheet).

import { h } from "../../admin/panel/dom.js";
import { usdText, wearOf, type Look } from "../../looks/look.js";
import type { TryOnStage, TryOnViewer } from "../viewer/contract.js";
import { calmNow } from "./pay.js";
import { shopWords, type ShopWords, type TryOnWords } from "./words.js";

/** "a", "a and b", "a, b and c". */
const names = (list: readonly string[]) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

/** The stage's own words (a game's `words` on mountShop changes any of them). */
export const TRYON_WORDS: TryOnWords = {
  upClose: "Up close",
  backToList: "Back to the list",
  takeOff: "Take off",
  stageLabel: (worn, trying) => ["Your character", worn.length ? `wearing ${names(worn)}` : "", trying.length ? `trying on ${names(trying)}` : ""].filter(Boolean).join(", "),
  stageHint: "Drag or use the arrow keys to turn. Pinch, the wheel, or plus and minus to zoom. Home shows the whole character.",
  trayLine: (count, total) => (count ? `Trying on ${count}. Total ${total}` : "Pick a look to try it on."),
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  whole: "Show the whole character",
  turnAround: "Turn around",
};

/** The game's viewer, loaded when the sheet first opens: `() => import(VIEWER)` (the kit's character), or the game's own. */
export type TryOnLoad = () => Promise<TryOnViewer>;

export type TryOnPanelOptions = {
  /** The element the stage and the tray go in (the sheet's, so its layout is there before this chunk loads). */
  host: HTMLElement;
  load: TryOnLoad;
  /** The game's words (mountShop's `words`), over the defaults. */
  words?: Partial<ShopWords & TryOnWords>;
  /** The looks the player wears now (the game's `worn`). */
  worn(): Look[];
  /** The looks the player owns (free ones too). */
  owns(look: Look): boolean;
  /** A look's still picture at a size (the game's `preview` or `picture`, else the kit's swatch): the stage's picture while there is no 3D. */
  still(look: Look | null, size: number): HTMLElement;
  /** Buy a tried look: the sheet's own Buy (the order and the pay sheet), with no offer step (the stage showed it already). */
  buy(look: Look): void;
  /** Something changed that the list shows (a look tried on or taken off): the sheet draws the list again. */
  changed(): void;
  /** Up close opened or closed: the sheet's layout follows. */
  upClose(open: boolean): void;
};

export type TryOnPanel = {
  tried(look: Look): boolean;
  /** Tries a look on, or takes it off when it is tried on now. */
  toggle(look: Look): void;
  /** The sheet opened: the viewer loads and mounts (once a sheet). */
  start(): void;
  /** The sheet closed: the tried looks are forgotten, Up close closes, and the viewer frees its renderer. */
  stop(): void;
  readonly isUpClose: boolean;
  /** Closes Up close (Escape) and gives the focus back to the key that opened it. True when it was open. */
  leaveUpClose(): boolean;
  /** Draws the tray and the stage again (a look was bought or worn). */
  refresh(): void;
};

let ids = 0;

export function tryOnPanel(o: TryOnPanelOptions): TryOnPanel {
  const w: ShopWords & TryOnWords = { ...shopWords(o.words), ...TRYON_WORDS };
  for (const k of Object.keys(TRYON_WORDS) as (keyof TryOnWords)[]) if (o.words?.[k] !== undefined) (w as Record<string, unknown>)[k] = o.words[k];
  const n = ++ids;
  /** One tried look in each wear slot, in the order they were tried. */
  const tried = new Map<string, Look>();
  let focus: Look | null = null;
  let stage: TryOnStage | null = null;
  let loading = false;
  let started = false;
  let upClose = false;
  let opener: HTMLElement | null = null;

  const hint = h("p", { class: "n133s-sr", id: `n133s-hint-${n}` }, w.stageHint);
  const box = h("div", { class: "n133s-tryon-stage", role: "group", tabindex: "0", "aria-roledescription": w.tryOn, "aria-describedby": hint.id });
  const still = h("div", { class: "n133s-stage-still" });
  const closeKey = h("button", { class: "n133s-btn n133s-upclose-key", type: "button", "aria-pressed": "false" }, w.upClose);
  const live = h("p", { class: "n133s-tray-line", role: "status", "aria-live": "polite" });
  const rows = h("ul", { class: "n133s-tray-rows" });
  const tray = h("div", { class: "n133s-tray" }, live, rows);
  box.append(still, closeKey);
  o.host.append(box, hint, tray);

  const triedList = () => [...tried.values()];
  const view = () => ({ worn: o.worn(), tried: triedList(), focus });

  function drawStill() {
    if (stage) return;
    const pic = o.still(focus ?? o.worn().find((l) => wearOf(l) === "outfit") ?? null, 240);
    still.replaceChildren(pic);
  }

  function draw() {
    const worn = o.worn();
    const wornNames = worn.filter((l) => !tried.has(wearOf(l))).map((l) => l.name);
    box.setAttribute("aria-label", w.stageLabel(wornNames, triedList().map((l) => l.name)));
    const toBuy = triedList().filter((l) => !o.owns(l));
    live.textContent = w.trayLine(toBuy.length, usdText(toBuy.reduce((sum, l) => sum + Math.round(l.priceUsd * 10_000), 0) / 10_000));
    rows.replaceChildren(
      ...triedList().map((l) =>
        h(
          "li",
          { class: "n133s-tray-row" },
          h("span", { class: "n133s-tray-name" }, h("strong", {}, l.name), " ", h("small", {}, o.owns(l) ? (l.priceUsd === 0 ? w.free : w.yours) : usdText(l.priceUsd))),
          h("button", { class: "n133s-btn n133s-small", type: "button", "data-off": l.id, onclick: () => takeOff(l) }, w.takeOff),
          o.owns(l) ? null : h("button", { class: "n133s-btn n133s-buy n133s-small", type: "button", "data-buy": l.id, onclick: () => o.buy(l) }, w.buy(usdText(l.priceUsd))),
        ),
      ),
    );
    drawStill();
    stage?.show(view());
  }

  function takeOff(l: Look) {
    // The focus was on the row's Take off key, which goes: it moves to the stage (never to the page, where a game's walk keys act).
    const had = tray.contains(document.activeElement);
    tried.delete(wearOf(l));
    if (focus?.id === l.id) focus = null;
    draw();
    o.changed();
    if (had) box.focus({ preventScroll: true });
  }

  function setUpClose(open: boolean, from: HTMLElement | null) {
    if (open === upClose) return;
    upClose = open;
    closeKey.setAttribute("aria-pressed", String(open));
    closeKey.textContent = open ? w.backToList : w.upClose;
    if (open) opener = from;
    o.upClose(open);
    if (!open) {
      const back = opener?.isConnected ? opener : closeKey;
      opener = null;
      back.focus({ preventScroll: true });
    }
  }
  closeKey.addEventListener("click", () => setUpClose(!upClose, closeKey));
  // Enter or Space on the stage opens (or closes) Up close; the viewer has the other keys.
  box.addEventListener("keydown", (e) => {
    if (e.target !== box || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    setUpClose(!upClose, box);
  });

  async function start() {
    started = true;
    draw();
    if (stage || loading) return;
    loading = true;
    try {
      const viewer = await o.load();
      if (!started) return;
      const s = await viewer.mount(box, {
        calm: calmNow,
        onTap: () => setUpClose(!upClose, box),
        words: { zoomIn: w.zoomIn, zoomOut: w.zoomOut, whole: w.whole, turn: w.turnAround },
      });
      if (!started) return s.dispose();
      stage = s;
      still.replaceChildren();
      box.classList.add("n133s-has-3d");
      stage.show(view());
    } catch {
      // No WebGL, or the viewer did not load: the stage keeps the look's still picture, large. The how-to line (drag, pinch, the wheel) goes: a still
      // picture does none of it.
      stage = null;
      box.removeAttribute("aria-describedby");
    } finally {
      loading = false;
    }
  }

  return {
    tried: (l) => tried.get(wearOf(l))?.id === l.id,
    toggle(l) {
      if (tried.get(wearOf(l))?.id === l.id) return takeOff(l);
      tried.set(wearOf(l), l);
      focus = l;
      draw();
      o.changed();
    },
    start: () => void start(),
    stop() {
      started = false;
      tried.clear();
      focus = null;
      if (upClose) {
        upClose = false;
        closeKey.setAttribute("aria-pressed", "false");
        closeKey.textContent = w.upClose;
        o.upClose(false);
      }
      opener = null;
      stage?.dispose();
      stage = null;
      box.classList.remove("n133s-has-3d");
      still.replaceChildren();
    },
    get isUpClose() {
      return upClose;
    },
    leaveUpClose() {
      if (!upClose) return false;
      setUpClose(false, null);
      return true;
    },
    refresh: draw,
  };
}
