// "@nano133/nanoterra/emotes/wheel": the Emotes key and the emote wheel of a game, drawn in the browser. Plain DOM, no framework, no Three.js.
//
//   import { mountEmotes } from "@nano133/nanoterra/emotes/wheel";
//   import "@nano133/nanoterra/emotes/style.css";
//   const wheel = mountEmotes(document.getElementById("emotes")!, { game: "my-game", onPlay: (id) => emotes.play(id), onOpen: () => void loadEmotes() });
//
// With the game's own animations: `emotes: [{ id: "flip", label: "Flip", icon: "/emotes/flip.png" }, ...]` and an `onPlay` that plays them.

export { EMOTE_THEME_VARS, SLIDE_PX, mountEmotes, placeAt } from "./mount.js";
export type { EmotesMountOptions, MountedEmotes, OwnEmote, WheelEmote } from "./mount.js";
export { EMOTE_ICONS_URL } from "../icons.js";
