// The options store: a game's settings as data, their defaults for this device, and the player's choices, kept in this browser. No DOM: a game with its own
// menu reads, writes and hears the store; the kit's panel (./panel) is one view of it.
//
//   - A setting is a def: a toggle (on or off), a choice (one of a list), a range (a number from min to max in steps) or a key (a key binding: a
//     `KeyboardEvent.code`). Each has a key, a label the player reads, an optional help line, a tab ("basic" or "advanced"), an optional group heading and
//     a default.
//   - A default is one value, or one for each device class: { phone?, tablet?, desktop?, reducedMotion?, default }. The class comes from the pointer and the
//     screen (`detectDevice`); `reducedMotion` wins while the device asks for less motion. The device's reduced-motion setting is followed LIVE: a player
//     who never set the option follows the device when it changes (Echo Island's draft, 2026-11-01).
//   - Only the choices that DIFFER from this device's default are kept (localStorage, `n133-options:<game>`), so a better default later reaches every
//     player who never touched that setting. A value that does not fit its def any more (the wrong type, out of range, an unknown choice) is dropped on
//     read, and so is a key that no def has, unless it has a dot: a key like "emotes.show" belongs to a module's section that may be added later, so it waits.
//   - Two key bindings never share a key: setting one to a key that another has gives the other this one's old key (a swap).
//   - A refused storage (some private windows, a full disk) works in memory for the life of the page.

import { keyLabel } from "./keyLabel.js";
export { keyLabel };

export type Tab = "basic" | "advanced";
export type DeviceClass = "phone" | "tablet" | "desktop";
export const DEVICE_CLASSES: readonly DeviceClass[] = ["phone", "tablet", "desktop"];

/** A default for each device class. `default` is for a class left out; `reducedMotion` wins while the device asks for less motion. */
export type DeviceDefault<V> = { phone?: V; tablet?: V; desktop?: V; reducedMotion?: V; default: V };

type DefBase<V> = {
  /** The key the game reads. Letters, digits, "_" and "-", in parts joined by dots; a module's section starts with its own name ("emotes.show"). */
  key: string;
  /** The words on the row: short, the player reads them ("Music", "Invert look"). */
  label: string;
  /**
   * One short line under the label. "{key:<a key binding's key>}" in it names that binding's key as the player has it now ("{key:keys.emotes} still opens
   * the wheel" reads "G still opens the wheel"), and the panel draws it again when the binding changes; "{key:<key>|<code>}" names <code>'s key when the
   * store has no such binding. See `helpText`.
   */
  help?: string;
  tab: Tab;
  /** The heading the row goes under, in the order the groups first appear. Rows with no group come first. */
  group?: string;
  default: V | DeviceDefault<V>;
  /** Show the row only on these device classes (a stick's side means nothing with a mouse). The store keeps the value on every device. */
  devices?: readonly DeviceClass[];
};

export type ToggleDef = DefBase<boolean> & { kind: "toggle" };
export type ChoiceValue = string | number;
export type ChoiceDef = DefBase<ChoiceValue> & {
  kind: "choice";
  /** At least two, each value once. */
  choices: readonly { value: ChoiceValue; label: string }[];
  /** "buttons": a row of keys; "list": a drop-down. Left out: buttons for at most 4 short labels (10 characters), else a list. */
  display?: "buttons" | "list";
};
export type RangeDef = DefBase<number> & {
  kind: "range";
  min: number;
  max: number;
  step: number;
  /** Put after the number as written: "%" gives "80%", " s" gives "3 s". */
  unit?: string;
};
/** A key binding: the value is a `KeyboardEvent.code` ("KeyE", "Space", "ArrowUp"): the key's place, the same on every keyboard layout. */
export type KeyDef = DefBase<string> & { kind: "key" };
export type OptionDef = ToggleDef | ChoiceDef | RangeDef | KeyDef;
export type OptionValue = boolean | ChoiceValue;

