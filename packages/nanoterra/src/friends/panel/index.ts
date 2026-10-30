// "@nano133/nanoterra/friends/panel": the Friends key and panel of a game, drawn in the browser. Plain DOM, no framework, no Three.js.
//
//   import { mountFriends } from "@nano133/nanoterra/friends/panel";
//   import "@nano133/nanoterra/friends/style.css";
//   const friends = mountFriends(document.getElementById("friends")!, { mode: settings.friends, game: "my-game" });
//   friends.setWhere("Level 2");
//
// The server part is "@nano133/nanoterra/friends" (the handler and the stores): it must not load this one.

export { FRIENDS_TIMING, mountFriends } from "./mount.js";
export type { FriendsMode, FriendsMountOptions, MountedFriends } from "./mount.js";
export { WINDOW_PREFIX, WINDOW_V, readWindowMessage, whereText, windowUrl } from "./window.js";
export type { FromWindow, ToWindow } from "./window.js";
