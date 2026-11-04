// The player's emote settings, for the options menu ("@nano133/nanoterra/options"): two toggles under "Emotes" and the wheel's key under "Keys". Add them
// to the game's store and the menu shows them (an open panel draws them at once). The wheel and the player read them from a store that is passed; with no
// store (or a store without them) both toggles are on and the key is B.
//
//   const options = createOptions({ game: "my-game", defs: [...myDefs, ...EMOTE_OPTIONS] });
//   // or later: options.add(optionSection("emotes", EMOTE_OPTION_DEFS, "Emotes")), and options.add([EMOTE_KEY_OPTION])
//   mountEmotes(el, { game: "my-game", onPlay, options });
//   playRemote(other, { id }, { options });
//
// Only the options module's TYPES are imported (from its store's own file): this path loads none of its code.

import type { KeyDef, OptionsStore, ToggleDef } from "../options/core.js";

/**
 * The help line of "Show the Emotes key": it names the wheel's key as the player has it ("G still opens the wheel on a keyboard" in a game whose key is
 * G), through the options' "{key:...}" words; with no "keys.emotes" binding in the store it says B, the wheel's own default.
 */
export const EMOTE_SHOW_HELP = "{key:keys.emotes|KeyB} still opens the wheel on a keyboard";

/** The two toggles with their short keys, for `optionSection("emotes", EMOTE_OPTION_DEFS, "Emotes")` (the keys become "emotes.show" and "emotes.others"). */
export const EMOTE_OPTION_DEFS: readonly ToggleDef[] = [
  { kind: "toggle", key: "show", label: "Show the Emotes key", help: EMOTE_SHOW_HELP, tab: "basic", default: true },
  { kind: "toggle", key: "others", label: "Show other players' emotes", tab: "advanced", default: true },
];

/** The wheel's key on a keyboard ("keys.emotes", B; shown on a desktop only): what `keyBinding("emotes", "Emotes wheel", "KeyB")` makes. */
export const EMOTE_KEY_OPTION: KeyDef = { kind: "key", key: "keys.emotes", label: "Emotes wheel", tab: "advanced", group: "Keys", default: "KeyB", devices: ["desktop"] };

/** Every emote setting with its whole key, ready for `createOptions({ defs })` or `store.add(...)`: "emotes.show", "emotes.others" and "keys.emotes". */
export const EMOTE_OPTIONS: readonly (ToggleDef | KeyDef)[] = [...EMOTE_OPTION_DEFS.map((d) => ({ ...d, key: `emotes.${d.key}`, group: "Emotes" })), EMOTE_KEY_OPTION];

/** What the emotes read of an options store: `get` and, to follow a change, `subscribe`. The options module's `OptionsStore` is one. */
export type EmoteOptionsStore = Pick<OptionsStore, "get"> & Partial<Pick<OptionsStore, "subscribe">>;

export type EmoteSettings = { show: boolean; others: boolean; key: string };

/** A key's words on the Emotes key's cap: "KeyG" is "G", "Digit5" is "5", a few named keys by their sign; any other code as it is. (The options' own
 *  `keyLabel` says more, but this path loads no options code.) */
export function emoteKeyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^(Digit|Numpad)\d$/.test(code)) return code.slice(-1);
  const named: Record<string, string> = { Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Space: "Space", Tab: "Tab" };
  return named[code] ?? code;
}

/** The settings from a store: a store that is missing or a key it does not have (it throws) reads on, and B. */
export function readEmoteOptions(store: EmoteOptionsStore | null | undefined): EmoteSettings {
  const read = (key: string): unknown => {
    if (!store) return undefined;
    try {
      return store.get(key);
    } catch {
      return undefined;
    }
  };
  const key = read(EMOTE_KEY_OPTION.key);
  return { show: read("emotes.show") !== false, others: read("emotes.others") !== false, key: typeof key === "string" && key ? key : "KeyB" };
}
