// The emotes: the clips fit the kit's skeleton and the list, the wheel's eight places, a remote player's emote (an unknown id is ignored), and the
// clip player's rules on the real character (a move stops a full clip, an upper clip plays over the walk, a loop goes on and is sent again).
import assert from "node:assert/strict";
import test, { before } from "node:test";
import * as THREE from "three";
import { Window } from "happy-dom";
import { BONES, createCharacter, type Character, type Motion } from "../src/character/index.js";
import CLIPS from "../src/emotes/clips.js";
import { createOptions, keyBinding, optionSection } from "../src/options/index.js";
import { DEFAULT_WHEEL, EMOTES, EMOTE_KEY_OPTION, EMOTE_OPTIONS, EMOTE_OPTION_DEFS, WHEEL_FULL, createWheel, defaultWheel, emoteMessage, isClip, readEmoteMessage, readEmoteOptions, readWheel, toggleSlot, wheelKey } from "../src/emotes/index.js";
import { createEmotes, emoteClip, FADE_STOP, loadEmotes, playRemote, stopEmote } from "../src/emotes/player.js";
import { WAVE_SECONDS } from "../src/character/pose.js";
import { EMOTE_THEME_VARS, placeAt } from "../src/emotes/panel/mount.js";

const DT = 1 / 60;
const bonesOf = (c: Character) => {
  const b: Record<string, THREE.Bone> = {};
  c.object.traverse((o) => {
    if ((o as THREE.Bone).isBone) b[o.name] = o as THREE.Bone;
  });
  return b;
};
const pose = (c: Character) => Object.values(bonesOf(c)).flatMap((b) => [...b.position.toArray(), ...b.quaternion.toArray()]);
const apart = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const run = (c: Character, seconds: number, m: Motion = {}) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) c.update(DT, m);
};
/** A storage in memory, and one that refuses every call. */
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), map: m };
};
const refused = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

before(async () => {
  await loadEmotes();
});

// ---- the clips and the list ----

test("the clips are made on the kit's own skeleton: the same 28 bone names in the same order, and every clip's bones are among them", () => {
  assert.deepEqual(CLIPS.bones, BONES.map((b) => b[0]));
  assert.equal(CLIPS.v, 1);
  assert.equal(CLIPS.fps, 30);
  for (const [id, c] of Object.entries(CLIPS.clips)) {
    for (const [bone, ...vals] of c.q) {
      assert.ok(bone >= 0 && bone < 28, `${id}: bone ${bone}`);
      assert.ok(vals.length === 4 || vals.length === 4 * c.n, `${id}: ${CLIPS.bones[bone]} has ${vals.length} numbers for ${c.n} frames`);
    }
    if (c.p) assert.ok(c.p.length === 3 || c.p.length === 3 * c.n, `${id}: the hips' place`);
  }
});

test("the list and the clips agree: ten clips, the Wave is the character's own, each clip's kind and loop are the list's", () => {
  assert.deepEqual(Object.keys(CLIPS.clips).sort(), EMOTES.filter((e) => e.id !== "wave").map((e) => e.id).sort());
  assert.equal(EMOTES.length, 11);
  for (const e of EMOTES) {
    if (e.id === "wave") continue;
    const c = CLIPS.clips[e.id];
    assert.equal(c.kind, e.kind, e.id);
    assert.equal(c.loop, e.loop, e.id);
    assert.equal(c.label, e.label, e.id);
  }
  // The upper clips move the spine, the arms and the head only: never the hips or the legs.
  for (const id of ["clap", "shrug", "point", "facepalm"]) {
    const bones = CLIPS.clips[id].q.map(([b]) => CLIPS.bones[b]);
    assert.ok(!bones.some((b) => /^(root|hips|thigh|shin|foot)/.test(b)), `${id}: ${bones.join(", ")}`);
    assert.equal(CLIPS.clips[id].p, undefined);
  }
});

// ---- the wheel ----

