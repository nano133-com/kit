// The player's two emote settings, for the options menu ("@nano133/nanoterra/options"): add them to the game's store and the menu shows them under
// "Emotes". The wheel and the player read them from a store that is passed; with no store (or a store without them) everything is on.
//
//   const options = createOptions({ game: "my-game", defs: [...myDefs, ...EMOTE_OPTIONS] });
//   mountEmotes(el, { game: "my-game", onPlay, options });
//   playRemote(other, { id }, { options });
//
// The def's shape is the options module's toggle (`ToggleDef`, kind "toggle"), written here so this path does not load the options code.

/** A toggle of the options menu, as "@nano133/nanoterra/options" defines it (`ToggleDef`). */
export type EmoteOptionDef = { kind: "toggle"; key: string; label: string; help?: string; tab: "basic" | "advanced"; group?: string; default: boolean };

export const EMOTE_OPTIONS: readonly EmoteOptionDef[] = [
  { kind: "toggle", key: "emotes.show", label: "Show the Emotes key", help: "B still opens the wheel on a keyboard", tab: "basic", group: "Emotes", default: true },
  { kind: "toggle", key: "emotes.others", label: "Show other players' emotes", tab: "advanced", group: "Emotes", default: true },
];

/** What the emotes read of an options store: `get` and, to follow a change, `subscribe`. The options module's `OptionsStore` fits. */
export type EmoteOptionsStore = {
  get(key: string): unknown;
  subscribe?(fn: (key: string, value: unknown) => void): () => void;
};

export type EmoteSettings = { show: boolean; others: boolean };

/** The two settings from a store: a store that is missing, a key it does not have (it throws) or a value that is not false reads on. */
export function readEmoteOptions(store: EmoteOptionsStore | null | undefined): EmoteSettings {
  const on = (key: string) => {
    if (!store) return true;
    try {
      return store.get(key) !== false;
    } catch {
      return true;
    }
  };
  return { show: on("emotes.show"), others: on("emotes.others") };
}
