// "@nano133/nanoterra/player-signin/panel": the player's sign-in sheet in the browser. `mountPlayerSignin` is the sheet (call `open()`);
// `signInView` is its content, for a game that has a sheet of its own. Add "@nano133/nanoterra/player-signin/style.css" to the page.

export { mountPlayerSignin } from "./mount.js";
export type { MountedPlayerSignin, PlayerSigninMountOptions } from "./mount.js";
export { hostFits, passkeyName, signInView } from "./view.js";
export type { PlayerSigninView, PlayerSigninViewOptions, SignedIn } from "./view.js";
export { faultWords } from "./words.js";
export type { FaultWords } from "./words.js";
export { readMemo } from "./memo.js";
export type { SigninMemo } from "./memo.js";
