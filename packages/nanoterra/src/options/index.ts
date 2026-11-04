// "@nano133/nanoterra/options": a game's options (settings) as data, with their defaults for each device, kept in this browser; the common settings a game
// opts into; and the ready panel.
//
//   import { createOptions, common, mountOptions } from "@nano133/nanoterra/options";
//   import "@nano133/nanoterra/options/style.css";
//
//   const options = createOptions({
//     game: "my-game",
//     defs: [
//       ...common("masterVolume", "musicVolume", "effectsVolume", "cameraSensitivity", "invertLook", "quality"),
//       { kind: "toggle", key: "hints", label: "Show hints", tab: "basic", group: "Game", default: true },
//     ],
//   });
//   options.get<number>("musicVolume");                         // 0 to 100
//   options.subscribe((key, value) => apply(key, value));       // every change, from the panel or the game
//   mountOptions(document.getElementById("options")!, options);  // the gear key and the panel
//
// reflectOptions(options, ["reducedMotion"]) keeps <html data-n133-opt-reduced-motion="true|false"> for the page's CSS.
// A kit module adds its own section later: `options.add(optionSection("emotes", emoteDefs, "Emotes"))` gives the keys "emotes.<key>".
// The store has no DOM and touches nothing at import. The panel (also on "@nano133/nanoterra/options/panel") builds its elements only when it is mounted.

export {
  createOptions,
  defProblem,
  detectDevice,
  DEVICE_CLASSES,
  keyBinding,
  keyLabel,
  helpKeys,
  helpText,
  optionsKey,
  OPTIONS_PREFIX,
  optionSection,
  prefersReducedMotion,
  resolveDefault,
  snapToRange,
} from "./core.js";
export type { ChoiceDef, ChoiceValue, DeviceClass, DeviceDefault, KeyDef, OptionDef, OptionsInit, OptionsStore, OptionValue, RangeDef, Tab, ToggleDef } from "./core.js";
export { common, COMMON_KEYS, COMMON_OPTIONS } from "./common.js";
export type { CommonKey } from "./common.js";
export { optionAttribute, reflectOptions } from "./reflect.js";
export { mountOptions } from "./panel/mount.js";
export type { MountedOptions, OptionsMountOptions } from "./panel/mount.js";
