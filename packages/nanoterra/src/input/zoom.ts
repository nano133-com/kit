// The camera's distance for a game the player walks in: the mouse wheel, a trackpad's two-finger scroll or pinch, a two-finger pinch on a touch
// screen, and the + and − keys move one number, the camera's distance from the eyes, along ONE curve. 0 is first person; below `first` the camera
// is in the eyes. It eases to the distance asked for (at once with reduced motion). No package: plain browser events.
//
// THE FEEL is nano133.com's island (app/island/zoom.ts). Each notch moves the distance in proportion to it (`0.35 + 0.14 × distance` metres a
// notch), so a notch feels the same near and far. Every bit of a scroll counts: a dead zone and a speed limit dropped most of a quick spin in
// Echo Island, and its wheel needed about five times the spins of the island's (Wes, 2026-11-01). Close in, the last notch goes all the way to
// the eyes; out of the eyes, the first notch goes past the switch, so the camera never rests half inside the head.
//
// THE PINCH follows the same curve: the curve is a constant ratio of `distance + 2.5`, so spreading the fingers to twice their start divides it
// by 2^PINCH.power, wherever the camera is.

/** Where the camera may be (metres from the eyes): the farthest, the default, and the switch: nearer than `first` it is in the eyes. */
export type ZoomRange = { max: number; start: number; first: number };

/** One notch: about one mouse-wheel click (100 px of scroll). The + and − keys move `key` notches. */
export const ZOOM_STEP = { perPx: 0.006, perPxPinch: 0.03, linePx: 16, pagePx: 400, key: 1.2 } as const;
/** The curve: a notch moves `base + scale × distance` metres. */
export const ZOOM_CURVE = { base: 0.35, scale: 0.14 } as const;
/** The touch pinch: twice the spread divides `distance + base/scale` by 2^power. */
export const PINCH = { power: 1.3 } as const;
/** How fast the camera eases to the distance asked for (1/s). */
export const ZOOM_EASE = 9;

const clamp = (r: ZoomRange, d: number) => Math.min(r.max, Math.max(0, d));

/** One wheel event as notches (negative: in). A mouse notch arrives in lines or about 100 px, a trackpad in many small pixels, a pinch as a wheel with the ctrl key. */
export function wheelNotches(e: { deltaY: number; deltaMode?: number; ctrlKey?: boolean }): number {
  const px = e.deltaMode === 1 ? e.deltaY * ZOOM_STEP.linePx : e.deltaMode === 2 ? e.deltaY * ZOOM_STEP.pagePx : e.deltaY;
  return px * (e.ctrlKey ? ZOOM_STEP.perPxPinch : ZOOM_STEP.perPx);
}

/** The snap: close in, a move into the switch goes to the eyes; out of the eyes, a move out goes past the switch. */
function snapped(r: ZoomRange, from: number, to: number): number {
  if (to < from && to < r.first) return 0;
  if (to > from && from < r.first) return clamp(r, Math.max(to, r.first + 1));
  return clamp(r, to);
}

/** The distance after `notches` (negative: in) from `want`. */
export function zoomedBy(r: ZoomRange, want: number, notches: number): number {
  return snapped(r, want, want + notches * (ZOOM_CURVE.base + want * ZOOM_CURVE.scale));
}

/** The distance during a touch pinch: `from` at the start, the fingers `spread0` apart then and `spread` now (px). Apart brings it in. */
export function pinchedTo(r: ZoomRange, from: number, spread0: number, spread: number): number {
  if (!(spread0 > 0) || !(spread > 0)) return from;
  const k = ZOOM_CURVE.base / ZOOM_CURVE.scale;
  return snapped(r, from, (from + k) * (spread0 / spread) ** PINCH.power - k);
}

