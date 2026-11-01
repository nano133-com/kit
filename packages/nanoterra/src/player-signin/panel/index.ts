// "@nano133/nanoterra/player-signin/panel": the player's sign-in sheet in the browser. `mountPlayerSignin` is the sheet (call `open()`);
// `signInView` is its content, for a game that has a sheet of its own. Add "@nano133/nanoterra/player-signin/style.css" to the page. Every word of
// the sheet can be the game's own: `words` (PlayerSigninWords; PLAYER_SIGNIN_WORDS are the defaults).

export { mountPlayerSignin } from "./mount.js";
export type { MountedPlayerSignin, PlayerSigninMountOptions } from "./mount.js";
export { hostFits, passkeyName, signInView } from "./view.js";
export { PASSKEY_PREVIEW_NOTE, previewHost } from "../host.js";
export type { PlayerSigninView, PlayerSigninViewOptions, SignedIn } from "./view.js";
export { PLAYER_SIGNIN_WORDS, faultWords, playerSigninWords } from "./words.js";
export type { FaultText, FaultWords, PlayerSigninWords, PlayerSigninWordsOption } from "./words.js";
export { readMemo } from "./memo.js";
export type { SigninMemo } from "./memo.js";