type Kept = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type OptionsInit = {
  /** The game's id: the storage key is `n133-options:<game>`. */
  game: string;
  defs: readonly OptionDef[];
  /** The device class (default: `detectDevice`). */
  device?: () => DeviceClass;
  /** Whether the device asks for less motion (default: `prefers-reduced-motion: reduce`, followed live). A game's own function is read at start and on `redetect()`. */
  reducedMotion?: () => boolean;
  /** Where the choices are kept (default: the page's localStorage). null keeps them for the life of the page only. */
  storage?: Kept | null;
  /**
   * Changes what was kept before it is read: a renamed key, a new scale, or a game's old save under another key (read it from `storage` when `stored` is
   * empty, and remove it). Gets a copy of the stored object ({} when there is none); returns the object to read. What it returns is checked like any kept value.
   */
  migrate?: (stored: Record<string, unknown>, storage: Kept | null) => Record<string, unknown> | null | undefined;
};

export type OptionsStore = {
  readonly game: string;
  /** The device class the defaults are resolved for. */
  readonly device: DeviceClass;
  /** The value now. Throws for a key no def has. */
  get<T extends OptionValue = OptionValue>(key: string): T;
  /**
   * Sets a value, keeps it (only if it differs from the default) and tells the listeners. A range's number is put on its nearest step inside min and max;
   * a key binding that another binding has swaps with it. Throws a TypeError for an unknown key, a value of the wrong type, a number that is not finite,
   * an unknown choice and a key binding that is not a `KeyboardEvent.code`.
   */
  set(key: string, value: OptionValue): void;
  /** One setting back to its default; with no key, every setting. */
  reset(key?: string): void;
  /** Every value now, by key (a copy). */
  values(): Record<string, OptionValue>;
  /** The defs, in order (the game's first, then each section in the order it was added). */
  defs(): readonly OptionDef[];
  /** The def of a key, or undefined. */
  def(key: string): OptionDef | undefined;
  /** This device's default for a key now. Throws for a key no def has. */
  defaultOf(key: string): OptionValue;
  /** True when the key (or, with no key, every setting) is at its default. */
  isDefault(key?: string): boolean;
  /** Hears each change of a value (set, reset, a default that moved): the key and the new value. Returns the call that stops it. */
  subscribe(fn: (key: string, value: OptionValue) => void): () => void;
  /** Hears each add(): a panel draws the new rows. Returns the call that stops it. */
  subscribeDefs(fn: () => void): () => void;
  /** Adds defs later (a module's section). A key that is already there throws, and nothing is added. */
  add(defs: readonly OptionDef[]): void;
  /** Reads the device class and reduced motion again and moves the defaults: a setting the player never changed follows, and its listeners hear it. */
  redetect(): void;
};

export const OPTIONS_PREFIX = "n133-options:";
/** The localStorage key of a game's choices. */
export const optionsKey = (game: string): string => `${OPTIONS_PREFIX}${game}`;

const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*)*$/;
const KEY_MAX = 64;
/** A `KeyboardEvent.code`: "KeyE", "Digit1", "Space", "ArrowUp", "F5". */
const CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

type Media = Pick<MediaQueryList, "matches"> & Partial<Pick<MediaQueryList, "addEventListener">>;
/** A media query; null when there is none (Node, a test). */
function mediaQuery(query: string): Media | null {
  try {
    return typeof globalThis.matchMedia === "function" ? globalThis.matchMedia(query) : null;
  } catch {
    return null;
  }
}

/**
 * The device class: a coarse pointer (a finger) and a short side under 600 px is a phone; a coarse pointer otherwise is a tablet; anything else is a
 * desktop. The short side is the screen's, so turning a phone does not change it. With no matchMedia (Node), a desktop.
 */