test("the wheel: eight places, each emote once; a broken or odd kept wheel is the default", () => {
  const ids = EMOTES.map((e) => e.id);
  assert.equal(DEFAULT_WHEEL.length, 8);
  assert.deepEqual(defaultWheel(ids), DEFAULT_WHEEL);
  assert.deepEqual(readWheel(null, ids, DEFAULT_WHEEL), DEFAULT_WHEEL);
  assert.deepEqual(readWheel("not json", ids, DEFAULT_WHEEL), DEFAULT_WHEEL);
  assert.deepEqual(readWheel("[1,2]", ids, DEFAULT_WHEEL), DEFAULT_WHEEL);
  // A repeat and an unknown id become empty places.
  assert.deepEqual(readWheel(JSON.stringify(["wave", "wave", "moonwalk", null, 3, "bow", "sit", "spin"]), ids, DEFAULT_WHEEL), ["wave", null, null, null, null, "bow", "sit", "spin"]);
  // A game's own list: its defaults, or its first eight.
  assert.deepEqual(defaultWheel(["a", "b"]), ["a", "b", null, null, null, null, null, null]);
  assert.deepEqual(defaultWheel(["a", "b", "c"], ["c", "c", "x"]), ["c", null, null, null, null, null, null, null]);
});

test("the wheel: a ninth emote is refused (full); taking one off frees its place, and the next goes in the first empty place", () => {
  let r = toggleSlot(DEFAULT_WHEEL, "bow");
  assert.equal(r.did, "full");
  assert.equal(r.slots, DEFAULT_WHEEL);
  r = toggleSlot(DEFAULT_WHEEL, "clap");
  assert.equal(r.did, "removed");
  assert.equal(r.slots[2], null);
  r = toggleSlot(r.slots, "bow");
  assert.deepEqual(r, { slots: ["wave", "cheer", "bow", "dance", "laugh", "point", "sit", "spin"], did: "added" });
  assert.equal(WHEEL_FULL, "Your wheel is full. Take one off first.");
});

test("the wheel is kept per game and read back; a refused storage works for the page", () => {
  const store = memory();
  const a = createWheel({ game: "gem-island", storage: store });
  assert.deepEqual(a.slots, DEFAULT_WHEEL);
  const heard: unknown[] = [];
  a.subscribe((s) => heard.push(s));
  a.clear(0);
  assert.equal(a.toggle("facepalm"), "added");
  assert.equal(a.toggle("bow"), "full");
  assert.deepEqual(JSON.parse(store.map.get(wheelKey("gem-island"))!), ["facepalm", "cheer", "clap", "dance", "laugh", "point", "sit", "spin"]);
  assert.equal(heard.length, 2);
  // Read back on the next visit; another game has its own.
  assert.deepEqual(createWheel({ game: "gem-island", storage: store }).slots, a.slots);
  assert.deepEqual(createWheel({ game: "other", storage: store }).slots, DEFAULT_WHEEL);
  assert.equal(wheelKey("gem-island"), "n133-emotes:gem-island");
  // Refused: the default, and changes hold for the page.
  const r = createWheel({ game: "gem-island", storage: refused });
  assert.deepEqual(r.slots, DEFAULT_WHEEL);
  r.clear(7);
  assert.equal(r.toggle("bow"), "added");
  assert.equal(r.slots[7], "bow");
  // A game's own emotes.
  const own = createWheel({ game: "mine", ids: ["flip", "wave"], storage: memory() });
  assert.deepEqual(own.slots, ["wave", null, null, null, null, null, null, null]);
});

test("the place under a finger: by its angle from the middle, slot 1 at the top and on clockwise; none in the middle disc", () => {
  const rect = { left: 0, top: 0, width: 400, height: 400 };
  assert.equal(placeAt(rect, 200, 10), 0);
  assert.equal(placeAt(rect, 390, 200), 2);
  assert.equal(placeAt(rect, 200, 390), 4);
  assert.equal(placeAt(rect, 10, 200), 6);
  assert.equal(placeAt(rect, 340, 60), 1);
  assert.equal(placeAt(rect, 30, 40), 7);
  assert.equal(placeAt(rect, 220, 210), null);
  assert.equal(placeAt(null, 1, 1), null);
});

// ---- the network ----

test("a remote player's emote: an unknown id, a number or a bad message is ignored; the same play twice is one; the Wave is the character's wave", () => {
  const c = createCharacter();
  for (const id of ["moonwalk", 7, null, "", "WAVE", "__proto__"]) assert.equal(playRemote(c, { id }), false, String(id));
  assert.equal(playRemote(c, null as never), false);
  const rest = pose(c);
  run(c, 0.5);
  assert.ok(apart(pose(c), rest) < 1e-9, "nothing played");
  assert.equal(playRemote(c, { id: "cheer", at: 1000 }), true);
  assert.equal(playRemote(c, { id: "cheer", at: 1000 }), false, "the same play again");
  assert.equal(playRemote(c, { id: "wave", at: 2000 }), true);
  // The message: the id alone, read back; anything else is null.
  assert.deepEqual(emoteMessage({ id: "dance" }), { emote: "dance" });
  assert.equal(readEmoteMessage({ emote: "dance" }), "dance");
  for (const m of [null, "dance", {}, { emote: 3 }, { emote: "" }, { emote: "x".repeat(41) }]) assert.equal(readEmoteMessage(m), null);
  c.dispose();
});

