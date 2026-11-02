// "@nano133/nanoterra/admin-signin/panel": the ADMIN's sign-in in the browser, for the admin page. `adminSignIn()` fits `mountAdmin`'s `signIn(into, done)`
// and `adminSignOut()` its `signOut`; `adminSigninView` is the content alone. Add "@nano133/nanoterra/admin-signin/style.css" to the page (the player
// sheet's stylesheet: the two sign-ins look the same). No package, no Three.js; the server part is "@nano133/nanoterra/admin-signin".

export { ADMIN_NANCHAT_NOTE, ADMIN_SIGNIN_INTRO, adminSignIn, adminSignOut, adminSigninView } from "./view.js";
export type { AdminSigninView, AdminSigninViewOptions } from "./view.js";
export { ADMIN_SIGNIN_BASE } from "../types.js";
