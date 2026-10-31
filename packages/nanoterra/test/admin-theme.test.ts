// The admin panel's light and dark themes: the choice, what it resolves to (Device follows the device, live), a storage that fails, and the attributes.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";

let mod: typeof import("../src/admin/panel/theme.js");
let win: Window;
before(async () => {
  win = new Window({ url: "https://game.example" });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event });
  mod = await import("../src/admin/panel/theme.js");
});

/** A device setting the test can change. */
function fakeMedia(dark: boolean) {
  const listeners = new Set<() => void>();
  const list = {
    matches: dark,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  return {
    matchMedia: () => list as unknown as MediaQueryList,
    flip(next: boolean) {
      list.matches = next;
      for (const l of listeners) l();
    },
    listeners,
  };
}
const memory = (start: Record<string, string> = {}) => {
  const m = new Map(Object.entries(start));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const el = () => win.document.createElement("div") as unknown as HTMLElement;

test("a choice resolves: Light and Dark are fixed, Device follows the device", () => {
  assert.equal(mod.resolveTheme("light", true), "light");
  assert.equal(mod.resolveTheme("dark", false), "dark");
  assert.equal(mod.resolveTheme("device", true), "dark");
  assert.equal(mod.resolveTheme("device", false), "light");
});

test("the kept choice: none, a bad value or a storage that throws reads Device", () => {
  assert.equal(mod.readThemeChoice(memory()), "device");
  assert.equal(mod.readThemeChoice(memory({ [mod.THEME_KEY]: "dark" })), "dark");
  assert.equal(mod.readThemeChoice(memory({ [mod.THEME_KEY]: "purple" })), "device");
  assert.equal(mod.readThemeChoice(null), "device");
  const throws = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => { throw new Error("SecurityError"); } };
  assert.equal(mod.readThemeChoice(throws), "device");
  // A choice still works for the page when the storage refuses to keep it.
  const root = el();
  const t = mod.createTheme(root, { storage: throws, matchMedia: fakeMedia(false).matchMedia, host: null });
  t.set("dark");
  assert.equal(t.choice, "dark");
  assert.equal(root.getAttribute("data-theme"), "dark");
});

test("Device follows a live change of the device; Light and Dark do not; the attributes follow; destroy stops it", () => {
  const media = fakeMedia(false);
  const store = memory();
  const root = el();
  const host = el();
  const t = mod.createTheme(root, { storage: store, matchMedia: media.matchMedia, host });
  const heard: string[] = [];
  t.onChange((r, c) => heard.push(`${c}:${r}`));
  assert.equal(t.choice, "device");
  assert.equal(root.getAttribute("data-theme"), "light");
  assert.equal(host.getAttribute("data-n133-theme"), "light");

  media.flip(true);
  assert.equal(t.resolved, "dark");
  assert.equal(root.getAttribute("data-theme"), "dark");
  assert.equal(host.getAttribute("data-n133-theme"), "dark");

  t.set("light");
  assert.equal(store.m.get(mod.THEME_KEY), "light");
  media.flip(false);
  media.flip(true);
  assert.equal(root.getAttribute("data-theme"), "light", "a fixed choice ignores the device");
  assert.deepEqual(heard, ["device:dark", "light:light"]);

  // The next page reads the kept choice.
  const again = mod.createTheme(el(), { storage: store, matchMedia: media.matchMedia, host: null });
  assert.equal(again.choice, "light");

  t.destroy();
  assert.equal(host.hasAttribute("data-n133-theme"), false);
  assert.equal(media.listeners.size, 1, "only the second control still listens");
});

test("the key: names the choice, opens a menu of three, a press sets the theme", () => {
  const root = el();
  const t = mod.createTheme(root, { storage: memory(), matchMedia: fakeMedia(true).matchMedia, host: null });
  const key = mod.themeKey(t) as HTMLDetailsElement;
  const summary = key.querySelector("summary")!;
  assert.equal(summary.getAttribute("aria-label"), "Theme: Device (dark now)");
  const rows = [...key.querySelectorAll("button")];
  assert.deepEqual(rows.map((r) => r.textContent), ["Device", "Light", "Dark"]);
  assert.deepEqual(rows.map((r) => r.getAttribute("aria-pressed")), ["true", "false", "false"]);
  key.open = true;
  rows[1]!.click();
  assert.equal(t.choice, "light");
  assert.equal(root.getAttribute("data-theme"), "light");
  assert.equal(summary.getAttribute("aria-label"), "Theme: Light");
  assert.deepEqual(rows.map((r) => r.getAttribute("aria-pressed")), ["false", "true", "false"]);
  assert.equal(key.open, false);
});