test("the options: with no store, or a store without the keys, everything is on; emotes.others off ignores the others' emotes", () => {
  assert.deepEqual(readEmoteOptions(null), { show: true, others: true, key: "KeyB", calm: false });
  assert.deepEqual(readEmoteOptions({ get: () => { throw new Error("no such key"); } }), { show: true, others: true, key: "KeyB", calm: false });
  const off = { get: <T,>(k: string) => (k === "emotes.others" ? false : k === "keys.emotes" ? "KeyE" : true) as T };
  assert.deepEqual(readEmoteOptions(off), { show: true, others: false, key: "KeyE", calm: true });
  const c = createCharacter();
  assert.equal(playRemote(c, { id: "dance" }, { options: off }), false);
  assert.deepEqual(EMOTE_OPTIONS.map((d) => [d.key, d.kind, d.tab, d.default]), [["emotes.show", "toggle", "basic", true], ["emotes.others", "toggle", "advanced", true], ["keys.emotes", "key", "advanced", "KeyB"]]);
  // The real options store takes them, either way the README gives, and the wheel's key is the options' own keyBinding.
  const store = createOptions({ game: "g", storage: null, defs: [...EMOTE_OPTIONS] });
  assert.equal(store.get("emotes.show"), true);
  store.set("emotes.others", false);
  assert.equal(readEmoteOptions(store).others, false);
  const later = createOptions({ game: "g", storage: null, defs: [] });
  later.add(optionSection("emotes", EMOTE_OPTION_DEFS, "Emotes"));
  later.add([EMOTE_KEY_OPTION]);
  assert.deepEqual(later.defs().map((d) => d.key), ["emotes.show", "emotes.others", "keys.emotes"]);
  assert.deepEqual(EMOTE_KEY_OPTION, keyBinding("emotes", "Emotes wheel", "KeyB"));
  c.dispose();
});

// ---- the clip player, on the real character ----

test("a clip blends over the pose and plays its frames; reduced motion holds its one picture", () => {
  const c = createCharacter();
  const b = bonesOf(c);
  run(c, 0.3);
  const idle = pose(c);
  const e = createEmotes(c);
  assert.equal(e.play("cheer"), true);
  assert.equal(e.playing, "cheer");
  run(c, 0.5);
  assert.ok(apart(pose(c), idle) > 0.1, "the cheer moves the body");
  const mid = b.upperarm_L.quaternion.clone();
  run(c, 0.2);
  assert.ok(b.upperarm_L.quaternion.angleTo(mid) > 1e-3, "and goes on moving");
  // With reduced motion: the hold frame, still.
  const calm = createCharacter({ reducedMotion: true });
  const cb = bonesOf(calm);
  createEmotes(calm).play("cheer");
  run(calm, 0.5);
  const a = cb.upperarm_L.quaternion.clone();
  run(calm, 0.3);
  assert.ok(cb.upperarm_L.quaternion.angleTo(a) < 1e-6, "the hold frame does not move");
  c.dispose();
  calm.dispose();
});

test("a full clip stops with its fade when the character walks; an upper clip plays over the walk and ends by itself", () => {
  const c = createCharacter();
  const stops: unknown[] = [];
  const e = createEmotes(c, { onStop: (s) => stops.push(s.why) });
  e.play("dance");
  run(c, 0.5);
  // A walk: the eased speed passes 0.4 m/s within a few frames, then the fade (0.18 s) ends it.
  run(c, 0.1 + FADE_STOP + 0.05, { speed: 3.75 });
  assert.equal(e.playing, null);
  assert.deepEqual(stops, ["move"]);
  // A jump stops it too.
  e.play("cheer");
  run(c, 0.2);
  run(c, FADE_STOP + 0.05, { airborne: true, verticalSpeed: 3 });
  assert.equal(e.playing, null);
  assert.deepEqual(stops, ["move", "move"]);
  // An upper clip goes on through the walk, to its end.
  e.play("clap");
  run(c, 0.5, { speed: 3.75 });
  assert.equal(e.playing, "clap");
  run(c, emoteClip("clap")!.seconds, { speed: 3.75 });
  assert.equal(e.playing, null);
  assert.deepEqual(stops, ["move", "move", "end"]);
  // stop(): with its fade, and its own reason.
  e.play("point");
  run(c, 0.3);
  e.stop();
  run(c, FADE_STOP + 0.05);
  assert.deepEqual(stops, ["move", "move", "end", "stop"]);
  c.dispose();
});

