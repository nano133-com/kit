// "@nano133/nanoterra/admin-signin": the ADMIN's sign-in of a game (/admin), on ONE fixed route, "/api/admin-signin", in every game. Berry Wallet or
// Nautilus signs a text that names the ADMIN; NanChat is off unless the game turns it on (its text cannot name the admin); no passkey. The game starter's
// admin sign-in, moved into the package with every check and every signed text unchanged. The checks are @nano133/signin's (an optional peer: install it
// with this package).
//
//   createAdminSignin          the routes (start, the wallets' answers, check, sign-out), `session(request)` for `createAdminHandler`, `signOutEverywhere`,
//                              `recentLogins` and `clean`
//   createMemoryAdminSignin    a store in memory, for tests
//   (the adapters are "/admin-signin/d1" (on the starter's own tables; a new game adds "/admin-signin/d1.sql") and "/admin-signin/firestore", the store's
//   conformance suite "/admin-signin/conformance", the browser panel "/admin-signin/panel" and its stylesheet "/admin-signin/style.css")

export { EXAMPLE_ADDRESS, adminKey, createAdminSignin } from "./handler.js";
export type { AdminSignin, AdminSigninOptions } from "./handler.js";
export { createMemoryAdminSignin } from "./memory.js";
export type { MemoryAdminSignin } from "./memory.js";
export { countryOf, shortBrowser } from "./browser.js";
export {
  ADMIN_DELIVER_MS,
  ADMIN_LOGIN_KEEP_MS,
  ADMIN_PAGE,
  ADMIN_REQUEST_MS,
  ADMIN_SIGNIN_BASE,
  ADMIN_SIGNIN_LIMITS,
  ADMIN_STARTER_MAX_AGE_S,
  ADMIN_WAYS,
  NANCHAT_REFUSAL,
} from "./types.js";
export type { AdminSessionRecord, AdminSigninSession, AdminSigninStore, AdminWay, RequestStoreLike, SigninRequest } from "./types.js";
export { ADMIN_SESSION_MS } from "../admin/guard.js";
