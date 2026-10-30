---
name: add-friends-list
description: Add a friends list to a Nanoterra game with @nano133/nanoterra/friends - the player's Nanoterra friends in a nano133 window, or a full friends list of the game's own players on the game's own D1 or Firestore database, chosen by the admin's Game card. Use when the user asks for friends, a friends list, invites or online friends in a game made with the Nanoterra kit or the game starter.
---

# Add a friends list

Follow step 9 of the package's `ai/SPEC.md` (https://nano133.com/build/nanoterra, or
`node_modules/@nano133/nanoterra/ai/SPEC.md`) and the README section "The friends list".

1. **Ask** which list the game starts with: Nanoterra's (the default), the game's own, or none.
   It is the admin's `friends` setting; read it with `loadGameSettings` on the server.
2. Mount the key when the game starts: `mountFriends(el, { mode, game })`, with the stylesheet
   `@nano133/nanoterra/friends/style.css`. Never `display: none` it; `destroy()` only at the end.
3. Call `setWhere(text)` when the player moves. It is plain text and friends see it.
4. The game's own list: add `createFriendsHandler({ store, directory, player })` at `/friends`,
   with `createD1Friends` (add `friends/d1.sql` to the migrations) or `createFirestoreFriends`.
   `player(req)` is the PLAYER sign-in, never the admin's.
5. Call `store.forget(player)` from the game's "Delete my data".
6. A store of your own passes `friendsStoreConformance` before it is used.
7. Test with two players in two browsers: add, accept, online with a place, invite, block.

Never send a player id to the browser. Finish with the SPEC's step 9 check.