test("a loop plays until a move, is sent again every 10 s, and a repeat of it does not start it again; Sit's opening plays once", () => {
  const c = createCharacter();
  const sent: { id: string; again: boolean }[] = [];
  const e = createEmotes(c, { onEmote: (x) => sent.push({ id: x.id, again: x.again }) });
  e.play("dance");
  run(c, 25);
  assert.equal(e.playing, "dance");
  assert.deepEqual(sent, [{ id: "dance", again: false }, { id: "dance", again: true }, { id: "dance", again: true }]);
  // A remote repeat of a loop on show does not start it again (the body is where it was, not at the first frame).
  const other = createCharacter();
  playRemote(other, { id: "dance", at: 1 });
  run(other, 0.7);
  const before = pose(other);
  playRemote(other, { id: "dance", at: 2 });
  other.update(DT);
  const fresh = createCharacter();
  playRemote(fresh, { id: "dance", at: 3 });
  fresh.update(DT);
  assert.ok(apart(pose(other), before) < apart(pose(fresh), before), "the repeat went on from where it was");
  // Sit: past its frames it goes on in its seated part (the hips stay low).
  const s = createCharacter();
  const sb = bonesOf(s);
  createEmotes(s).play("sit");
  run(s, 6);
  const low = sb.hips.position.y;
  assert.ok(low < 0.6, `seated: the hips at ${low}`);
  run(s, 2.3);
  assert.ok(Math.abs(sb.hips.position.y - low) < 0.15, "still seated");
  // A move ends it.
  run(s, 0.5, { speed: 2 });
  assert.ok(sb.hips.position.y > 0.65, "standing again");
  stopEmote(other);
  for (const x of [c, other, fresh, s]) x.dispose();
});

test("the Wave is the character's own wave, is sent like any emote, and is `playing` for its 1.8 s", () => {
  const c = createCharacter();
  const b = bonesOf(c);
  const sent: string[] = [];
  const e = createEmotes(c, { onEmote: (x) => sent.push(x.id) });
  assert.equal(e.playing, null);
  assert.equal(e.play("wave"), true);
  assert.equal(e.playing, "wave", "a game (or a test) sees the Wave play");
  run(c, 0.3);
  assert.ok(b.upperarm_L.rotation.z > 2, "the left arm is up");
  assert.equal(e.playing, "wave");
  run(c, WAVE_SECONDS);
  assert.ok(b.upperarm_L.rotation.z < 2, "the arm is down again");
  assert.equal(e.playing, null, "and the Wave is over");
  // A clip over a Wave: the clip is what plays.
  e.play("wave");
  e.play("cheer");
  assert.equal(e.playing, "cheer");
  assert.equal(e.play("moonwalk"), false);
  assert.deepEqual(sent, ["wave", "wave", "cheer"]);
  assert.ok(isClip("dance") && !isClip("wave"));
  c.dispose();
});

// ---- the wheel's panel, in a fake DOM (the look is checked in pictures) ----