export function detectDevice(): DeviceClass {
  if (mediaQuery("(pointer: coarse)")?.matches !== true) return "desktop";
  const g = globalThis as { screen?: { width: number; height: number }; innerWidth?: number; innerHeight?: number };
  const short = Math.min(g.screen?.width || g.innerWidth || 0, g.screen?.height || g.innerHeight || 0);
  return short > 0 && short < 600 ? "phone" : "tablet";
}

/** `prefers-reduced-motion: reduce`; false where it cannot be read. */
export const prefersReducedMotion = (): boolean => mediaQuery(REDUCE_QUERY)?.matches === true;

const isDeviceDefault = <V>(d: V | DeviceDefault<V>): d is DeviceDefault<V> => typeof d === "object" && d !== null;

/** The default a def has on a device class (and with reduced motion asked for or not). */
export function resolveDefault<V extends OptionValue>(def: { default: V | DeviceDefault<V> }, device: DeviceClass, reducedMotion = false): V {
  const d = def.default;
  if (!isDeviceDefault(d)) return d;
  if (reducedMotion && d.reducedMotion !== undefined) return d.reducedMotion;
  return d[device] !== undefined ? (d[device] as V) : d.default;
}

/** The number of decimals of a number, so a snapped value is 0.3 and not 0.30000000000000004. */
const decimals = (n: number): number => {
  const s = String(n);
  const e = s.match(/e-(\d+)$/);
  if (e) return Number(e[1]);
  const dot = s.indexOf(".");
  return dot < 0 ? 0 : s.length - dot - 1;
};

/** A number on a range's nearest step from min, inside min and max. */
export function snapToRange(def: Pick<RangeDef, "min" | "max" | "step">, v: number): number {
  const places = Math.max(decimals(def.step), decimals(def.min));
  const steps = Math.round((Math.min(def.max, Math.max(def.min, v)) - def.min) / def.step);
  const out = Number((def.min + steps * def.step).toFixed(places));
  return out > def.max ? Number((out - def.step).toFixed(places)) : out;
}

const HELP_KEY_RE = /\{key:([A-Za-z0-9_.-]+)(?:\|([A-Za-z0-9]+))?\}/g;

/** The key bindings a help line names with "{key:...}", each once. */
export const helpKeys = (help: string): string[] => [...new Set(Array.from(help.matchAll(HELP_KEY_RE), (m) => m[1]))];

/**
 * A help line's words: each "{key:<binding>}" becomes that binding's key cap words now (`keyLabel` of the store's value). A binding the store does not
 * have gives the code after "|" ("{key:keys.emotes|KeyB}"), else "Its key". A line with no "{key:" comes back as it is.
 */
export function helpText(help: string, store: Pick<OptionsStore, "get">): string {
  return help.replace(HELP_KEY_RE, (_, k: string, code?: string) => {
    let v: unknown;
    try {
      v = store.get(k);
    } catch {
      v = undefined;
    }
    return typeof v === "string" && v ? keyLabel(v) : code ? keyLabel(code) : "Its key";
  });
}

/** Whether a value fits a def as it is (a range's number must be in range; it is not snapped here). */
function fits(def: OptionDef, v: unknown): boolean {
  if (def.kind === "toggle") return typeof v === "boolean";
  if (def.kind === "choice") return (typeof v === "string" || typeof v === "number") && def.choices.some((c) => c.value === v);
  if (def.kind === "key") return typeof v === "string" && CODE_RE.test(v);
  return typeof v === "number" && Number.isFinite(v) && v >= def.min && v <= def.max;
}

