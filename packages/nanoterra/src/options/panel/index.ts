// "@nano133/nanoterra/options/panel": the Options key and panel of a game, drawn in the browser. Plain DOM, no framework, no Three.js.
//
//   import { createOptions, common } from "@nano133/nanoterra/options";
//   import { mountOptions } from "@nano133/nanoterra/options/panel";
//   import "@nano133/nanoterra/options/style.css";
//   const options = createOptions({ game: "my-game", defs: [...common("masterVolume", "musicVolume", "quality"), myOwnDef] });
//   const panel = mountOptions(document.getElementById("options")!, options);
//
// The store (../core.ts) has no DOM: a game with its own menu reads, writes and hears it without this panel.

export { choiceDisplay, MORE_WORDS, mountOptions, PRESS_A_KEY, rangeText, RESET_QUESTION, TAB_WORDS } from "./mount.js";
export type { MountedOptions, OptionsMountOptions } from "./mount.js";
