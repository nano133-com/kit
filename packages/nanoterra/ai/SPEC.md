# Nanoterra for a game: implementation spec

Package: `@nano133/nanoterra` (0.1.0 or later). Follow these steps in order. Each step ends with a check. Ask the owner when a step says
"ask". The package has five parts: the sign-in ticket (`/ticket`), the player's character (`/character`, Three.js), the
looks ladder (`/looks`), held input that does not stick (`/input`), the friends list (`/friends`, with its panel), the options menu (`/options`) and the emotes (`/emotes`, with the wheel). Use only the parts the game needs. It has no network, wallet or Nano code. Read the package README first.

## 0. What the owner decides (ask)

1. Does the game have a server? If yes, sign the player in with the code exchange (the game starter has it) and do **not** use `/ticket`: a ticket cannot prove
   who is at the other end. If no (a static site), use `/ticket`.
2. Where the character comes from: the player's own Nanoterra character (the default), or the game's own character. Keep that choice in **one** place:
   in the game starter it is `"character": "nanoterra" | "own"` in `game.config.json` (nothing else reads it).
3. The quality: `"high"` (toon body and ink outline, 2 draws) or `"low"` (no outline, 1 draw, for slow phones).
4. How the game moves the character: speed in metres a second, gravity and jump. The package animates; it does not move the object.
5. Does the game sell looks? If yes, the game is the seller (its own checkout); see step 7.
6. The friends list (step 9): Nanoterra's (the default), the game's own, or none. It is the admin's `friends` setting; ask which one the game starts with.
7. The options menu (step 10): which settings the game can really honour (a game with no music offers no Music slider), and whether the game opens it from its own
   pause menu or shows the kit's gear key.

**Check:** the owner has named the server (yes or no), the source of the character and the quality.

## 1. Install

```sh
npm install @nano133/nanoterra three
```

`three` is an optional peer (`>=0.174.0`): leave it out for a game that only reads a ticket.

**Check:** `import { createCharacter } from "@nano133/nanoterra/character"` builds and runs.

## 2. The ticket (a static site only)

In `nano-game.json` set `"signin": "ticket"`. Call once, when the page loads:

```ts
import { readTicket } from "@nano133/nanoterra/ticket";
const result = await readTicket();
```

- It takes the ticket out of the address bar first. If `result.ok` is false the player is a guest (`result.reason` is `"none"` for a plain visit).
- Show "Sign in as *name*? Continue / Not me" before you treat the player as that name. Anyone can send a link that holds their own ticket. Put the name in the page as text, never as HTML.
- `result.ticket`: `username`, `address`, `look` (five `#rrggbb` colours), `record` (the whole character, when the ticket has one), `items` (catalogue ids).
- **Never give a sale, a prize or a score on a ticket alone.**

**Check:** a plain visit makes no network call; a ticket for another origin, a changed ticket and an old ticket each give a guest; the address bar has no ticket after the page loaded.

## 3. The scene

- Draw with no tone mapping (the Three.js default). The toon material needs at least one light. The island's look is a
  `HemisphereLight("#d6e9ff", "#e2b98c", 1.8)` and a `DirectionalLight("#fff0c8", 2.75)` from up, front and to one side.
- The character is 2.29 m tall (`HEIGHT`) for the default Classic. Size the game's world to metres, or scale `object` and pass `speed / scale` to `update`.

**Check:** a character added to the scene shows its toon colours and an outline.

## 4. Make the character

```ts
import { createCharacter } from "@nano133/nanoterra/character";
const c = createCharacter({ record: ticket.record, look: ticket.look, quality: "high" }); // a guest: createCharacter()
scene.add(c.object);
```

- `c.object` has its feet at y = 0 and faces +Z. Set `c.object.position` to the player's feet and `c.object.rotation.y = Math.atan2(dx, dz)` for a direction.
- The blob shadow is in the body. It lies on the ground under a jump by itself. There is no `c.shadow`.
- A record that comes from a ticket, a server or a file is data you did not write. `createCharacter` throws a `TypeError` for one that is not whole; check it first
  with `recordProblem(record)` (the reason as a sentence, or `null`) from `@nano133/nanoterra/character/record`. A look: `isLook(look)` or `lookProblem(look)`.
- The body is **display only**. Use the same collider, jump and reach for every base and size: a player's choice of body must never change a rule. For the Classic, `RADIUS` is 0.49 m.

**Check:** the character stands on the ground, faces the way it walks, and its shadow lies under it.

## 5. Drive it

Call once each frame, before the render:

```ts
c.update(dt, { speed, airborne, verticalSpeed });
```

- `dt` is in seconds, not milliseconds. A frame longer than 0.05 s counts as 0.05 s.
- `speed`: metres a second over the ground. 0 is idle, from 0.25 a walk (full swing at 3), from 3.4 to 5 a run. The island walks at 3.75 and runs at 6.5.
- `airborne`: true while off the ground. `verticalSpeed`: metres a second, up is positive; it sizes the shadow in a jump.
- Set `c.reducedMotion = true` when the player asks for less motion. `c.wave()` waves the left arm for 1.8 s.

