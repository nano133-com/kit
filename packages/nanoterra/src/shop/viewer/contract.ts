// The try-on's contract between the looks sheet (`mountShop`, no Three.js) and a viewer (the kit's `@nano133/nanoterra/shop/viewer`, or a
// game's own). Types only: the sheet imports this file and nothing that draws.
//
// The sheet owns the layout, the words, the "Try on" keys, what is tried on, Up close, the tray (Take off and Buy) and the stage's text for a
// screen reader. The viewer owns the canvas in the stage's box, the pointer, the wheel and the stage's keys, and the camera. A tried look is
// the sheet's state only: the viewer never saves it and never sends it anywhere.

import type { Look } from "../../looks/look.js";

/** What the sheet gives the viewer when it mounts it in the stage's box. */
export type TryOnContext = {
  /** Whether the player asks for less motion now (the device's setting, or the options' "Less motion" on <html>). Read it each frame. */
  calm(): boolean;
  /** A tap on the stage (a press that does not move): the sheet opens Up close, or closes it. */
  onTap(): void;
  /** The words of the viewer's own keys, for a screen reader (the sheet's words: `ShopWords`). */
  words: { zoomIn: string; zoomOut: string; whole: string; turn: string };
};

/** What the stage shows: the looks the player wears, the looks tried on over them (one in each wear slot), and the one to frame. */
export type TryOnShow = {
  worn: readonly Look[];
  tried: readonly Look[];
  /** The look just tried on: the stage frames it whole. Null: the whole character. */
  focus: Look | null;
};

/** A mounted stage. */
export type TryOnStage = {
  /** Shows the character in these looks. The sheet calls it on each change; a call while an older one is still dressing wins. */
  show(view: TryOnShow): void;
  /** Frees the canvas, the renderer and the character. */
  dispose(): void;
};

/**
 * A viewer: the kit's (`() => import(VIEWER)`, or `tryOnViewer({ body })` from it) or the game's own. `mount` puts
 * a canvas in `box` and answers the stage, or throws (no WebGL): the sheet then shows the look's still picture, large.
 */
export type TryOnViewer = {
  mount(box: HTMLElement, context: TryOnContext): TryOnStage | Promise<TryOnStage>;
};