export type Zoom = {
  /** The distance asked for (metres from the eyes). */
  want(): number;
  /** The distance now, as the last `step` eased it. */
  now(): number;
  /** True while the camera is in the eyes (the distance now below `first`). */
  eyes(): boolean;
  /** Asks for a distance (clamped), writes it and tells the listeners. */
  set(d: number): void;
  /** Moves the distance by notches (negative: in), along the curve. */
  by(notches: number): void;
  /** A wheel event (or one like it) moves the distance. */
  wheel(e: { deltaY: number; deltaMode?: number; ctrlKey?: boolean }): void;
  /** A touch pinch starts with the fingers `spread` apart (px); `pinch` follows it; `pinchEnd` ends it. */
  pinchStart(spread: number): void;
  pinch(spread: number): void;
  pinchEnd(): void;
  /** One frame: the distance eases to the one asked for (at once when `calm`, reduced motion). Returns it. */
  step(dt: number, calm: boolean): number;
  /** Calls `on` when the distance asked for changes. Returns the function that stops it. */
  subscribe(on: () => void): () => void;
};

/**
 * The camera's distance of one game. `read` gives the kept distance (null: none, the default `start`), and is read the first time the distance is
 * asked for, so the server never calls it; `write` keeps a new one (on every change: put a delay in it if your storage is slow).
 */
export function createZoom(r: ZoomRange, keep: { read?: () => number | null; write?: (d: number) => void } = {}): Zoom {
  let want = r.start;
  let now = r.start;
  let loaded = false;
  let pinchFrom: { d: number; spread: number } | null = null;
  const listeners = new Set<() => void>();
  const load = () => {
    if (loaded) return;
    loaded = true;
    const v = keep.read?.();
    if (typeof v === "number" && Number.isFinite(v)) want = now = clamp(r, v);
  };
  const set = (d: number) => {
    load();
    want = clamp(r, d);
    keep.write?.(want);
    for (const on of listeners) on();
  };
  const by = (notches: number) => {
    load();
    if (notches !== 0) set(zoomedBy(r, want, notches));
  };
  return {
    want: () => (load(), want),
    now: () => (load(), now),
    eyes: () => (load(), now < r.first),
    set,
    by,
    wheel: (e) => by(wheelNotches(e)),
    pinchStart(spread) {
      load();
      pinchFrom = { d: want, spread };
    },
    pinch(spread) {
      if (pinchFrom) set(pinchedTo(r, pinchFrom.d, pinchFrom.spread, spread));
    },
    pinchEnd() {
      pinchFrom = null;
    },
    step(dt, calm) {
      load();
      now = calm ? want : now + (want - now) * (1 - Math.exp(-dt * ZOOM_EASE));
      if (Math.abs(now - want) < 0.002) now = want;
      return now;
    },
    subscribe(on) {
      listeners.add(on);
      return () => void listeners.delete(on);
    },
  };
}

type Listens = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * The wheel over `el` (the game's canvas: the page does not scroll or zoom there) and the + and − keys on the window (also the number pad's) move
 * `zoom`. A key with ctrl, alt or the command key is the browser's own zoom and is left alone, and so is a key typed in a field. `skip(e)` returns true
 * for an event the game wants to keep from the zoom (a key the player is binding, a game that is paused). Returns the function that takes the listeners away.
 * The touch pinch is yours to wire (`pinchStart`, `pinch`, `pinchEnd`), because the fingers are also your thumb stick and your look.
 */
export function listenZoom(zoom: Zoom, el: Listens, opts: { skip?: (e: Event) => boolean; keys?: boolean } = {}, win: Listens = window): () => void {
  const wheel = (e: Event) => {
    e.preventDefault();
    if (opts.skip?.(e)) return;
    zoom.wheel(e as WheelEvent);
  };
  const key = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.metaKey || k.altKey || k.ctrlKey || opts.skip?.(e)) return;
    const t = k.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName ?? ""))) return;
    if (k.code === "Equal" || k.code === "NumpadAdd") zoom.by(-ZOOM_STEP.key);
    else if (k.code === "Minus" || k.code === "NumpadSubtract") zoom.by(ZOOM_STEP.key);
  };
  el.addEventListener("wheel", wheel, { passive: false });
  const keys = opts.keys !== false;
  if (keys) win.addEventListener("keydown", key);
  return () => {
    el.removeEventListener("wheel", wheel);
    if (keys) win.removeEventListener("keydown", key);
  };
}
