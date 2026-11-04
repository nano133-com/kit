// "@nano133/nanoterra/admin": the admin of a game, in the package. No Three.js, no database, no cookie: the game gives a session and a store.
//
//   adminAccess            the guard: one pure function, who may open /admin
//   createAdminHandler     the routes, on Request and Response
//   loadGameSettings       the game switches for the game's own routes (and loadLegal: the Legal card's settings, for the shop)
//   createMemoryStore      a store in memory, for tests
//   (the conformance suite is its own path: "@nano133/nanoterra/admin/conformance"; the adapters are "/admin/d1" and "/admin/firestore")

export { ADMIN_SESSION_MS, CLOCK_SKEW_MS, OWNER_PATTERN, adminAccess } from "./guard.js";
export type { AdminAccess, AdminAccessInput, AdminRefusal, AdminSession } from "./guard.js";
export { ADMIN_LIMITS, createAdminHandler, loadGameSettings, loadLegal } from "./handler.js";
export type { AdminHandler, AdminHandlerOptions, AdminRoute } from "./handler.js";
export { createMemoryStore } from "./memory.js";
export type { MemoryStore } from "./memory.js";
export { ADMIN_LOGINS_SHOWN, SETTING_KEYS, settingRows } from "./store.js";
export type { SettingName, StoredSettings } from "./store.js";
export { DEFAULT_LEGAL, DEFAULT_REFUND_WORDS, LIFE_USES, refundText } from "./legal.js";
export { REFUND_DAYS_MAX, REFUND_WORDS_MAX, isRefundDays, isRefundWords, mergeLegal, parseLegalKey } from "./legalRules.js";
export type { LegalPatch, LegalState } from "./legal.js";
export type { AdminLogin, AdminOrder, AdminPlayer, AdminStatus, AdminStore, AdminSummary, Money, OrderStatus, PlayStats, SendBack, StoreSummary, SummaryOptions } from "./store.js";
export { ORDERS_SHOWN, addPlays, moneyOf, parseRate, playsSummary, shapeOrders, shapePlayers, statusOf, summarize, withReady } from "./summary.js";
export type { CreditRow, OrderRow } from "./summary.js";
export { RAW_PER_XNO, xnoText } from "./amount.js";
export { CHARACTER_NEEDS_SIGNIN, CHARACTER_SIGNIN_OFF, DEFAULT_EMOTES, DEFAULT_FREE_PLAY, DEFAULT_FRIENDS, FREE_PLAY_NOTE, FRIENDS_CHOICES, FRIENDS_TITLE, REVIEW_LINK, REVIEW_NOTE, SWITCHES, freePlayOn, isCharacter, isEmotes, isFreePlay, isFriends, isSignin, isSigninChoice, mergeSettings, parsePatch, pressOf, signinOn, stateOf } from "./switches.js";
export type { Character, Emotes, FreePlay, Friends, GamePatch, GameSettings, GameState, Signin, SwitchId } from "./switches.js";
