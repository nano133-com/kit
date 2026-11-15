// "@nano133/nanoterra/connect": Sign in from Nanoterra (the code exchange of nano133.com) for a game with a server. A player who is signed in at
// nano133.com presses Play and arrives at the game signed in: the game's start route keeps a state in a `__Host-` cookie and sends the browser to
// nano133.com; the callback checks the state, trades the code with the client secret from the server, and shows "Sign in as <name>?" (or, for a press
// on Play a moment ago, signs the player in at once, or asks "Switch to <name>?"). The game starter's reviewed code, moved into the package with every
// check, for a Worker ("./worker") and for Node ("./node"). The rules are held by a conformance suite that a game runs on its own routes
// ("./conformance").
//
//   createConnect            the four routes on Web Request/Response (start, callback, confirm, cancel, and `handle` for all four)
//   createMemoryOnce         a "works once" store in memory, for tests
//   (the Worker's adapter is "/connect/worker", Node's "/connect/node"; the "works once" stores "/connect/d1" and "/connect/firestore"; the suite
//   "/connect/conformance"; the screens' stylesheet "/connect/style.css")

export {
  ANSWER_MAX,
  AUTHORIZE_PATH,
  CALLBACK_LIMIT,
  CONNECT_PATHS,
  NANOTERRA_SITE,
  ONCE_WINDOW_MS,
  PENDING_COOKIE,
  PENDING_SECONDS,
  STATE_COOKIE,
  STATE_SECONDS,
  TOKEN_PATH,
  afterPath,
  bindOf,
  consoleLog,
  createConnect,
  exchangeCode,
  localDev,
  newState,
  ownOrigin,
  packedOf,
  pendingToken,
  pressOf,
  readCookie,
  readPending,
  readPlayer,
  setCookie,
  setupOf,
  siteOf,
  visitorIp,
} from "./core.js";
export type { Connect, ConnectHow, ConnectLog, ConnectOnce, ConnectOptions, ConnectScope, ConnectSession, ConnectSetup, Exchanged, Look, PackedRecord, Pending, Player } from "./core.js";
export { CONNECT_CSP, CONNECT_ERRORS, CONNECT_WORDS, escapeHtml, shortAddress } from "./screens.js";
export type { ConnectErrorKey, ConnectErrorWords, ConnectScreen, ConnectScreens, ConnectWords } from "./screens.js";
export { createMemoryOnce } from "./memory.js";
export type { MemoryOnce } from "./memory.js";
