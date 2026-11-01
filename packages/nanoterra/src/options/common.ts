// The settings most games have, ready to opt into by key: `common("masterVolume", "musicVolume", "quality")`. They are plain defs: the game reads them and
// does what they say (the kit plays no sound and draws no frame). A game changes one by spreading it: `{ ...COMMON_OPTIONS.quality, default: "low" }`.
// The words and ranges follow nano133's island and Echo Island (Wes, 2026-10-30: Sound effects and Music sliders; the island's Settings rows).

import type { OptionDef, RangeDef } from "./core.js";

const volume = (key: string, label: string, help?: string): RangeDef => ({ kind: "range", key, label, ...(help ? { help } : {}), tab: "basic", group: "Sound", min: 0, max: 100, step: 5, unit: "%", default: 100 });

export const COMMON_OPTIONS = {
  /** 0 to 100 (%), every sound. A game multiplies it into the others; the square of it is a fair loudness curve (`level ** 2`). */
  masterVolume: volume("masterVolume", "Volume"),
  /** 0 to 100 (%), the music only. */
  musicVolume: volume("musicVolume", "Music"),
  /** 0 to 100 (%), every sound but the music. */
  effectsVolume: volume("effectsVolume", "Sound effects"),
  /** 10 to 100, how fast a drag or the mouse turns the camera; 50 is the game's own speed. */
  cameraSensitivity: { kind: "range", key: "cameraSensitivity", label: "Camera speed", tab: "basic", group: "Camera", min: 10, max: 100, step: 5, default: 50 },
  /** Up and down of the camera swapped. */
  invertLook: { kind: "toggle", key: "invertLook", label: "Invert look", help: "Up and down are swapped", tab: "advanced", group: "Camera", default: false },
  /** "left" or "right": the side of a touch screen the move stick is on (the camera drag is on the other). Shown on a phone and a tablet only. */
  stickSide: {
    kind: "choice",
    key: "stickSide",
    label: "Move stick",
    help: "The side of the screen that moves you",
    tab: "basic",
    group: "Controls",
    choices: [
      { value: "left", label: "Left" },
      { value: "right", label: "Right" },
    ],
    default: "left",
    devices: ["phone", "tablet"],
  },
  /** Fewer shakes, swings and flashes. On by default when the device asks for less motion. */
  reducedMotion: { kind: "toggle", key: "reducedMotion", label: "Less motion", help: "Fewer shakes, swings and flashes", tab: "advanced", group: "Comfort", default: { default: false, reducedMotion: true } },
  /** "low", "medium" or "high": the game decides what each draws. Medium on a phone. */
  quality: {
    kind: "choice",
    key: "quality",
    label: "Quality",
    tab: "advanced",
    group: "Graphics",
    choices: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    default: { phone: "medium", default: "high" },
  },
  /** A small frames-a-second counter on the screen. */
  showFps: { kind: "toggle", key: "showFps", label: "Show frame rate", tab: "advanced", group: "Graphics", default: false },
} satisfies Record<string, OptionDef>;

export type CommonKey = keyof typeof COMMON_OPTIONS;
export const COMMON_KEYS = Object.keys(COMMON_OPTIONS) as CommonKey[];

/** The common defs for these keys, in the order given (a copy: change it freely). */
export function common(...keys: CommonKey[]): OptionDef[] {
  return keys.map((k) => {
    const def = COMMON_OPTIONS[k] as OptionDef | undefined;
    if (!def) throw new TypeError(`common: "${String(k)}" is not a common setting (${COMMON_KEYS.join(", ")})`);
    return { ...def } as OptionDef;
  });
}
