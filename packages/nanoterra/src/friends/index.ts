// "@nano133/nanoterra/friends": the friends list of a game's OWN players (the setting "The game's own" of the admin's Game card). No database, no
// cookie, no Nanoterra account: the game gives its store, its directory of players and its signed-in player.
//
//   createFriendsHandler   the routes (GET the view, POST an op), on Request and Response
//   createMemoryFriends    a store in memory, for tests
//   (the adapters are "/friends/d1" and "/friends/firestore", the conformance suite "/friends/conformance", the browser panel "/friends/panel")
//
// Nanoterra's own friends list (the setting "Nanoterra") is not here: the panel holds the nano133 window for it, and the friends stay on nano133.

export { FRIEND_INVITE_MS, FRIEND_LIMIT, FRIEND_LIVE_MS, FRIEND_REQUEST_MS, FRIEND_WHERE_MAX, FriendsError } from "./types.js";
export type { FriendRow, FriendState, FriendView, FriendsStore, PlayerDirectory } from "./types.js";
export { FRIENDS_LIMITS, createFriendsHandler } from "./handler.js";
export type { FriendsHandlerOptions, FriendsOp } from "./handler.js";
export { createMemoryFriends } from "./memory.js";
export type { MemoryFriends } from "./memory.js";
export { EDGE_PATTERN, LEASE_PATTERN, cleanWhere } from "./rules.js";
export type { EdgeRec, PresenceRec } from "./rules.js";