/** The first thing wrong with a def, as a sentence, or null. `createOptions` and `add` throw it. */
export function defProblem(def: OptionDef): string | null {
  const d = def as Partial<OptionDef> & Record<string, unknown>;
  if (!d || typeof d !== "object") return "a def must be an object";
  const name = typeof d.key === "string" ? `"${d.key}"` : "a def";
  if (typeof d.key !== "string" || !KEY_RE.test(d.key) || d.key.length > KEY_MAX) return `${name}: the key must be letters, digits, "_" and "-", in parts joined by dots, at most ${KEY_MAX} characters`;
  if (d.kind !== "toggle" && d.kind !== "choice" && d.kind !== "range" && d.kind !== "key") return `${name}: kind must be "toggle", "choice", "range" or "key"`;
  if (typeof d.label !== "string" || !d.label.trim()) return `${name}: the label is empty`;
  if (d.help !== undefined && typeof d.help !== "string") return `${name}: help must be text`;
  if (d.tab !== "basic" && d.tab !== "advanced") return `${name}: tab must be "basic" or "advanced"`;
  if (d.group !== undefined && (typeof d.group !== "string" || !d.group.trim())) return `${name}: the group is empty`;
  if (d.devices !== undefined && (!Array.isArray(d.devices) || !d.devices.length || d.devices.some((c) => !DEVICE_CLASSES.includes(c)))) return `${name}: devices must list "phone", "tablet" or "desktop"`;
  if (def.kind === "choice") {
    if (!Array.isArray(def.choices) || def.choices.length < 2) return `${name}: a choice needs two choices or more`;
    const seen = new Set<ChoiceValue>();
    for (const c of def.choices) {
      if (!c || (typeof c.value !== "string" && typeof c.value !== "number") || typeof c.label !== "string" || !c.label.trim()) return `${name}: each choice needs a value (text or a number) and a label`;
      if (seen.has(c.value)) return `${name}: the choice ${JSON.stringify(c.value)} is there twice`;
      seen.add(c.value);
    }
    if (def.display !== undefined && def.display !== "buttons" && def.display !== "list") return `${name}: display must be "buttons" or "list"`;
  }
  if (def.kind === "range") {
    if (![def.min, def.max, def.step].every((n) => typeof n === "number" && Number.isFinite(n))) return `${name}: min, max and step must be numbers`;
    if (!(def.min < def.max)) return `${name}: min must be under max`;
    if (!(def.step > 0) || def.step > def.max - def.min) return `${name}: the step must be above 0 and at most max - min`;
    if (def.unit !== undefined && typeof def.unit !== "string") return `${name}: the unit must be text`;
  }
  const dflt = d.default as unknown;
  if (dflt === undefined) return `${name}: there is no default`;
  let values: [string, unknown][] = [["default", dflt]];
  if (isDeviceDefault(dflt as never)) {
    values = Object.entries(dflt as Record<string, unknown>);
    const odd = values.find(([k]) => k !== "default" && k !== "reducedMotion" && !DEVICE_CLASSES.includes(k as DeviceClass));
    if (odd) return `${name}: a default for each device takes phone, tablet, desktop, reducedMotion and default, not "${odd[0]}"`;
    if (!values.some(([k, v]) => k === "default" && v !== undefined)) return `${name}: a default for each device needs "default" too`;
  }
  for (const [k, v] of values) {
    if (v === undefined) continue;
    if (!fits(def, v)) return `${name}: the default${k === "default" ? "" : ` for ${k}`} (${JSON.stringify(v)}) does not fit the def`;
  }
  return null;
}

