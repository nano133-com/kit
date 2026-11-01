// "@nano133/nanoterra/emotes": Nanoterra's emotes for a game, the part with no DOM and no Three.js: the list, the wheel's eight places, the
// multiplayer messages and the options. The other paths:
//
//   "@nano133/nanoterra/emotes/player"     the clips on the kit's character (Three.js); they load on the first emote
//   "@nano133/nanoterra/emotes/wheel"      the Emotes key and the wheel (plain DOM), with "@nano133/nanoterra/emotes/style.css"
//
// A game with its own animations uses the wheel alone: its own list and its own `onPlay`.

export { EMOTES, emoteOf, isClip, isEmote, isLoop } from "./list.js";
export type { ClipId, EmoteId, EmoteKind } from "./list.js";
export { DEFAULT_WHEEL, WHEEL_FULL, WHEEL_SLOTS, createWheel, defaultWheel, readWheel, toggleSlot, wheelKey } from "./wheel.js";
export type { Slots, Wheel, WheelOptions } from "./wheel.js";
export { LOOP_AGAIN_MS, emoteMessage, readEmoteMessage } from "./events.js";
export type { EmoteEvent, EmoteMessage, EmoteStop } from "./events.js";
export { EMOTE_KEY_OPTION, EMOTE_OPTIONS, EMOTE_OPTION_DEFS, readEmoteOptions } from "./options.js";
export type { EmoteOptionsStore, EmoteSettings } from "./options.js";