test("the panel: Nanoterra's emotes off leaves only the game's own; nothing left draws nothing; Edit says when the wheel is full", async () => {
  const win = new Window({ url: "https://game.example" });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
  const { mountEmotes } = await import("../src/emotes/panel/index.js");
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as never);
  const none = mountEmotes(root, { game: "g", onPlay() {}, nanoterraEmotes: "off", storage: null });
  assert.equal(root.childElementCount, 0);
  none.destroy();
  const played: string[] = [];
  const own = mountEmotes(root, { game: "g", onPlay: (id) => played.push(id), nanoterraEmotes: "off", emotes: ["wave", { id: "flip", label: "Flip" }], storage: null });
  assert.deepEqual(own.slots, ["flip", null, null, null, null, null, null, null]);
  own.open();
  (root.querySelector('.n133e-slot[data-slot="0"]') as HTMLButtonElement).click();
  assert.deepEqual(played, ["flip"]);
  assert.equal(own.isOpen, false);
  own.destroy();
  const nano = mountEmotes(root, { game: "g", onPlay: (id) => played.push(id), storage: null });
  nano.open();
  (root.querySelector(".n133e-edit") as HTMLButtonElement).click();
  (root.querySelector('[data-emote="bow"]') as HTMLButtonElement).click();
  assert.equal(root.querySelector(".n133e-list-line")!.textContent, WHEEL_FULL);
  // The keyboard: Escape closes, B opens, 2 plays the second place.
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", code: "Escape" }));
  assert.equal(nano.isOpen, false);
  assert.ok(!root.contains(win.document.activeElement as never), "a closed wheel leaves no focus on its key: Space goes to the game");
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "b", code: "KeyB" }));
  assert.equal(nano.isOpen, true);
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "2", code: "Digit2" }));
  assert.equal(nano.isOpen, false);
  assert.deepEqual(played, ["flip", "cheer"]);
  nano.destroy();
  // The player's own key from the options ("keys.emotes"), and "Show the Emotes key" off hides the key, live.
  const store = createOptions({ game: "g", storage: null, defs: [...EMOTE_OPTIONS] });
  store.set("keys.emotes", "KeyE");
  const keyed = mountEmotes(root, { game: "g", onPlay() {}, storage: null, options: store });
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "b", code: "KeyB" }));
  assert.equal(keyed.isOpen, false);
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "e", code: "KeyE" }));
  assert.equal(keyed.isOpen, true);
  assert.equal((root.querySelector(".n133e-key") as HTMLElement).hidden, false);
  store.set("emotes.show", false);
  assert.equal((root.querySelector(".n133e-key") as HTMLElement).hidden, true);
  keyed.destroy();
  assert.equal(root.childElementCount, 0);
});

test("the Emotes key: a key cap names the player's own key and follows a change; no cap without keyCap or without keys; the help line names the key", async () => {
  const win = new Window({ url: "https://game.example" });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
  const { mountEmotes } = await import("../src/emotes/panel/index.js");
  const { mountOptions } = await import("../src/options/index.js");
  const { EMOTE_SHOW_HELP, emoteKeyLabel } = await import("../src/emotes/index.js");
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as never);
  const cap = () => root.querySelector(".n133e-cap");
  const plain = mountEmotes(root, { game: "g", onPlay() {}, storage: null });
  assert.equal(cap(), null, "no cap by default");
  plain.destroy();
  const noKeys = mountEmotes(root, { game: "g", onPlay() {}, storage: null, keys: false, keyCap: true });
  assert.equal(cap(), null, "no cap when the keyboard does not open the wheel");
  noKeys.destroy();
  const b = mountEmotes(root, { game: "g", onPlay() {}, storage: null, keyCap: true });
  assert.equal(cap()!.textContent, "B");
  assert.equal(cap()!.getAttribute("aria-hidden"), "true", "the key's name stays Emotes; aria-keyshortcuts names the key");
  b.destroy();
  // A game whose wheel is on G (Echo Island), and the player moves it to H.
  const store = createOptions({ game: "g", storage: null, defs: [...EMOTE_OPTION_DEFS.map((d) => ({ ...d, key: `emotes.${d.key}`, group: "Emotes" })), keyBinding("emotes", "Emotes wheel", "KeyG")] });
  const g = mountEmotes(root, { game: "g", onPlay() {}, storage: null, options: store, keyCap: true });
  assert.equal(cap()!.textContent, "G");
  store.set("keys.emotes", "KeyH");
  assert.equal(cap()!.textContent, "H");
  g.destroy();
  assert.equal(emoteKeyLabel("Digit5"), "5");
  assert.equal(emoteKeyLabel("Backquote"), "`");
  // The options panel's line under "Show the Emotes key" names the same key, not B.
  assert.ok(EMOTE_OPTION_DEFS[0].help === EMOTE_SHOW_HELP && !/^B /.test(EMOTE_SHOW_HELP));
  const holder = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(holder as never);
  const panel = mountOptions(holder, store);
  panel.open();
  assert.equal(holder.querySelector('[data-key="emotes.show"] .n133o-help')!.textContent, "H still opens the wheel on a keyboard");
  panel.destroy();
  const bStore = createOptions({ game: "g3", storage: null, defs: [...EMOTE_OPTIONS] });
  const bPanel = mountOptions(holder, bStore);
  bPanel.open();
  assert.equal(holder.querySelector('[data-key="emotes.show"] .n133o-help')!.textContent, "B still opens the wheel on a keyboard");
  bPanel.destroy();
});

