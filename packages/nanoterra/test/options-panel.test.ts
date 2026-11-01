// The Options key and panel in a fake DOM (happy-dom): the tabs (ARIA, the arrow keys), a change saves at once, a change from the game shows in place,
// Reset asks in the panel and never in a browser dialog, a key binding waits for its key, and a section added later is drawn.
import assert from "node:assert/strict";
import test, { before } from "node:test";
import { Window } from "happy-dom";
import type { OptionsStore } from "../src/options/index.js";

let mountOptions: typeof import("../src/options/index.js").mountOptions;
let createOptions: typeof import("../src/options/index.js").createOptions;
let common: typeof import("../src/options/index.js").common;
let keyBinding: typeof import("../src/options/index.js").keyBinding;
let reflectOptions: typeof import("../src/options/index.js").reflectOptions;
let win: Window;

before(async () => {
  win = new Window({ url: "https://game.example" });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
  ({ mountOptions, createOptions, common, keyBinding, reflectOptions } = await import("../src/options/index.js"));
});

const tick = () => new Promise((r) => setTimeout(r, 0));
const root = () => {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
};
function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}
function setup(over: { key?: boolean; device?: "phone" | "desktop" } = {}) {
  const storage = memory();
  const store = createOptions({
    game: "g",
    storage,
    device: () => over.device ?? "desktop",
    reducedMotion: () => false,
    defs: [...common("musicVolume", "invertLook", "quality", "stickSide"), keyBinding("jump", "Jump", "Space"), keyBinding("dig", "Dig", "KeyE")],
  });
  const el = root();
  const panel = mountOptions(el, store, { key: over.key });
  const q = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as unknown as T;
  const kept = () => JSON.parse(storage.data.get("n133-options:g") ?? "{}");
  return { store, el, panel, q, kept };
}
const press = (key: string, target: EventTarget = document, code = "") => target.dispatchEvent(new win.KeyboardEvent("keydown", { key, code, bubbles: true }) as unknown as Event);

test("the key opens a dialog with two ARIA tabs; the arrow keys, Home and End move between them; Escape and the close key close it", () => {
  const { el, panel, q, store } = setup();
  const key = q<HTMLButtonElement>(".n133o-key");
  const dialog = q(".n133o-panel");
  assert.equal(dialog.getAttribute("role"), "dialog");
  assert.equal(dialog.dataset.open, "false");
  key.click();
  assert.equal(dialog.dataset.open, "true");
  assert.equal(key.getAttribute("aria-expanded"), "true");
  const tabs = [...el.querySelectorAll('[role="tab"]')] as unknown as HTMLButtonElement[];
  assert.deepEqual(tabs.map((t) => t.textContent), ["Basic", "Advanced"]);
  assert.equal(q('[role="tablist"]').hidden, false);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.equal(document.activeElement, tabs[0], "the open panel focuses its tab");
  const pane = (t: HTMLButtonElement) => el.querySelector(`#${t.getAttribute("aria-controls")}`) as unknown as HTMLElement;
  assert.equal(pane(tabs[0]).hidden, false);
  assert.equal(pane(tabs[1]).hidden, true);
  // Basic holds Music; Advanced holds Invert look, Quality and the keys. A phone-only row (the stick) is not drawn on a desktop.
  assert.ok(pane(tabs[0]).querySelector('[data-key="musicVolume"]'));
  assert.ok(pane(tabs[1]).querySelector('[data-key="quality"]'));
  assert.equal(el.querySelector('[data-key="stickSide"]'), null);
  press("ArrowRight", tabs[0]);
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(pane(tabs[1]).hidden, false);
  assert.equal(document.activeElement, tabs[1]);
  press("ArrowRight", tabs[1]);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true", "wraps");
  press("End", tabs[0]);
  assert.equal(tabs[1].getAttribute("aria-selected"), "true");
  tabs[0].click(); // a tap
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  press("Escape");
  assert.equal(dialog.dataset.open, "false");
  assert.equal(document.activeElement, key, "the focus goes back to the key");
  panel.open();
  q<HTMLButtonElement>(".n133o-close").click();
  assert.equal(panel.isOpen, false);
  panel.open();
  q<HTMLElement>(".n133o-scrim").click();
  assert.equal(panel.isOpen, false, "a press on the scrim closes it");
  panel.destroy();
  assert.equal(el.childElementCount, 0);
  void store;
});

test("a change saves at once (no Save key): a switch, a choice, a slider; a change from the game shows in place", () => {
  const { q, kept, store, panel } = setup();
  panel.open();
  assert.equal(document.querySelector(".n133o-save"), null);
  const invert = q<HTMLButtonElement>('[data-key="invertLook"]');
  assert.equal(invert.getAttribute("role"), "switch");
  assert.equal(invert.getAttribute("aria-checked"), "false");
  invert.click();
  assert.equal(store.get("invertLook"), true);
  assert.deepEqual(kept(), { invertLook: true });
  assert.equal(invert.getAttribute("aria-checked"), "true");
  const radios = [...q('[data-key="quality"]').querySelectorAll('[role="radio"]')] as unknown as HTMLButtonElement[];
  assert.deepEqual(radios.map((r) => r.textContent), ["Low", "Medium", "High"]);
  radios[0].click();
  assert.equal(store.get("quality"), "low");
  assert.deepEqual(kept(), { invertLook: true, quality: "low" });
  assert.deepEqual(radios.map((r) => r.getAttribute("aria-checked")), ["true", "false", "false"]);
  const slider = q<HTMLInputElement>('[data-key="musicVolume"] input[type="range"]');
  slider.value = "35";
  slider.dispatchEvent(new win.Event("input", { bubbles: true }) as unknown as Event);
  assert.equal(store.get("musicVolume"), 35);
  assert.equal(kept().musicVolume, 35);
  assert.equal(q('[data-key="musicVolume"] .n133o-value').textContent, "35%");
  assert.equal(slider.getAttribute("aria-valuetext"), "35%");
  // The game changes values: the rows show them without a new draw (the same elements).
  store.set("musicVolume", 80);
  store.set("invertLook", false);
  assert.equal(q<HTMLInputElement>('[data-key="musicVolume"] input').value, "80");
  assert.equal(q('[data-key="musicVolume"] .n133o-value').textContent, "80%");
  assert.equal(q('[data-key="musicVolume"] input'), slider, "changed in place");
  assert.equal(invert.getAttribute("aria-checked"), "false");
  panel.destroy();
});