**Check:** idle, walk, run and jump each look different, on every base. The legs do not slide on the ground at the game's walking speed.

## 6. Change and clean up

- `c.setLook(record)` (or five colours): the same body only repaints; another base or clothes builds new geometry and frees the old.
- `c.setColors({ shirt: "#c8461a" })`: any colour over the record's (a shop dye). `c.setColors(null)` gives the record's own back.
- `c.dispose()` when a character leaves the game: it frees the geometries, materials and textures that it made.

**Check:** after `dispose`, the renderer's `info.memory` counts fall.

## 7. Looks (only if the game sells them)

```ts
import { checkLooks, lookProblems, removalProblems, diffLooks, looksJson } from "@nano133/nanoterra/looks";
export const LOOKS = checkLooks(rawLooksJson); // throws with the first mistake in plain words
```

- Before a change goes live: `[...lookProblems(next), ...removalProblems(current, next, ownedLookIds)]`; show `diffLooks(current, next)`; write the file with `looksJson(next)`.
- One free look (`priceUsd: 0`) at least. Never change or remove the id of a look that someone owns. Prices in US dollars with at most 2 decimals; the server reads the price from the file.
- A look only changes how the character looks. No random look, no loot box, no look that changes a score.
- `slots` (optional, at most 8: a name and a word or a `#rrggbb` colour) is where the game keeps its own parts of a look. Read `look.slots` from `checkLooks`. Never change the slots of a look that someone owns: add a new look.
- `wear` (optional) is the wear slot a look fills: none for an outfit (the character's colours and hat, `change`), or the game's own slot (`"shovel"`, `"charm"`) for an item, which has no `change`. A player wears one look in each slot. Keep one free outfit. Never change the wear slot of a look that someone owns. Read outfits with `isOutfit(look)`.
- The game is the seller. Never send looks, prices or sales to another site.

**Check:** `checkLooks` passes at start; a removed look that is owned is refused; a changed slot or wear slot on an owned look is refused.

## 8. Leaving the page (any game that a player walks in with keys or a stick)

```ts
import { pauseWhenLeft, releaseWhenLost, swallowsKeyup } from "@nano133/nanoterra/input";
```

- A key that is down when the player leaves the page never sends its keyup, so the character walks on by itself on return. Call `releaseWhenLost(release)` once; in `release`
  clear every held key, stick, drag and queued jump. A keydown with `swallowsKeyup(e)` true (Cmd is down) is never held. After a leave the helper drops key repeats until a key goes down again.
- Call `pauseWhenLeft(pause)` for a **free** round: stop the clock, show a Resume key, start nothing until it is tapped. A round that costs money must **not** pause (its deadline must not move): keep `releaseWhenLost`, leave `pauseWhenLeft` out.

**Check:** hold a move key, hide the tab or switch windows, come back: the character stands still until the key is pressed again.

## 9. The friends list (the admin's `friends` setting)

```ts
import { mountFriends } from "@nano133/nanoterra/friends/panel";
import "@nano133/nanoterra/friends/style.css";
```

- Read the setting on the server with `loadGameSettings(store, defaults)` (`friends` is `"nanoterra"`, `"own"` or `"off"`) and pass it as `mode`. Do not read it in a
  second place.
- `"nanoterra"`: `mountFriends(el, { mode, game })` with the game's id on Nanoterra. Mount it when the game starts, not when the key is pressed: the window holds the
  player's live connection. Never hide its element with `display: none` or remove it; `destroy()` is for the end of the game. Call `setWhere(text)` when the player moves
  (plain text, friends see it). Give `onJoin` only to save the game before it leaves; the kit asks the player first and accepts only https addresses.
- `"own"`: add `createFriendsHandler({ store, directory, player })` from `@nano133/nanoterra/friends` to the server, with `createD1Friends(env.DB)` (add
  `@nano133/nanoterra/friends/d1.sql` to the migrations) or `createFirestoreFriends(db)`. `player(req)` reads the game's own PLAYER sign-in, never the admin's.
  `directory.byName` and `directory.names` read the game's own player names. Call `store.forget(player)` from the game's "Delete my data".
- A store of the game's own (another database) passes `friendsStoreConformance` from `@nano133/nanoterra/friends/conformance` before it is used.

**Check:** with `"nanoterra"`, the key shows and the window loads at once (the network tab shows `/embed/friends` before the key is pressed). With `"own"`, two players
in two browsers: one adds the other by name, the other accepts, both show online with their place, an invite shows, a block hides the blocker from the other. With
`"off"`, no key.

## 10. The options menu (any game with settings)

```ts
import { common, createOptions, keyBinding, mountOptions, reflectOptions } from "@nano133/nanoterra/options";
import "@nano133/nanoterra/options/style.css";
```

- Make ONE store when the game starts: `createOptions({ game, defs })`, with `game` the game's id. Take the common settings the game honours by key
  (`common("masterVolume", "musicVolume", ...)`) and add the game's own defs (`kind` `"toggle"`, `"choice"`, `"range"` or `"key"`; a short `label`; `tab`
  `"basic"` for what most players want, `"advanced"` for the rest; a `group`; a `default`, one value or `{ phone?, tablet?, desktop?, reducedMotion?, default }`).