test("the Emotes key's stylesheet: the key reads --n133e-key-* (edge, edge colour, radius, shadow, font, weight) with today's look as the default, and never sets them itself", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/emotes/panel/style.css", import.meta.url), "utf8");
  const keyRule = css.match(/\.n133-emotes \.n133e-key \{([^}]*)\}/)![1];
  for (const [prop, fallback] of [["edge", "1px"], ["edge-color", "var(--line)"], ["radius", "999px"], ["shadow", "none"], ["font", "var(--font)"], ["weight", "650"]]) {
    assert.ok(keyRule.includes(`var(--n133e-key-${prop}, ${fallback})`), `the key reads --n133e-key-${prop} (default ${fallback})`);
  }
  // A value on the holder or a parent must win whichever stylesheet loads last: the kit never declares these properties.
  assert.equal(/--n133e-key-[a-z-]+\s*:/.test(css), false);
});

test("the wheel in another element (layerIn: document.body): out of the game's boxes, with the holder's theme, and gone with destroy", async () => {
  const win = new Window({ url: "https://game.example" });
  // happy-dom does not inherit custom properties: the holder's computed value stands in (a real browser's inheritance is checked in pictures).
  const was = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent, getComputedStyle: () => ({ getPropertyValue: (n: string) => (n === "--n133-gem" ? " #ff7a00" : "") }) });
  const { mountEmotes } = await import("../src/emotes/panel/index.js");
  const slot = win.document.createElement("div") as unknown as HTMLElement;
  slot.style.setProperty("--n133-gem", "#ff7a00");
  win.document.body.append(slot as never);
  const played: string[] = [];
  const m = mountEmotes(slot, { game: "g", onPlay: (id) => played.push(id), storage: null, layerIn: win.document.body as unknown as HTMLElement, theme: "dark" });
  const layer = win.document.querySelector(".n133e-layer") as unknown as HTMLElement;
  assert.ok(slot.querySelector(".n133e-key"), "the key stays in the game's slot");
  assert.equal(slot.contains(layer), false, "the wheel is not inside the slot");
  const portal = layer.parentElement!;
  assert.ok(portal.classList.contains("n133-emotes") && portal.classList.contains("n133e-portal") && portal.parentElement === (win.document.body as unknown), "its own .n133-emotes in the body");
  assert.equal(portal.getAttribute("data-theme"), "dark", "the theme's word reaches it");
  m.open();
  assert.equal(portal.style.getPropertyValue("--n133-gem"), "#ff7a00", "the holder's theme values are copied when it opens");
  (layer.querySelector('.n133e-slot[data-slot="1"]') as HTMLButtonElement).click();
  assert.deepEqual(played, ["cheer"]);
  assert.equal(m.isOpen, false);
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "b", code: "KeyB" }));
  assert.equal(m.isOpen, true, "the keyboard still opens it");
  m.destroy();
  assert.equal(win.document.querySelector(".n133e-layer"), null, "destroy takes the wheel out of the body too");
  assert.equal(slot.childElementCount, 0);
  // Every theme value the stylesheet reads is in the copied list, and nothing else.
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/emotes/panel/style.css", import.meta.url), "utf8");
  const read = [...new Set([...css.matchAll(/var\((--n133-[a-z-]+)/g)].map((x) => x[1]))].sort();
  assert.deepEqual([...EMOTE_THEME_VARS].sort(), read);
  assert.match(css, /\.n133-emotes\.n133e-portal \{\s*display: contents;/, "the portal draws no box of its own");
  Object.assign(globalThis, { getComputedStyle: was });
});

test("the options' Less motion (reducedMotion) stops the wheel's pop-in, as the device's setting does, and follows a change", async () => {
  const win = new Window({ url: "https://game.example" });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
  const { mountEmotes } = await import("../src/emotes/panel/index.js");
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as never);
  const { common } = await import("../src/options/index.js");
  const store = createOptions({ game: "g", storage: null, defs: [...EMOTE_OPTIONS, ...common("reducedMotion")], reducedMotion: () => false });
  const m = mountEmotes(root, { game: "g", onPlay() {}, storage: null, options: store });
  const wrap = root.querySelector(".n133-emotes")!;
  assert.equal(wrap.hasAttribute("data-calm"), false);
  store.set("reducedMotion", true);
  assert.equal(wrap.hasAttribute("data-calm"), true, "Less motion on: no pop-in");
  store.set("reducedMotion", false);
  assert.equal(wrap.hasAttribute("data-calm"), false);
  m.destroy();
  assert.equal(readEmoteOptions(null).calm, false);
  // The pop-in rule: only with the device's no-preference AND no data-calm.
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/emotes/panel/style.css", import.meta.url), "utf8");
  const block = css.match(/@media \(prefers-reduced-motion: no-preference\) \{([^}]*)\{([^}]*)\}/)!;
  assert.match(block[1], /\.n133-emotes:not\(\[data-calm\]\) \.n133e-wheel/);
  assert.match(block[2], /animation: n133e-in/);
  assert.equal((css.match(/animation:/g) ?? []).length, 1, "the pop-in is the wheel's only animation");
});

