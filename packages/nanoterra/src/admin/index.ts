// "@nano133/nanoterra/admin": the admin of a game, in the package. No Three.js, no database, no cookie: the game gives a session and a store.
//
//   adminAccess            the guard: one pure function, who may open /admin
//   createAdminHandler     the routes, on Request and Response
//   loadGameSettings       the two switches for the game's own routes
//   createMemoryStore      a store in memory, for tests
//   (the conformance suite is its own path: "@nano133/nanoterra/admin/conformance")

export { ADMIN_SESSION_MS, CLOCK_SKEW_MS, OWNER_PATTERN, adminAccess } from "./guard.js";
export type { AdminAccess, AdminAccessInput, AdminRefusal, AdminSession } from "./guard.js";
export { ADMIN_LIMITS, createAdminHandler, loadGameSettings } from "./handler.js";
export type { AdminHandler, AdminHandlerOptions, AdminRoute } from "./handler.js";
export { createMemoryStore } from "./memory.js";
export type { MemoryStore } from "./memory.js";
export type { AdminOrder, AdminPlayer, AdminStatus, AdminStore, AdminSummary, Money, OrderStatus, StoreSummary } from "./store.js";
export { CHARACTER_NEEDS_SIGNIN, CHARACTER_SIGNIN_OFF, REVIEW_LINK, REVIEW_NOTE, SWITCHES, isCharacter, isSignin, isSigninChoice, mergeSettings, parsePatch, pressOf, signinOn, stateOf } from "./switches.js";
export type { Character, GamePatch, GameSettings, GameState, Signin, SwitchId } from "./switches.js";
