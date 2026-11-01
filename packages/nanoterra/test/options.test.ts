// The options store (no DOM): defaults for each device, only the differences kept, bad kept values dropped, a refused storage, add() and the key that is
// there twice, subscribe, the key bindings' swap, and reduced motion followed live.
import assert from "node:assert/strict";
import test from "node:test";
import { common, createOptions, keyBinding, optionsKey, optionSection, type OptionDef, type OptionsInit } from "../src/options/index.js";

/** A Storage in memory, with a switch that makes it refuse. */
function memory(start: Record<string, string> = {}) {
  const data = new Map(Object.entries(start));
  let refuse = false;
  return {
    data,
    refuse(on: boolean) {
      refuse = on;
    },
    getItem(k: string) {
      if (refuse) throw new Error("SecurityError");
      return data.has(k) ? data.get(k)! : null;
    },
    setItem(k: string, v: string) {
      if (refuse) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem(k: string) {
      if (refuse) throw new Error("SecurityError");
      data.delete(k);
    },
  };
}
const KEY = optionsKey("g");
const kept = (s: ReturnType<typeof memory>) => (s.data.has(KEY) ? JSON.parse(s.data.get(KEY)!) : null);

const DEFS: OptionDef[] = [
  { kind: "range", key: "music", label: "Music", tab: "basic", group: "Sound", min: 0, max: 100, step: 5, unit: "%", default: 100 },
  { kind: "toggle", key: "shadows", label: "Shadows", tab: "advanced", default: { phone: false, default: true } },
  { kind: "choice", key: "quality", label: "Quality", tab: "advanced", choices: [{ value: "low", label: "Low" }, { value: "high", label: "High" }], default: { phone: "low", tablet: "low", default: "high" } },
  { kind: "choice", key: "fps", label: "Frame rate", tab: "advanced", choices: [{ value: 0, label: "Screen" }, { value: 30, label: "30" }], default: 0 },
];
const make = (over: Partial<OptionsInit> = {}) => createOptions({ game: "g", defs: DEFS, device: () => "desktop", reducedMotion: () => false, storage: null, ...over });

test("defaults for each device class: the class's own value, else default; reducedMotion wins when the device asks for less motion", () => {
  assert.deepEqual(make({ device: () => "desktop" }).values(), { music: 100, shadows: true, quality: "high", fps: 0 });
  assert.deepEqual(make({ device: () => "phone" }).values(), { music: 100, shadows: false, quality: "low", fps: 0 });
  assert.equal(make({ device: () => "tablet" }).get("quality"), "low");
  assert.equal(make({ device: () => "tablet" }).get("shadows"), true);
  const calm = createOptions({ game: "g", defs: common("reducedMotion"), storage: null, device: () => "desktop", reducedMotion: () => true });
  assert.equal(calm.get("reducedMotion"), true);
  assert.equal(createOptions({ game: "g", defs: common("reducedMotion"), storage: null, reducedMotion: () => false }).get("reducedMotion"), false);
  // A detection that throws, or gives a word that is not a class, is a desktop.
  assert.equal(make({ device: () => { throw new Error("x"); } }).device, "desktop");
  assert.equal(make({ device: () => "watch" as never }).device, "desktop");
});

test("only the differences are kept, under n133-options:<game>; a value set back to its default leaves the kept object, and an empty one is removed", () => {
  const s = memory();
  const o = make({ storage: s });
  assert.equal(kept(s), null, "nothing is written for defaults");
  o.set("music", 40);
  o.set("shadows", true); // the default on a desktop
  assert.deepEqual(kept(s), { music: 40 });
  o.set("quality", "low");
  assert.deepEqual(kept(s), { music: 40, quality: "low" });
  o.set("music", 100);
  assert.deepEqual(kept(s), { quality: "low" });
  o.reset();
  assert.equal(s.data.has(KEY), false);
  // A later, better default reaches a player who never touched it: the same storage, a new default.
  s.data.set(KEY, JSON.stringify({ music: 40 }));
  const later = createOptions({ game: "g", defs: DEFS.map((d) => (d.key === "fps" ? { ...d, default: 30 } : d)), device: () => "desktop", reducedMotion: () => false, storage: s });
  assert.equal(later.get("fps"), 30);
  assert.equal(later.get("music"), 40);
});

test("a range is put on its nearest step inside min and max; a bad value throws and changes nothing", () => {
  const o = make();
  o.set("music", 42);
  assert.equal(o.get("music"), 40);
  o.set("music", 250);
  assert.equal(o.get("music"), 100);
  o.set("music", -3);
  assert.equal(o.get("music"), 0);
  for (const [k, v] of [["music", Number.NaN], ["music", "50"], ["shadows", 1], ["quality", "ultra"], ["fps", "30"], ["nope", 1]] as const) assert.throws(() => o.set(k, v as never), TypeError, `${k} = ${String(v)}`);
  assert.equal(o.get("music"), 0);
  assert.throws(() => o.get("nope"), TypeError);
  const fine = createOptions({ game: "g", storage: null, defs: [{ kind: "range", key: "speed", label: "Speed", tab: "basic", min: 0.5, max: 2, step: 0.1, default: 1 }] });
  fine.set("speed", 1.26);
  assert.equal(fine.get("speed"), 1.3);
});

test("kept values that do not fit are dropped on read: the wrong type, out of range, an unknown choice, an unknown key, broken JSON", () => {
  const s = memory({ [KEY]: JSON.stringify({ music: "loud", shadows: "yes", quality: "ultra", fps: 30, gone: true, "emotes.show": false, "bad key!": 1 }) });
  const o = make({ storage: s });
  assert.deepEqual(o.values(), { music: 100, shadows: true, quality: "high", fps: 30 });
  // The read writes the cleaner object back; a dotted key waits for its section.
  assert.deepEqual(kept(s), { fps: 30, "emotes.show": false });
  assert.deepEqual(make({ storage: memory({ [KEY]: JSON.stringify({ music: 101 }) }) }).get("music"), 100, "out of range");
  assert.deepEqual(make({ storage: memory({ [KEY]: JSON.stringify({ music: 43 }) }) }).get("music"), 45, "in range: put on its step");
  for (const raw of ["{not json", "[1,2]", "null", "42", '"text"']) assert.deepEqual(make({ storage: memory({ [KEY]: raw }) }).values(), make().values(), raw);
});

test("a refused storage works in memory: no throw on read or write, and the values hold for the page", () => {
  const s = memory({ [KEY]: JSON.stringify({ music: 40 }) });
  s.refuse(true);
  const o = make({ storage: s });
  assert.equal(o.get("music"), 100, "nothing could be read");
  o.set("music", 60);
  assert.equal(o.get("music"), 60);
  o.reset("music");
  assert.equal(o.get("music"), 100);
  const none = make({ storage: null });
  none.set("quality", "low");
  assert.equal(none.get("quality"), "low");
});

test("add() takes a module's section later: its kept values are read then; a key that is there twice throws at once and adds nothing", () => {
  const s = memory({ [KEY]: JSON.stringify({ "emotes.show": false, "emotes.wheel": "huge" }) });
  const o = make({ storage: s });
  o.set("music", 50); // a write before the section comes keeps the section's waiting value
  assert.deepEqual(kept(s), { "emotes.show": false, "emotes.wheel": "huge", music: 50 });
  let drawn = 0;
  o.subscribeDefs(() => drawn++);
  const emotes = optionSection(
    "emotes",
    [
      { kind: "toggle", key: "show", label: "Show emotes", tab: "basic", default: true },
      { kind: "choice", key: "wheel", label: "Wheel size", tab: "advanced", choices: [{ value: "small", label: "Small" }, { value: "big", label: "Big" }], default: "big" },
    ],
    "Emotes",
  );
  assert.deepEqual(emotes.map((d) => [d.key, d.group]), [["emotes.show", "Emotes"], ["emotes.wheel", "Emotes"]]);
  o.add(emotes);
  assert.equal(drawn, 1);
  assert.equal(o.get("emotes.show"), false, "the kept choice is read when the section comes");
  assert.equal(o.get("emotes.wheel"), "big", "a kept value that does not fit is dropped then");
  assert.deepEqual(o.defs().map((d) => d.key), ["music", "shadows", "quality", "fps", "emotes.show", "emotes.wheel"]);
  // Twice: in the same list, against the store, and in createOptions. Nothing of a refused list is added.
  assert.throws(() => o.add([{ kind: "toggle", key: "emotes.show", label: "Again", tab: "basic", default: true }]), /"emotes.show" is there twice/);
  assert.throws(() => o.add([{ kind: "toggle", key: "a.b", label: "A", tab: "basic", default: true }, { kind: "toggle", key: "a.b", label: "B", tab: "basic", default: true }]), /twice/);
  assert.throws(() => o.add([{ kind: "toggle", key: "a.c", label: "C", tab: "basic", default: true }, { kind: "toggle", key: "music", label: "M", tab: "basic", default: true }]), /"music" is there twice/);
  assert.equal(o.def("a.c"), undefined, "a refused list adds nothing");
  assert.throws(() => createOptions({ game: "g", storage: null, defs: [...common("musicVolume"), ...common("musicVolume")] }), /twice/);
  // A bad def throws at once with what is wrong.
  assert.throws(() => make({ defs: [{ kind: "range", key: "x", label: "X", tab: "basic", min: 0, max: 10, step: 1, default: 11 }] }), /does not fit/);
  assert.throws(() => make({ defs: [{ kind: "choice", key: "x", label: "X", tab: "basic", choices: [{ value: "a", label: "A" }], default: "a" }] }), /two choices/);
  assert.throws(() => make({ defs: [{ kind: "toggle", key: "x y", label: "X", tab: "basic", default: true }] }), /the key must be/);
  assert.throws(() => make({ defs: [{ kind: "toggle", key: "x", label: "X", tab: "basic", default: { phone: true } as never }] }), /needs "default"/);
  assert.throws(() => make({ defs: [{ kind: "toggle", key: "x", label: "X", tab: "middle" as never, default: true }] }), /tab must be/);
});

test("subscribe hears each real change (set, reset, a swap), once, with the new value; the call it returns stops it", () => {
  const o = make();
  const heard: [string, unknown][] = [];
  const stop = o.subscribe((k, v) => heard.push([k, v]));
  o.set("music", 50);
  o.set("music", 50); // no change: nothing heard
  o.set("quality", "low");
  o.reset();
  assert.deepEqual(heard, [["music", 50], ["quality", "low"], ["music", 100], ["quality", "high"]]);
  stop();
  o.set("music", 10);
  assert.equal(heard.length, 4);
});

test("key bindings: a KeyboardEvent.code; a key another binding has swaps with it, so two actions never share a key", () => {
  const s = memory();
  const o = createOptions({ game: "g", storage: s, device: () => "desktop", defs: [keyBinding("jump", "Jump", "Space"), keyBinding("dig", "Dig", "KeyE")] });
  assert.equal(o.def("keys.jump")?.tab, "advanced");
  const heard: [string, unknown][] = [];
  o.subscribe((k, v) => heard.push([k, v]));
  o.set("keys.dig", "Space");
  assert.equal(o.get("keys.dig"), "Space");
  assert.equal(o.get("keys.jump"), "KeyE");
  assert.deepEqual(heard, [["keys.jump", "KeyE"], ["keys.dig", "Space"]]);
  assert.deepEqual(kept(s), { "keys.jump": "KeyE", "keys.dig": "Space" });
  assert.throws(() => o.set("keys.jump", "not a code!"), TypeError);
  o.reset();
  assert.deepEqual(o.values(), { "keys.jump": "Space", "keys.dig": "KeyE" });
});

test("reduced motion is followed live: a player who never set it follows the device; a player's own choice stays", () => {
  let calm = false;
  const o = createOptions({ game: "g", storage: null, device: () => "desktop", reducedMotion: () => calm, defs: [...common("reducedMotion"), { kind: "toggle", key: "shake", label: "Shake", tab: "advanced", default: { default: true, reducedMotion: false } }] });
  const heard: [string, unknown][] = [];
  o.subscribe((k, v) => heard.push([k, v]));
  calm = true;
  o.redetect();
  assert.deepEqual(o.values(), { reducedMotion: true, shake: false });
  assert.deepEqual(heard, [["reducedMotion", true], ["shake", false]]);
  o.set("shake", true); // the player's own choice
  calm = false;
  o.redetect();
  assert.deepEqual(o.values(), { reducedMotion: false, shake: true });
  assert.equal(o.isDefault("shake"), true, "a choice that now equals the default follows the default again");
});

test("migrate reads a game's old save once, and what it returns is checked like any kept value", () => {
  const s = memory({ "my-game.settings": JSON.stringify({ music: 35, quality: "ultra" }) });
  const o = make({
    storage: s,
    migrate: (stored, st) => {
      if (Object.keys(stored).length) return stored;
      const old = st?.getItem("my-game.settings");
      st?.removeItem("my-game.settings");
      return old ? JSON.parse(old) : null;
    },
  });
  assert.equal(o.get("music"), 35);
  assert.equal(o.get("quality"), "high");
  assert.deepEqual(kept(s), { music: 35 });
  assert.equal(s.data.has("my-game.settings"), false);
  assert.equal(make({ storage: memory({ [KEY]: JSON.stringify({ music: 20 }) }), migrate: () => { throw new Error("bad"); } }).get("music"), 20, "a migration that throws reads what was kept");
});

test("the common settings: each a valid def, opted into by key, and a copy the game may change", () => {
  const all = common("masterVolume", "musicVolume", "effectsVolume", "cameraSensitivity", "invertLook", "stickSide", "reducedMotion", "quality", "showFps");
  const o = createOptions({ game: "g", storage: null, device: () => "phone", reducedMotion: () => false, defs: all });
  assert.deepEqual(o.values(), { masterVolume: 100, musicVolume: 100, effectsVolume: 100, cameraSensitivity: 50, invertLook: false, stickSide: "left", reducedMotion: false, quality: "medium", showFps: false });
  const mine = common("quality")[0];
  (mine as { label: string }).label = "Detail";
  assert.equal(common("quality")[0].label, "Quality");
  assert.throws(() => common("colourBlind" as never), /not a common setting/);
});
