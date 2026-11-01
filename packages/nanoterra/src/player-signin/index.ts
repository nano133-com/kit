// "@nano133/nanoterra/player-signin": the PLAYER sign-in of a game, in one path: a passkey (the passkey purse: a Nano account made in the browser
// from the player's passkey) and the three wallet apps (Berry Wallet, NanChat, Nautilus). No password, no email, no payment, and the server holds no
// key: every way is a signature, checked by @nano133/signin (an optional peer: install it with this package).
//
//   createPlayerSignin          the routes (start, check, the wallets' answers, the passkey, sign-out), sessions, `player(request)` for the shop
//                               and the friends list, `forget(player)` for "Delete my data"
//   createMemoryPlayerSignin    a store in memory, for tests
//   checkScheme, schemeVector   the game's frozen passkey scheme, and its fixed vectors
//   (the adapters are "/player-signin/d1" (with its SQL, "/player-signin/d1.sql") and "/player-signin/firestore", the conformance suite
//   "/player-signin/conformance", the browser sheet "/player-signin/panel" and its "/player-signin/style.css")

export { EXAMPLE_ADDRESS, cookieHeader, createPlayerSignin, sha256Hex } from "./handler.js";
export type { PlayerSignin, PlayerSigninOptions } from "./handler.js";
export { createMemoryPlayerSignin } from "./memory.js";
export type { MemoryPlayerSignin } from "./memory.js";
export { checkScheme, schemeVector } from "./scheme.js";
export { PASSKEY_PREVIEW_NOTE, previewHost } from "./host.js";
export type { PasskeyScheme } from "./scheme.js";
export { PLAYER_SIGNIN_LIMITS, SESSION_DAYS, STARTER_MAX_AGE_S, VIAS, WAYS, viaOf } from "./types.js";
export type { PlayerSession, PlayerSigninStore, RequestStoreLike, SessionRecord, SigninRequest, Via, Way } from "./types.js";