/** The page's localStorage, or null where reading it throws. */
function pageStorage(): Kept | null {
  try {
    return (globalThis as { localStorage?: Kept }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Makes the store, reads what this browser kept for the game, and drops what does not fit. Throws for a bad def or a key that is there twice. */
export function createOptions(init: OptionsInit): OptionsStore {
  if (typeof init?.game !== "string" || !init.game.trim()) throw new TypeError("createOptions: game must be the game's id");
  const game = init.game;
  const storage = init.storage === undefined ? pageStorage() : init.storage;
  const detect = () => {
    let device: DeviceClass = "desktop";
    let reduce = false;
    try {
      const d = (init.device ?? detectDevice)();
      if (DEVICE_CLASSES.includes(d)) device = d;
    } catch {
      // The detection failed: a desktop.
    }
    try {
      reduce = (init.reducedMotion ?? prefersReducedMotion)() === true;
    } catch {
      // Not known: full motion.
    }
    return { device, reduce };
  };
  let env = detect();

  const list: OptionDef[] = [];
  const byKey = new Map<string, OptionDef>();
  const dflt = new Map<string, OptionValue>();
  /** The player's choices that differ from the default, by key. */
  const diff = new Map<string, OptionValue>();
  /** Kept keys with a dot whose section has not been added yet: written back as they were, and read when the section comes. */
  let waiting: Record<string, unknown> = {};
  const listeners = new Set<(key: string, value: OptionValue) => void>();
  const defListeners = new Set<() => void>();
  const defaultFor = (def: OptionDef) => resolveDefault<OptionValue>(def as { default: OptionValue | DeviceDefault<OptionValue> }, env.device, env.reduce);

  const read = (): Record<string, unknown> => {
    let kept: Record<string, unknown> = {};
    try {
      const raw = storage?.getItem(optionsKey(game));
      const v: unknown = raw ? JSON.parse(raw) : null;
      if (v && typeof v === "object" && !Array.isArray(v)) kept = v as Record<string, unknown>;
    } catch {
      // Unreadable or not JSON: nothing was kept.
    }
    if (!init.migrate) return kept;
    try {
      const out = init.migrate({ ...kept }, storage);
      return out && typeof out === "object" && !Array.isArray(out) ? out : {};
    } catch {
      // The migration threw: what was kept, as it was.
      return kept;
    }
  };
  const write = () => {
    if (!storage) return;
    const out: Record<string, unknown> = { ...waiting };
    for (const [k, v] of diff) out[k] = v;
    try {
      if (Object.keys(out).length) storage.setItem(optionsKey(game), JSON.stringify(out));
      else storage.removeItem(optionsKey(game));
    } catch {
      // A full or refused storage: the choices hold for this page only.
    }
  };

  /** Checks the defs (all of them, and against the store) before any is taken, so a bad one adds nothing. */
  const take = (defs: readonly OptionDef[]) => {
    if (!Array.isArray(defs)) throw new TypeError("options: defs must be a list");
    const fresh = new Set<string>();
    for (const def of defs) {
      const p = defProblem(def);
      if (p) throw new TypeError(`options: ${p}`);
      if (byKey.has(def.key) || fresh.has(def.key)) throw new Error(`options: the key "${def.key}" is there twice`);
      fresh.add(def.key);
    }
    for (const def of defs) {
      list.push(def);
      byKey.set(def.key, def);
      dflt.set(def.key, defaultFor(def));
    }
  };
  /** Reads kept values for these keys: a value that fits and is not the default is a choice; the rest is dropped. */
  const adopt = (kept: Record<string, unknown>, keys: Iterable<string>) => {
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(kept, key)) continue;
      const def = byKey.get(key)!;
      let v = kept[key];
      if (def.kind === "range" && typeof v === "number" && Number.isFinite(v) && v >= def.min && v <= def.max) v = snapToRange(def, v);
      if (fits(def, v) && v !== dflt.get(key)) diff.set(key, v as OptionValue);
    }
  };

  take(init.defs ?? []);
  const kept = read();
  adopt(kept, byKey.keys());
  for (const [k, v] of Object.entries(kept)) if (!byKey.has(k) && k.includes(".") && KEY_RE.test(k)) waiting[k] = v;
  // A migration's result is written at once (the old save may be gone), and a store with values dropped on read writes the cleaner object.
  if (init.migrate || Object.keys(kept).length !== diff.size + Object.keys(waiting).length) write();

  const need = (key: string): OptionDef => {
    const def = byKey.get(key);
    if (!def) throw new TypeError(`options: no setting has the key "${key}"`);
    return def;
  };
  const now = (key: string): OptionValue => (diff.has(key) ? diff.get(key)! : dflt.get(key)!);
  const tell = (key: string, value: OptionValue) => {
    for (const fn of [...listeners]) {
      try {
        fn(key, value);
      } catch (e) {
        // One listener's fault must not stop the others or the change: it is thrown on its own.
        queueMicrotask(() => {
          throw e;
        });
      }
    }
  };
  /** Sets the value in memory; the caller writes. */
  const put = (key: string, value: OptionValue) => {
    const was = now(key);
    if (value === dflt.get(key)) diff.delete(key);
    else diff.set(key, value);
    if (was !== value) tell(key, value);
  };

  const store: OptionsStore = {
    game,
    get device() {
      return env.device;
    },
    get<T extends OptionValue = OptionValue>(key: string): T {
      need(key);
      return now(key) as T;
    },
    set(key, value) {
      const def = need(key);
      let v: unknown = value;
      if (def.kind === "range") {
        if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`options: "${key}" takes a number`);
        v = snapToRange(def, v);
      }
      if (!fits(def, v)) throw new TypeError(`options: ${JSON.stringify(value)} does not fit "${key}"`);
      if (def.kind === "key") {
        // The binding that had this key gets this one's old key, so two actions never share a key.
        const old = now(key);
        if (old !== v) for (const other of list) if (other.kind === "key" && other.key !== key && now(other.key) === v) put(other.key, old);
      }
      put(key, v as OptionValue);
      write();
    },
    reset(key) {
      const keys = key === undefined ? [...byKey.keys()] : [need(key).key];
      for (const k of keys) put(k, dflt.get(k)!);
      write();
    },
    values() {
      const out: Record<string, OptionValue> = {};
      for (const k of byKey.keys()) out[k] = now(k);
      return out;
    },
    defs: () => list.slice(),
    def: (key) => byKey.get(key),
    defaultOf(key) {
      need(key);
      return dflt.get(key)!;
    },
    isDefault(key) {
      if (key === undefined) return diff.size === 0;
      need(key);
      return !diff.has(key);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    subscribeDefs(fn) {
      defListeners.add(fn);
      return () => void defListeners.delete(fn);
    },
    add(defs) {
      take(defs);
      adopt(waiting, defs.map((d) => d.key));
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(waiting)) if (!byKey.has(k)) rest[k] = v;
      waiting = rest;
      for (const fn of [...defListeners]) fn();
    },
    redetect() {
      env = detect();
      let wrote = false;
      for (const def of list) {
        const was = now(def.key);
        dflt.set(def.key, defaultFor(def));
        // A choice that now equals the default follows the default again.
        if (diff.get(def.key) === dflt.get(def.key)) {
          diff.delete(def.key);
          wrote = true;
        }
        if (now(def.key) !== was) tell(def.key, now(def.key));
      }
      if (wrote) write();
    },
  };

  // The device's reduced-motion setting, followed live (only the kit's own reading: a game's function is read on redetect()).
  if (!init.reducedMotion) mediaQuery(REDUCE_QUERY)?.addEventListener?.("change", () => store.redetect());
  return store;
}

/** A module's section: its defs with the module's name before each key ("show" in "emotes" is "emotes.show"), and its group when a def has none. */
export function optionSection(name: string, defs: readonly OptionDef[], group?: string): OptionDef[] {
  if (!KEY_RE.test(name) || name.includes(".")) throw new TypeError(`optionSection: "${name}" must be one part of a key (letters, digits, "_" and "-")`);
  return defs.map((d) => ({ ...d, key: `${name}.${d.key}`, ...(group && !d.group ? { group } : {}) }));
}

/** A key binding def: the key `keys.<action>`, in Advanced under "Keys", shown on a desktop only (a touch screen has no keys to bind). */
export function keyBinding(action: string, label: string, code: string, over: Partial<Omit<KeyDef, "kind">> = {}): KeyDef {
  return { kind: "key", key: `keys.${action}`, label, tab: "advanced", group: "Keys", default: code, devices: ["desktop"], ...over };
}
