// The input helpers (@nano133/nanoterra/input): a key that is down when the player leaves the page never sends its keyup, and the character walked on
// by itself on return (nano133.com, Wes, 2026-10-29). Each way that the page can lose a keyup lets the held input go, a repeat after a leave is dropped
// until a key goes down again, and `pauseWhenLeft` pauses only for a real leave.
import assert from "node:assert/strict";
import { test } from "node:test";
import { pauseWhenLeft, releaseWhenLost, swallowsKeyup } from "../src/input/index.js";

/** A game's held set, as a game has it: keydown adds, keyup takes away, a key with Cmd is left out. */
function game() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const keys = new Set<string>();
  /** A thumb stick's walk: let go with the keys, but not for a menu (a long press on a touch screen asks for one). */
  const stick = { on: false };
  const off = releaseWhenLost(() => (keys.clear(), (stick.on = false)), () => keys.clear(), win, doc);
  const key = (type: "keydown" | "keyup", k: string, metaKey = false, repeat = false) => {
    let stopped = false;
    const e = Object.assign(new Event(type), { key: k, metaKey, repeat });
    // A stale repeat is stopped in the capture phase: the game's own handler never runs for it (a real window does the same).
    e.stopImmediatePropagation = () => void (stopped = true);
    win.dispatchEvent(e);
    if (stopped) return;
    // The game's own handler (after the capture listener of releaseWhenLost).
    if (type === "keydown" && !swallowsKeyup(e)) keys.add(k);
    if (type === "keyup") keys.delete(k);
  };
  return { win, doc, keys, stick, off, key };
}

test("a key that is held and released walks and stops", () => {
  const g = game();
  g.key("keydown", "w");
  assert.deepEqual([...g.keys], ["w"]);
  g.key("keyup", "w");
  assert.equal(g.keys.size, 0);
});

test("each way that the page loses the keyup lets the held input go", () => {
  for (const way of ["blur", "pagehide", "focus"]) {
    const g = game();
    g.key("keydown", "w");
    g.stick.on = true;
    g.win.dispatchEvent(new Event(way));
    assert.ok(g.keys.size === 0 && !g.stick.on, `the window's ${way}: the keys and the stick`);
  }
  // A menu (a right click) takes a keyup: the keys go. A long press on a touch screen asks for a menu too: the stick stays.
  const m = game();
  m.key("keydown", "w");
  m.stick.on = true;
  m.win.dispatchEvent(new Event("contextmenu"));
  assert.ok(m.keys.size === 0 && m.stick.on, "a menu: the keys go, a thumb on the stick walks on");
  // A menu that the page stopped did not open: no keyup is lost, and the held keys stay.
  const stopped = game();
  stopped.key("keydown", "w");
  const noMenu = new Event("contextmenu", { cancelable: true });
  noMenu.preventDefault();
  stopped.win.dispatchEvent(noMenu);
  assert.ok(stopped.keys.has("w"), "a menu that was stopped: the held key stays");
  // A hidden tab (Ctrl+Tab, Cmd+a number): the window may keep its focus, and no blur comes.
  const h = game();
  h.key("keydown", "w");
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.keys.size, 0, "the tab goes hidden");
  // Back in view is no reason to let go of a key that is down now.
  h.key("keydown", "d");
  h.doc.hidden = false;
  h.doc.dispatchEvent(new Event("visibilitychange"));
  assert.deepEqual([...h.keys], ["d"], "the tab comes back: a key that went down since stays");
});

test("a repeat that follows a leave does not put a key back", () => {
  // W is held, the window blurs (the keyup goes to the other window), then one more repeat of W arrives.
  const g = game();
  g.key("keydown", "w");
  g.win.dispatchEvent(new Event("blur"));
  assert.equal(g.keys.size, 0);
  g.key("keydown", "w", false, true);
  assert.equal(g.keys.size, 0, "a late repeat after the blur: the key stays out");
  // The repeats go on when the window comes back (the key is still down, or its keyup was lost): still out.
  g.win.dispatchEvent(new Event("focus"));
  g.key("keydown", "w", false, true);
  assert.equal(g.keys.size, 0, "a repeat after the return: the key stays out");
  // The player presses W again: that is a key that goes down. It walks, and its repeats count from then on.
  g.key("keydown", "w");
  assert.deepEqual([...g.keys], ["w"], "a new press walks");
  g.key("keydown", "w", false, true);
  assert.deepEqual([...g.keys], ["w"]);
  g.key("keyup", "w");
  assert.equal(g.keys.size, 0);
  // A hidden tab, then a repeat, then the tab is shown with no focus event at all.
  const h = game();
  h.key("keydown", "w");
  h.doc.hidden = true;
  h.doc.dispatchEvent(new Event("visibilitychange"));
  h.key("keydown", "w", false, true);
  h.doc.hidden = false;
  h.doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(h.keys.size, 0, "a hidden tab, a repeat, shown again: nothing is held");
  // Any key that goes down ends the wait, not only the same one.
  h.key("keydown", "a");
  h.key("keydown", "w", false, true);
  assert.deepEqual([...h.keys].sort(), ["a", "w"], "after a new press, repeats count again");
  // A menu is no leave: the held key that a menu took comes back by its repeat.
  const m = game();
  m.key("keydown", "w");
  m.win.dispatchEvent(new Event("contextmenu"));
  assert.equal(m.keys.size, 0);
  m.key("keydown", "w", false, true);
  assert.deepEqual([...m.keys], ["w"], "after a menu the repeat puts the key back");
});

