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
import { placeAt } from "../src/emotes/panel/mount.js";

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
  assert.deepEqual(readEmoteOptions(null), { show: true, others: true, key: "KeyB" });
  assert.deepEqual(readEmoteOptions({ get: () => { throw new Error("no such key"); } }), { show: true, others: true, key: "KeyB" });
  const off = { get: <T,>(k: string) => (k === "emotes.others" ? false : k === "keys.emotes" ? "KeyE" : true) as T };
  assert.deepEqual(readEmoteOptions(off), { show: true, others: false, key: "KeyE" });
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

test("the Wave is the character's own wave, and is sent like any emote", () => {
  const c = createCharacter();
  const b = bonesOf(c);
  const sent: string[] = [];
  const e = createEmotes(c, { onEmote: (x) => sent.push(x.id) });
  assert.equal(e.play("wave"), true);
  run(c, 0.3);
  assert.ok(b.upperarm_L.rotation.z > 2, "the left arm is up");
  assert.equal(e.playing, null, "the Wave is not a clip");
  assert.equal(e.play("moonwalk"), false);
  assert.deepEqual(sent, ["wave"]);
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