- Read values with `get(key)` where the game uses them, and apply a change at once in `subscribe((key, value) => ...)`: a volume, the camera speed, the quality.
  Never keep a second copy of a setting in the game's own storage.
- `mountOptions(el, store)` for the gear key, or `mountOptions(el, store, { key: false })` and `open()` from the game's pause menu. Pause a free round in
  `onOpen` and go on in `onClose`.
- With `reducedMotion`: honour it in the game's code (no shakes, no camera swings, no flashes) and call `reflectOptions(store, ["reducedMotion"])` so the page's
  CSS can calm its own animations (`html[data-n133-opt-reduced-motion="true"]`).
- A kit module or a part of the game that comes later adds a section: `store.add(optionSection("name", defs, "Heading"))`. Its keys start with `name.`; never
  use a key twice (the store throws).
- Do not use a setting for a game's rules, a score or a payment: a setting only changes how the game looks, sounds and is controlled.

**Check:** change a setting, reload: it holds; set it back: the browser keeps nothing for it (`localStorage["n133-options:<game>"]` has no such key). On a
phone held upright the panel is a sheet from the bottom, on a desktop a sheet on the right; the tabs work by touch; Reset asks in the panel.

## 11. Emotes (any game with the kit's character, or its own animations; the admin's `emotes` setting)

```ts
import { createEmotes, loadEmotes, playRemote } from "@nano133/nanoterra/emotes/player";
import { emoteMessage, readEmoteMessage, EMOTE_OPTIONS } from "@nano133/nanoterra/emotes";
import { mountEmotes } from "@nano133/nanoterra/emotes/wheel";
import "@nano133/nanoterra/emotes/style.css";
```

- Read `emotes` with `loadGameSettings` (`"on"` by default, or `"off"`) and pass it to the wheel as `nanoterraEmotes`. When it is `"off"`, do not call
  `playRemote` and do not send the player's emotes. Do not read it in a second place.
- With the kit's character: `const emotes = createEmotes(hero)` once, and `mountEmotes(el, { game, onPlay: (id) => emotes.play(id), onOpen: () => void
  loadEmotes() })`. Change nothing in the frame loop: `hero.update(dt, motion)` plays the emote. Never import the clips yourself: `loadEmotes` loads them.
- With the game's own animations: `mountEmotes(el, { game, emotes: [{ id, label, icon? }, ...], onPlay })`; Nanoterra's ids may be in the same list.
- Multiplayer: send `emoteMessage(e)` from `onEmote` (a loop fires again every 10 s: send it again); on the other side, `readEmoteMessage(m)` and
  `playRemote(characterOf(sender), { id })`, which ignores an id that is not an emote. Nothing to send when the player moves: the move ends it everywhere.
  A server that relays emotes checks the id against the list (`EMOTES`) and drops any other.
- With an options menu (step 10): add `EMOTE_OPTIONS` to the store and pass the store as `options` to `mountEmotes` and `playRemote`.
- A game with water calls `emotes.stop()` (or `stopEmote(character)`) when a character goes in: the kit's pose does not swim.

**Check:** the network tab shows no `clips` chunk and no `icons` picture before the wheel first opens. On a phone held upright: a tap on Emotes opens the wheel in
the middle; a hold on the key and a slide onto a place plays it; Edit refuses a ninth with "Your wheel is full. Take one off first."; the wheel holds after a
reload. A walk ends Dance; Clap goes on over the walk. On a keyboard: B opens it, 2 plays the second place, Escape closes it.

## 12. Do not

- Do not edit the geometry, the skeleton or the toon and ink materials.
- Do not add the katana, the headband or other brands' art. A game's own worn model goes on a socket (`c.socket("head" | "hand" | "back")` or
  `c.setWorn([{ socket, object }])`), and is checked first with `checkModel(bytes, HAND_ITEM)` (or `HEAD_ITEM`, `BACK_ITEM`) from `@nano133/nanoterra/model`.
  A hand thing has an empty `grip_R` node where the hand holds it and stays inside 0.96 x 0.68 m, from 1.17 m below that grip to 0.43 m above. A back
  thing gives `hideTail: true` and `hideWings: true`, so a tail or wings do not poke through it.
  The game loads the model and frees it; the character never does.
- Do not use a look or a record for a game's rules, a score or a payment: it is display only.