test("the wheel's sizes: places 76 px or more and tiles 78 px or more on every screen, both grow to the longest name (capped), and the ring keeps eight places apart", async () => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile(new URL("../src/emotes/panel/style.css", import.meta.url), "utf8");
  const slots = [...css.matchAll(/--slot: ([^;]+);/g)].map((x) => x[1]);
  assert.equal(slots.length, 3, "the wheel, a low screen, and Edit");
  for (const v of slots) {
    const floor = /^max\(clamp\((\d+)px, [\d.]+vmin, \d+px\), min\(96px, var\(--n133e-fit, 0px\), calc\(\(100vmin - 20px\) \/ 3\.62\)\)\)$/.exec(v);
    assert.ok(floor && Number(floor[1]) >= 76, `a place: ${v}`);
  }
  const rs = [...css.matchAll(/--r: ([^;]+);/g)].map((x) => x[1]);
  assert.equal(rs.length, 3);
  // Eight places on a ring of radius r are 2 r sin(22.5°) = 0.765 r apart: r >= 1.31 places keeps them apart.
  for (const v of rs) assert.match(v, /, calc\(var\(--slot\) \* 1\.31 \+ \d+px\)\)$/);
  assert.match(css, /--tile: max\(78px, min\(92px, var\(--n133e-tile-fit, 0px\)\)\);/);
  for (const m of css.matchAll(/\.n133e-tile \{([^}]*)\}/g)) {
    const w = /width: ([^;]+);/.exec(m[1]);
    if (w) assert.equal(w[1], "var(--tile)");
  }
  for (const m of css.matchAll(/grid-template-columns: repeat\(\d, ([^)]+\)?)\)/g)) assert.equal(m[1], "var(--tile)");
  assert.match(css, /\.n133-emotes \.n133e-name \{\s*max-width: 96%;/);
  // The fit is measured in the layout (offsetWidth, not a box the pop-in scales), and a fake page with no layout keeps the floors.
  const src = await readFile(new URL("../src/emotes/panel/mount.ts", import.meta.url), "utf8");
  assert.match(src, /probe\.offsetWidth/);
  assert.match(src, /"--n133e-fit", \(w, sides\) => w \/ 0\.96 \+ sides\)/);
  assert.match(src, /"--n133e-tile-fit", \(w, sides\) => w \+ sides\)/);
});

test("the key cap says the key as the Keys settings do (↑, Num 1), and a game's own keyLabel wins; a fault in it gives the kit's words", async () => {
  const win = new Window({ url: "https://game.example" });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent });
  const { mountEmotes } = await import("../src/emotes/panel/index.js");
  const { keyLabel } = await import("../src/options/index.js");
  const { emoteKeyLabel } = await import("../src/emotes/index.js");
  for (const code of ["KeyG", "Digit5", "Numpad1", "ArrowUp", "ArrowLeft", "Backquote", "ShiftLeft", "Space", "F5"]) assert.equal(emoteKeyLabel(code), keyLabel(code), code);
  const root = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(root as never);
  const cap = () => root.querySelector(".n133e-cap")!.textContent;
  const store = createOptions({ game: "g", storage: null, defs: [...EMOTE_OPTION_DEFS.map((d) => ({ ...d, key: `emotes.${d.key}`, group: "Emotes" })), keyBinding("emotes", "Emotes wheel", "ArrowUp")] });
  const m = mountEmotes(root, { game: "g", onPlay() {}, storage: null, options: store, keyCap: true });
  assert.equal(cap(), "↑", "not ArrowUp");
  store.set("keys.emotes", "Numpad1");
  assert.equal(cap(), "Num 1", "not 1");
  m.destroy();
  const own = mountEmotes(root, { game: "g", onPlay() {}, storage: null, options: store, keyCap: true, keyLabel: (code) => (code === "Numpad1" ? "Pad 1" : "") });
  assert.equal(cap(), "Pad 1", "the game's words");
  store.set("keys.emotes", "ArrowUp");
  assert.equal(cap(), "↑", "an empty answer gives the kit's words");
  own.destroy();
  const broken = mountEmotes(root, { game: "g", onPlay() {}, storage: null, options: store, keyCap: true, keyLabel: () => { throw new Error("no"); } });
  assert.equal(cap(), "↑", "a fault in the game's keyLabel gives the kit's words");
  broken.destroy();
});