test("Reset to defaults asks in the panel, never with window.confirm; Cancel and Escape keep the values, Reset puts them back", async () => {
  const { q, store, panel, kept } = setup();
  const used: string[] = [];
  for (const f of ["confirm", "alert", "prompt"] as const) (globalThis as Record<string, unknown>)[f] = (window as unknown as Record<string, unknown>)[f] = () => {
    used.push(f);
    return true;
  };
  const reset = q<HTMLButtonElement>(".n133o-reset");
  assert.equal(reset.disabled, true, "nothing to reset");
  store.set("quality", "low");
  assert.equal(reset.disabled, false);
  reset.click(); // opens the panel and asks in it
  const ask = q(".n133o-ask");
  assert.equal(panel.isOpen, true);
  assert.equal(ask.hidden, false);
  assert.equal(ask.getAttribute("role"), "alertdialog");
  assert.match(q(".n133o-ask-q").textContent!, /back to its default/);
  const [yes, no] = [...ask.querySelectorAll("button")] as unknown as HTMLButtonElement[];
  assert.equal(yes.textContent, "Reset");
  no.click();
  await tick();
  assert.equal(store.get("quality"), "low");
  assert.equal(ask.hidden, true);
  reset.click();
  press("Escape"); // answers the question, the panel stays open
  await tick();
  assert.equal(store.get("quality"), "low");
  assert.equal(panel.isOpen, true);
  reset.click();
  yes.click();
  await tick();
  assert.equal(store.get("quality"), "high");
  assert.deepEqual(kept(), {});
  assert.equal(reset.disabled, true);
  assert.deepEqual(used, [], "no browser dialog");
  panel.destroy();
});

test("a key binding waits for its key, swaps a key another action has, and Escape keeps the old key", () => {
  const { q, store, panel } = setup();
  panel.open();
  const jump = q<HTMLButtonElement>('[data-key="keys.jump"] .n133o-keycap');
  assert.equal(jump.textContent, "Space");
  jump.click();
  assert.equal(jump.textContent, "Press a key");
  assert.equal(jump.getAttribute("aria-pressed"), "true");
  press("Escape", document, "Escape");
  assert.equal(panel.isOpen, true, "the Escape went to the binding, not the panel");
  assert.equal(store.get("keys.jump"), "Space");
  assert.equal(jump.textContent, "Space");
  jump.click();
  press("e", document, "KeyE");
  assert.equal(store.get("keys.jump"), "KeyE");
  assert.equal(store.get("keys.dig"), "Space", "swapped");
  assert.equal(jump.textContent, "E");
  assert.equal(q('[data-key="keys.dig"] .n133o-keycap').textContent, "Space");
  panel.destroy();
});

test("key: false draws no key; the game opens it; a section added later is drawn; one tab alone has no tab bar", () => {
  const store = createOptions({ game: "solo", storage: null, device: () => "phone", defs: common("musicVolume") });
  const el = root();
  const panel = mountOptions(el, store, { key: false, title: "Settings" });
  assert.equal(el.querySelector(".n133o-key"), null);
  assert.equal((el.querySelector('[role="tablist"]') as unknown as HTMLElement).hidden, true, "Basic only: no tabs");
  assert.equal(el.querySelector(".n133o-title")!.textContent, "Settings");
  panel.open();
  assert.equal(panel.isOpen, true);
  store.add([{ kind: "toggle", key: "emotes.show", label: "Show emotes", tab: "advanced", group: "Emotes", default: true }]);
  assert.equal((el.querySelector('[role="tablist"]') as unknown as HTMLElement).hidden, false, "now two tabs");
  assert.ok(el.querySelector('[data-key="emotes.show"]'));
  assert.deepEqual([...el.querySelectorAll(".n133o-group-title")].map((g) => g.textContent), ["Sound", "Emotes"]);
  panel.destroy();
});

test("reflectOptions keeps a setting on <html> for the page's CSS, and takes it off when stopped", () => {
  const store = createOptions({ game: "r", storage: null, reducedMotion: () => false, defs: [...common("reducedMotion"), { kind: "toggle", key: "emotes.show", label: "Show", tab: "basic", default: true }] });
  const stop = reflectOptions(store, ["reducedMotion", "emotes.show"]);
  const html = document.documentElement;
  assert.equal(html.getAttribute("data-n133-opt-reduced-motion"), "false");
  assert.equal(html.getAttribute("data-n133-opt-emotes-show"), "true");
  store.set("reducedMotion", true);
  assert.equal(html.getAttribute("data-n133-opt-reduced-motion"), "true");
  stop();
  assert.equal(html.hasAttribute("data-n133-opt-reduced-motion"), false);
  assert.throws(() => reflectOptions(store, ["nope"]), TypeError);
});

void (null as unknown as OptionsStore);
