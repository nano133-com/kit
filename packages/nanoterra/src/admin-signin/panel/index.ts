// "@nano133/nanoterra/admin-signin/panel": the ADMIN's sign-in in the browser, for the admin page. `adminSignIn()` fits `mountAdmin`'s `signIn(into, done)`
// and `adminSignOut()` its `signOut`; `adminSigninView` is the content alone; `ownerPasskeys()` is the "Owner passkeys" card for `mountAdmin`'s `cards`
// (since 0.12.0). Add "@nano133/nanoterra/admin-signin/style.css" to the page (the player sheet's stylesheet: the two sign-ins look the same). No Three.js;
// the passkey code (@nano133/signin/passkey and /purse) is loaded only when a passkey is used; the server part is "@nano133/nanoterra/admin-signin".

export { ADMIN_NANCHAT_NOTE, ADMIN_SIGNIN_INTRO, adminSignIn, adminSignOut, adminSigninView } from "./view.js";
export { ownerPasskeys, passkeyAdminSignIn, passkeyFaultText } from "./passkeys.js";
export type { AdminPasskeyOptions, PasskeyList } from "./passkeys.js";
export type { AdminCard } from "../../admin/panel/card.js";
export type { AdminSigninView, AdminSigninViewOptions } from "./view.js";
export { ADMIN_SIGNIN_BASE } from "../types.js";