test("the wheel's fit reads each box's own padding and edges: a game's 3 px tile edge makes the tile 4 px wider than the kit's 1 px", async () => {
  const win = new Window({ url: "https://game.example" });
  const was = (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
  // happy-dom has no layout: a name is 75 px wide, and the boxes' sides come from a stand-in computed style.
  let tileEdge = "1px";
  const sides = (el: Element) =>
    el.classList.contains("n133e-tile") ? { paddingLeft: "2px", paddingRight: "2px", borderLeftWidth: tileEdge, borderRightWidth: tileEdge }
    : el.classList.contains("n133e-slot") ? { paddingLeft: "0px", paddingRight: "0px", borderLeftWidth: "1px", borderRightWidth: "1px" }
    : {};
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent, getComputedStyle: (el: Element) => ({ getPropertyValue: () => "", ...sides(el) }) });
  const proto = win.HTMLElement.prototype as unknown as object;
  const before = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
  Object.defineProperty(proto, "offsetWidth", { configurable: true, get(this: Element) { return this.classList.contains("n133e-name") || this.classList.contains("n133e-tile-name") ? 75 : 0; } });
  try {
    const { mountEmotes } = await import("../src/emotes/panel/index.js");
    const root = win.document.createElement("div") as unknown as HTMLElement;
    win.document.body.append(root as never);
    const fitOf = (prop: string) => (root.querySelector(".n133e-layer") as HTMLElement).style.getPropertyValue(prop);
    for (const [edge, tile] of [["1px", "82px"], ["3px", "86px"]]) {
      tileEdge = edge;
      const m = mountEmotes(root, { game: "g", onPlay() {}, storage: null });
      m.open();
      // A place: (75 + 1) / 0.96 and its 1 px edges, 82 px.
      assert.equal(fitOf("--n133e-fit"), "82px");
      (root.querySelector(".n133e-edit") as HTMLButtonElement).click();
      // A tile: 76 + 2 + 2 of padding + its two edges.
      assert.equal(fitOf("--n133e-tile-fit"), tile, `a ${edge} edge`);
      m.destroy();
    }
  } finally {
    if (before) Object.defineProperty(proto, "offsetWidth", before);
    else delete (proto as { offsetWidth?: unknown }).offsetWidth;
    Object.assign(globalThis, { getComputedStyle: was });
  }
});

test("layerClass names the holder of the open wheel: its own holder with layerIn, else the key's holder", async () => {
  const win = new Window({ url: "https://game.example" });
  Object.assign(globalThis, { document: win.document, window: win, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, KeyboardEvent: win.KeyboardEvent, getComputedStyle: () => ({ getPropertyValue: () => "" }) });
  const { mountEmotes } = await import("../src/emotes/panel/index.js");
  const slot = win.document.createElement("div") as unknown as HTMLElement;
  win.document.body.append(slot as never);
  const out = mountEmotes(slot, { game: "g", onPlay() {}, storage: null, layerIn: win.document.body as unknown as HTMLElement, layerClass: " echo-emotes  echo-hud-layer " });
  const holder = (win.document.querySelector(".n133e-layer") as unknown as HTMLElement).parentElement!;
  assert.ok(holder.classList.contains("n133e-portal") && holder.classList.contains("echo-emotes") && holder.classList.contains("echo-hud-layer"));
  assert.equal(slot.querySelector(".echo-emotes"), null, "the key's holder in the slot has no such class");
  out.destroy();
  const inside = mountEmotes(slot, { game: "g", onPlay() {}, storage: null, layerClass: "echo-emotes" });
  const wrap = slot.querySelector(".n133-emotes") as HTMLElement;
  assert.ok(wrap.classList.contains("echo-emotes") && wrap.contains(slot.querySelector(".n133e-layer")), "with no layerIn the key's holder holds the wheel, and gets the class");
  inside.destroy();
  const none = mountEmotes(slot, { game: "g", onPlay() {}, storage: null });
  assert.equal((slot.querySelector(".n133-emotes") as HTMLElement).className, "n133-emotes", "no class by default");
  none.destroy();
});