test("Cmd on a Mac: a key that is released while Cmd is down sends no keyup", () => {
  // W is held; Cmd goes down (Cmd+Shift+4 for a picture); W is released: NO keyup comes; Cmd goes up.
  const g = game();
  g.key("keydown", "w");
  g.key("keydown", "Meta", true);
  assert.equal(g.keys.size, 0, "Cmd down lets the held keys go");
  g.key("keyup", "Meta");
  assert.equal(g.keys.size, 0);
  // A key that goes down while Cmd is down is the browser's shortcut: it is never held.
  g.key("keydown", "Meta", true);
  g.key("keydown", "d", true);
  assert.equal(g.keys.size, 0, "Cmd+D is not a walk");
  g.key("keyup", "Meta");
  assert.equal(g.keys.size, 0);
  // After Cmd, a plain key walks again.
  g.key("keydown", "a");
  assert.deepEqual([...g.keys], ["a"]);
  assert.ok(swallowsKeyup({ key: "OS" }) && swallowsKeyup({ metaKey: true }) && !swallowsKeyup({ key: "w", metaKey: false }));
});

test("the listeners go away with the game", () => {
  const g = game();
  g.off();
  g.key("keydown", "w");
  g.win.dispatchEvent(new Event("blur"));
  assert.deepEqual([...g.keys], ["w"], "after off, a blur clears nothing here");
});

/** A window and a document that keep their listeners, so a test can call them with an event that is trusted (a page's own blur). */
function leaving(hasFocus: boolean) {
  const handlers = new Map<string, (e: Event) => void>();
  const win = { addEventListener: (t: string, f: (e: Event) => void) => void handlers.set(`win:${t}`, f), removeEventListener: (t: string) => void handlers.delete(`win:${t}`) };
  const doc = { hidden: false, hasFocus: () => hasFocus, addEventListener: (t: string, f: (e: Event) => void) => void handlers.set(`doc:${t}`, f), removeEventListener: (t: string) => void handlers.delete(`doc:${t}`) };
  return { handlers, win, doc };
}

test("pauseWhenLeft: a hidden tab and a real blur pause; a script's blur, a focus inside the page and a tab that comes back do not", () => {
  const w = leaving(false);
  let paused = 0;
  const off = pauseWhenLeft(() => paused++, w.win, w.doc);
  // A real blur: the window lost the focus to another window.
  w.handlers.get("win:blur")!({ isTrusted: true } as Event);
  assert.equal(paused, 1, "a real blur pauses");
  // A script's blur (a dialog that lets go of held keys) is no leaving.
  w.handlers.get("win:blur")!({ isTrusted: false } as Event);
  assert.equal(paused, 1, "a script's blur does not pause");
  // A blur while the document still has the focus (the focus moved into a frame or a field of the page): no leaving.
  const inside = leaving(true);
  let n = 0;
  pauseWhenLeft(() => n++, inside.win, inside.doc);
  inside.handlers.get("win:blur")!({ isTrusted: true } as Event);
  assert.equal(n, 0, "a focus inside the page does not pause");
  // A hidden tab pauses; a tab that comes back does not (the player taps Resume).
  w.doc.hidden = true;
  w.handlers.get("doc:visibilitychange")!(new Event("visibilitychange"));
  assert.equal(paused, 2, "a hidden tab pauses");
  w.doc.hidden = false;
  w.handlers.get("doc:visibilitychange")!(new Event("visibilitychange"));
  assert.equal(paused, 2, "a tab that comes back does not start anything");
  off();
  assert.equal(w.handlers.size, 0, "the listeners go away");
});
