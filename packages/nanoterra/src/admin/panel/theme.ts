// The panel's light and dark themes. The owner picks Light, Dark or Device (the device's own setting, `prefers-color-scheme`, followed live); Device is the
// default. The choice is kept in this browser only (localStorage, `n133-admin-theme`): no server call, no admin setting. A private window, or a browser that
// refuses storage, still works: it reads Device and keeps a choice for the life of the page.
//
// The resolved theme is set as data-theme="light" | "dark" on the panel's root (style.css reads it), and as data-n133-theme on the page's <html> while the panel
// is mounted, so the page around the panel can follow it (README, "Light and dark").

import { h } from "./dom.js";
import { icon, type IconName } from "./icons.js";

export type ThemeChoice = "device" | "light" | "dark";
export type Theme = "light" | "dark";

/** The localStorage key of the choice. */
export const THEME_KEY = "n133-admin-theme";
export const THEME_CHOICES: readonly ThemeChoice[] = ["device", "light", "dark"];
const QUERY = "(prefers-color-scheme: dark)";

/** The theme a choice gives: Device follows the device's setting. */
export const resolveTheme = (choice: ThemeChoice, deviceDark: boolean): Theme => (choice === "device" ? (deviceDark ? "dark" : "light") : choice);

const isChoice = (v: unknown): v is ThemeChoice => typeof v === "string" && (THEME_CHOICES as readonly string[]).includes(v);

type Store = Pick<Storage, "getItem" | "setItem">;

/** The page's localStorage, or null where reading it throws (some private windows, a blocked site). */
function pageStorage(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The kept choice; Device when there is none, it is not a choice, or the storage cannot be read. */
export function readThemeChoice(storage: Store | null = pageStorage()): ThemeChoice {
  try {
    const v = storage?.getItem(THEME_KEY);
    return isChoice(v) ? v : "device";
  } catch {
    return "device";
  }
}

export type ThemeOptions = {
  /** Where the choice is kept (default: the page's localStorage). null keeps it only for the life of the page. */
  storage?: Store | null;
  /** The device's setting (default: window.matchMedia). */
  matchMedia?: ((query: string) => Pick<MediaQueryList, "matches" | "addEventListener" | "removeEventListener">) | null;
  /** The page's root, which gets data-n133-theme (default: document.documentElement). null sets nothing outside the panel. */
  host?: HTMLElement | null;
};

export type ThemeControl = {
  /** What the owner chose. */
  readonly choice: ThemeChoice;
  /** The theme drawn now. */
  readonly resolved: Theme;
  /** Picks a theme, keeps it in this browser and draws it. */
  set(choice: ThemeChoice): void;
  /** Hears every change of the choice or the drawn theme (the device's setting too). Returns the call that stops it. */
  onChange(listen: (resolved: Theme, choice: ThemeChoice) => void): () => void;
  /** Stops following the device and takes data-n133-theme off the page. */
  destroy(): void;
};

/** Reads the kept choice and draws it on `root` at once (data-theme), and on the page's <html> (data-n133-theme). */
export function createTheme(root: HTMLElement, options: ThemeOptions = {}): ThemeControl {
  const storage = options.storage === undefined ? pageStorage() : options.storage;
  const host = options.host === undefined ? (globalThis.document?.documentElement ?? null) : options.host;
  let media: ReturnType<NonNullable<ThemeOptions["matchMedia"]>> | null = null;
  try {
    const mm = options.matchMedia === undefined ? (typeof globalThis.matchMedia === "function" ? globalThis.matchMedia.bind(globalThis) : null) : options.matchMedia;
    media = mm ? mm(QUERY) : null;
  } catch {
    media = null;
  }
  let choice = readThemeChoice(storage);
  let resolved: Theme = "light";
  const listeners = new Set<(resolved: Theme, choice: ThemeChoice) => void>();

  function draw() {
    resolved = resolveTheme(choice, media?.matches === true);
    root.setAttribute("data-theme", resolved);
    host?.setAttribute("data-n133-theme", resolved);
    for (const l of listeners) l(resolved, choice);
  }
  const onDevice = () => {
    if (choice === "device") draw();
  };
  media?.addEventListener?.("change", onDevice);
  draw();

  return {
    get choice() {
      return choice;
    },
    get resolved() {
      return resolved;
    },
    set(next) {
      if (!isChoice(next)) return;
      choice = next;
      try {
        storage?.setItem(THEME_KEY, next);
      } catch {
        // A full or refused storage: the choice holds for this page only.
      }
      draw();
    },
    onChange(listen) {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
    destroy() {
      media?.removeEventListener?.("change", onDevice);
      listeners.clear();
      host?.removeAttribute("data-n133-theme");
    },
  };
}

const WORDS: Record<ThemeChoice, string> = { device: "Device", light: "Light", dark: "Dark" };
const ICONS: Record<ThemeChoice, IconName> = { device: "device", light: "sun", dark: "moon" };

/** "Theme: Dark", or "Theme: Device (dark now)". */
export const themeLabel = (choice: ThemeChoice, resolved: Theme): string => (choice === "device" ? `Theme: Device (${resolved} now)` : `Theme: ${WORDS[choice]}`);

/**
 * The theme key: a 44 px round key with the choice's icon (a sun, a moon, a half circle for Device). A press opens a small menu of the three choices, each a
 * 44 px row with its icon and word; the chosen one is pressed (aria-pressed). A choice, Escape or a press outside closes it.
 */
export function themeKey(theme: ThemeControl): HTMLElement {
  const summary = h("summary", { class: "btn btn-quiet theme-summary" });
  const rows = THEME_CHOICES.map((c) =>
    h(
      "button",
      {
        class: "theme-choice",
        type: "button",
        "data-choice": c,
        onclick: () => {
          theme.set(c);
          box.open = false;
          summary.focus();
        },
      },
      icon(ICONS[c], 18),
      WORDS[c],
    ),
  );
  const menu = h("div", { class: "theme-menu", role: "group", "aria-label": "Theme" }, ...rows);
  const box = h("details", { class: "theme-key" }, summary, menu);

  const outside = (e: Event) => {
    if (!box.contains(e.target as Node)) box.open = false;
  };
  box.addEventListener("toggle", () => {
    if (box.open) document.addEventListener("pointerdown", outside, true);
    else document.removeEventListener("pointerdown", outside, true);
  });
  box.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape" && box.open) {
      box.open = false;
      summary.focus();
    }
  });

  const show = (resolved: Theme, choice: ThemeChoice) => {
    const label = themeLabel(choice, resolved);
    summary.replaceChildren(icon(ICONS[choice], 20));
    summary.title = label;
    summary.setAttribute("aria-label", label);
    for (const r of rows) r.setAttribute("aria-pressed", String(r.dataset.choice === choice));
  };
  show(theme.resolved, theme.choice);
  theme.onChange(show);
  return box;
}
