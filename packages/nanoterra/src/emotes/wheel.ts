// The player's emote wheel: eight places round the wheel, slot 1 at the top and on clockwise, each an emote or empty. The player picks which emotes sit
// there from every emote the game offers (Edit in the panel), so the list can grow past eight. Kept in this browser per game, under `n133-emotes:<game>`;
// a browser with nothing kept, or a storage that is refused (some private windows), has the game's default wheel and keeps changes for the page's life.
// No DOM and no Three.js here: the panel (./panel) draws it.

import { EMOTES } from "./list.js";

export const WHEEL_SLOTS = 8;
/** The localStorage key of a game's wheel. */
export const wheelKey = (game: string) => `n133-emotes:${game}`;
/** A wheel: eight places, each an emote's id once, or null (empty). */
export type Slots = readonly (string | null)[];
/** Nanoterra's wheel before the player changes it (the island's): the eight most social emotes. Bow, Shrug and Facepalm wait in Edit. */
export const DEFAULT_WHEEL: Slots = ["wave", "cheer", "clap", "dance", "laugh", "point", "sit", "spin"];
/** What the player is told when they put a ninth emote on the wheel. */
export const WHEEL_FULL = "Your wheel is full. Take one off first.";

/** Eight places from a list (cut, or filled with empty places), each id of `known` once. */
function fit(list: readonly unknown[], known: ReadonlySet<string>): Slots {
  const seen = new Set<string>();
  return Array.from({ length: WHEEL_SLOTS }, (_, i) => {
    const x = list[i];
    if (typeof x !== "string" || !known.has(x) || seen.has(x)) return null;
    seen.add(x);
    return x;
  });
}

/** The first wheel for a list of emotes: `defaults` when given (each id of the list once), else the island's wheel for Nanoterra's list, else the list's first eight. */
export function defaultWheel(ids: readonly string[], defaults?: readonly (string | null)[]): Slots {
  const known = new Set(ids);
  if (defaults) return fit(defaults, known);
  const island = fit(DEFAULT_WHEEL, known);
  return island.some((x) => x !== null) ? island : fit(ids, known);
}

/** A kept wheel: eight places, each an emote of `ids` once or empty. Anything else (no key, broken text, another length) is `fallback`. */
export function readWheel(raw: string | null | undefined, ids: readonly string[], fallback: Slots): Slots {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length !== WHEEL_SLOTS) return fallback;
    return fit(v, new Set(ids));
  } catch {
    return fallback;
  }
}

/** The emote put on (in the first empty place), taken off, or refused because all eight places are full. */
export function toggleSlot(slots: Slots, id: string): { slots: Slots; did: "added" | "removed" | "full" } {
  const at = slots.indexOf(id);
  if (at >= 0) return { slots: slots.map((x, i) => (i === at ? null : x)), did: "removed" };
  const free = slots.indexOf(null);
  if (free < 0) return { slots, did: "full" };
  return { slots: slots.map((x, i) => (i === free ? id : x)), did: "added" };
}

type Store = Pick<Storage, "getItem" | "setItem">;

/** The page's localStorage, or null where reading it throws. */
function pageStorage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export type WheelOptions = {
  /** The game's id: each game keeps its own wheel. */
  game: string;
  /** Every emote the player may put on the wheel, by id. Default: Nanoterra's eleven. */
  ids?: readonly string[];
  /** The eight places before the player changes them. Default: see `defaultWheel`. */
  defaults?: readonly (string | null)[];
  /** Where the wheel is kept (default: the page's localStorage). null keeps it only for the life of the page. */
  storage?: Store | null;
};

export type Wheel = {
  /** The eight places now. */
  readonly slots: Slots;
  /** Puts an emote on (its first empty place) or takes it off; "full" changes nothing. */
  toggle(id: string): "added" | "removed" | "full";
  /** Takes the emote off a place. */
  clear(slot: number): void;
  /** Hears every change. Returns the call that stops it. */
  subscribe(listen: (slots: Slots) => void): () => void;
};

/** A game's wheel, read from this browser (or the default), and kept there on each change. */
export function createWheel(options: WheelOptions): Wheel {
  const ids = options.ids ?? EMOTES.map((e) => e.id);
  const storage = options.storage === undefined ? pageStorage() : options.storage;
  const key = wheelKey(options.game);
  let raw: string | null = null;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    raw = null;
  }
  let slots = readWheel(raw, ids, defaultWheel(ids, options.defaults));
  const listeners = new Set<(slots: Slots) => void>();
  const set = (next: Slots) => {
    slots = next;
    try {
      storage?.setItem(key, JSON.stringify(next));
    } catch {
      // A full or refused storage: the wheel still works for this page.
    }
    for (const l of listeners) l(slots);
  };
  return {
    get slots() {
      return slots;
    },
    toggle(id) {
      const r = toggleSlot(slots, id);
      if (r.did !== "full") set(r.slots);
      return r.did;
    },
    clear(slot) {
      if (slots[slot] == null) return;
      set(slots.map((x, i) => (i === slot ? null : x)));
    },
    subscribe(listen) {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
  };
}
