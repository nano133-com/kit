# @nano133/nanoterra

Stage: Pre-alpha. What this means: https://nano133.com/stages

Nanoterra for your game, in **one package**. [Nanoterra](https://nano133.com/build/nanoterra) is
nano133.com's island. A player who is signed in there presses Play, and arrives at your game as
themselves. This package gives your game four things:

- **The sign-in ticket** (`/ticket`): the player's name, Nano address and character, read in the browser. No server, no secret.
- **The player's character** (`/character`): the same toon body that the player has on the island, drawn with Three.js. Six bases, faces, hair, clothes, sizes and colours.
- **The looks ladder** (`/looks`): the rules of `looks.json`, the price steps, and what a change does to the players who own a look.
- **Held input that does not stick** (`/input`, since 0.3.1): lets go of the keys and the stick when the player leaves the page, so the character never walks on by itself, and pauses a free round.
- **A friends list** (`/friends`, unreleased): a Friends key that holds the player's Nanoterra friends (a nano133 window), or a full friends list of the game's own players on the game's own database, as the admin's Game card chooses.

It replaces `@nano133/character` 0.1.0, `@nano133/ticket` 0.1.0 and `@nano133/looks` 0.1.0
(see "Moving from the three old packages"). Sign-in, checkout and late returns stay in their own packages
([`@nano133/signin`](../signin), [`@nano133/checkout`](../checkout), [`@nano133/late-returns`](../late-returns)).

nano133.com's island and its 3D room draw the player with **this same code**: the geometry, the skeleton, the colours and the record
are one source. A game made with this package shows the character exactly as the island does.

Pre-alpha means: the shape of the API may still change, and the character has not been run on a real phone yet.

## Install

```sh
npm install @nano133/nanoterra three
```

`three` is an **optional** peer dependency (`>=0.174.0`). A game that only reads a ticket does not need it.

## Quick start

A page with a Three.js scene. The player arrives from Nanoterra, signed in; any other visitor is a guest.

```ts
import { readTicket } from "@nano133/nanoterra/ticket";
import { createCharacter } from "@nano133/nanoterra/character";

const result = await readTicket(); // the ticket in the address, checked; { ok: false } is a guest (ask "Sign in as <name>? Continue / Not me" first)
const hero = createCharacter(result.ok ? { record: result.ticket.record, look: result.ticket.look } : {}); // their character, or the island's first look
scene.add(hero.object); // feet at y = 0, facing +Z, about 2.29 m tall; move it with position and rotation.y
renderer.setAnimationLoop(() => {
  hero.update(clock.getDelta(), { speed: 3.75 }); // idle, walk (3.75 m/s), run (6.5), jump: your numbers; dt in seconds
  renderer.render(scene, camera);
});
```

That is the whole of it. Add `hero.wave()`, `hero.setLook(next)` and `hero.dispose()` as the game needs them.

**The one switch.** The [game starter](https://github.com/nano133-com/nano-game-starter) keeps one switch in one file:
`game.config.json` says `"character": "nanoterra"` (the player is their Nanoterra character: the default) or `"own"` (the game's own
character). Nothing else reads it. If you do not use the starter, make your own switch where it suits your game.

## The paths

Each path loads only what it needs. A page that reads a ticket loads no Three.js.

| Path | What it is | Loads Three.js | Size (minified, gzip) |
|---|---|---|---|
| `@nano133/nanoterra` | the types `Look` and `LookRecord`, and nothing that runs | no | 0 |
| `@nano133/nanoterra/character/record` | the character's **record**: pack, unpack, check, `fromLegacy`, `toLegacy`, `diceRecord`, the lists | no | 4.4 kB (all), 1.9 kB (pack, unpack and the two legacy calls) |
| `@nano133/nanoterra/ticket` | read and check a sign-in ticket | no | 4.7 kB (all), 3.1 kB (`readTicket` alone) |
| `@nano133/nanoterra/looks` | the looks ladder | no | 1.9 kB (all), 0.9 kB (`checkLooks` alone) |
| `@nano133/nanoterra/character` | the builder and `createCharacter` (it includes the record), with the three sockets | yes | 21.8 kB (all, with the sockets and `createLookPreview` of 0.3.0; 20.4 kB on 0.2.0), 17.8 kB (`createCharacter` alone, measured on 0.2.0) |
| `@nano133/nanoterra/model` | the 3D model check: a `.glb` against the island's limits or a cosmetic's (since 0.3.0) | no | 8.8 kB |
| `@nano133/nanoterra/input` | let go of held keys and sticks when the player leaves the page, and pause: `releaseWhenLost`, `pauseWhenLeft`, `swallowsKeyup` (since 0.3.1) | no | 0.5 kB |
| `@nano133/nanoterra/admin` | the admin of a game: the guard, the handler, the store type (server code; since 0.2.0) | no | 3.7 kB |
| `@nano133/nanoterra/admin/d1`, `/admin/firestore` | the admin store for D1 (the starter's tables) or Firestore (a small interface, no Firebase dependency): `createD1Store`, `createFirestoreStore` (since 0.2.0) | no | 1.5 kB each |
| `@nano133/nanoterra/admin/panel` | the admin page, drawn in the browser into one element, and its stylesheet `@nano133/nanoterra/admin/style.css` (since 0.2.0) | no | 18.9 kB with the tabbed layout (10.6 kB on 0.3.0, 8.5 kB on 0.2.0) + 5.9 kB of CSS (minified) |
| `@nano133/nanoterra/admin/conformance` | test cases that a game runs against its own admin (a dev dependency in practice; since 0.2.0) | no | n/a |
| `@nano133/nanoterra/friends` | the game's own friends list: the handler, the rules, a memory store (server code; unreleased) | no | 3.7 kB |
| `@nano133/nanoterra/friends/d1`, `/friends/firestore` | the friends store for D1 (with the migration `/friends/d1.sql`) or Firestore (a small interface, no Firebase dependency): `createD1Friends`, `createFirestoreFriends` (unreleased) | no | 3.0 kB each |
| `@nano133/nanoterra/friends/panel` | the Friends key and panel: the nano133 window, or the game's own list, and its stylesheet `@nano133/nanoterra/friends/style.css` (unreleased) | no | 5.0 kB + 4.8 kB of CSS (minified) |
| `@nano133/nanoterra/friends/conformance` | the friends rules as test cases, for a store a game writes itself (unreleased) | no | n/a |

Measured 2026-10-26 (the friends paths 2026-10-30): `esbuild --bundle --minify --format=esm --external:three`, then `gzip -9`, without Three.js.
All four paths together: 23.6 kB. A test of the package proves that the record, the ticket, the looks and the small part import no package at all.

## The character

```ts
import { createCharacter, HEIGHT, RADIUS } from "@nano133/nanoterra/character";

const c = createCharacter({ record, quality: "high" });
scene.add(c.object);
c.update(dt, { speed, airborne, verticalSpeed });
c.wave();
c.setLook(otherRecord); // or five colours
c.setColors({ shirt: "#c8461a" }); // any colour, over the record's
c.dispose();
```

| Call | What it does |
|---|---|
| `createCharacter({ record?, look?, colors?, quality?, reducedMotion?, worn? })` | Builds a character. `record` is the player's whole character (see "The record"). `look` is the five colours `{ skin, hair, shirt, pants, shoes }` of a player whose ticket has no record: the Classic body in those colours (read only when `record` is left out). Neither: the island's first look. `colors` paints colours over the record's (any `"#rrggbb"`: a shop dye is not on the island's lists). `quality` is `"high"` (default) or `"low"`. Something that is not good throws a `TypeError` that names the part and the value. |
| `c.object` | A `THREE.Group`: feet at y = 0, facing +Z. Add it to your scene; move it with `position`, turn it with `rotation.y`. It holds the skinned meshes **and the blob shadow** (a disc in the body). |
| `c.update(dt, { speed, airborne, verticalSpeed })` | One frame. `dt` is in **seconds** (a frame longer than 0.05 s counts as 0.05 s). Idle, walk, run and jump come from your numbers. Every field is optional. See "Motion". |
| `c.wave()` | Waves the left arm for 1.8 s (`WAVE_SECONDS`), as the island does. |
| `c.setLook(next)` | `next` is a record or five colours. A record with the same body only repaints; another base, hair, face or clothes builds new geometry (the old is freed) and the walk carries on. Five colours go into the record that is there (its base, face and clothes stay). A bad value throws and changes nothing. |
| `c.setColors(colors \| null)` | Paints these colours over the record's; `null` gives the record's own back. No new geometry. |
| `c.record`, `c.look` | The record now (a frozen copy), and its five colours (the older view). |
| `c.reducedMotion` | A boolean you may change: true turns off the swing of the arms and legs and the bob, and makes the wave still. Set it from `prefers-reduced-motion`. |
| `c.socket(name)` | An attach point, a `THREE.Object3D` on a bone: `"head"`, `"hand"` or `"back"`. Add your own object to it and it follows the bone. It is the same object for the character's whole life: a rebuild moves it, with what hangs on it, to the new bones (since 0.3.0; see "Worn things and sockets"). |
| `c.setWorn(worn)` | The worn things (`WornAdapter`): shapes merged into the body, or a model on a socket. A model on a socket builds no geometry; the objects of things no longer worn come off their socket (since 0.3.0). |
| `c.dispose()` | Frees the geometries, materials and textures that the character made. The other calls do nothing after it. It never frees an object that you hung on a socket: that is yours. |

Also exported from `/character`: `HEIGHT`, `RADIUS`, `WAVE_SECONDS`, `buildCharacter` and `assemble` (the pieces `createCharacter` uses: the geometry, the skinned meshes on the island's 28-bone skeleton), `BASE_IDS`, the lists, and everything of `/character/record`.

### Motion

`speed` is the speed over the ground in metres a second (not a velocity: the direction is `object.rotation.y`, which you set). It is eased, as on the island.

| `speed` | What shows |
|---|---|
| 0 to 0.25 | Idle: arms 0.2 rad out, elbows a little bent. |
| 0.25 and more | A walk: legs and arms swing against each other, the hips bob and lean. The swing is full at 3 m/s. The island walks at 3.75 m/s. |
| 3.4 to 5 | The walk blends into a run: more swing, more bend at the elbows, more lean. The island runs at 6.5 m/s. |
| 9 and more | The same as 9. |

`airborne: true` shows the jump pose at once, whatever the speed: arms out, legs apart. `verticalSpeed` (metres a second, up is positive)
sizes the shadow: it adds up while the character is airborne to an estimate of the height over the take-off place. The shadow disc stays on the
ground (it moves down as the body rises, in the character's own space) and shrinks to 0.55 of its size, as on the island. A character made
smaller or larger by `object.scale` should be given `speed / scale` and `verticalSpeed / scale`. A base with a tail, wings or long hair moves them too.

### The record

A record is the whole character as whole numbers, each an index into a **closed list**. There is no free text, no URL and no colour string,
so there is nothing to moderate and nothing to inject.

| Field | What it picks |
|---|---|
| `base` | one of six: `classic`, `round`, `critter`, `bee`, `robot`, `pineapple` |
| `skin`, `hair`, `shirt`, `pants`, `shoeColor`, `trim`, `visor` | a colour from that part's list (the body's list depends on the base) |
| `hairStyle`, `face`, `brows`, `blush`, `freckles`, `glasses` | the head |
| `top`, `bottom`, `shoes`, `pattern` | the clothes (a base with its own body, such as the Bee, wears none) |
| `height`, `build`, `head` | the sizes (a scale; the build and the head size change the shape) |

It packs into **two whole numbers** (`packRecord`: 28 and 30 bits) for a wire, a ticket or a database; `unpackRecord(a, b)` gives the record back, or
`null` when a number is not whole, is out of its bits or is off a list. `recordProblem(x)` says in one sentence what is wrong with a record,
`clean(x)` puts a wrong field back to its default, and `diceRecord(rand)` makes a random one. A record of zeros is the island's first avatar.

```ts
import { fromLegacy, toLegacy, packRecord, unpackRecord, diceRecord, baseRecord } from "@nano133/nanoterra/character/record";

const rec = fromLegacy(ticket.look); // five colours (a ticket from before the record) to a record: a Classic in those colours
toLegacy(rec); // the record's five colours again: every one of the 8,192 old looks comes back whole (a test holds it)
const [a, b] = packRecord(rec); // two numbers
unpackRecord(a, b); // the record, or null
```

The five colours, `Look`, are `{ skin, hair, shirt, pants, shoes }`, each `"#rrggbb"`. `LOOK_PARTS` lists the colours the island offers
(8 skins, 8 hairs, 8 shirts, 4 pants, 4 shoes), `defaultLook()` is what a new player starts with, and `isLook(x)`, `lookProblem(x)` and `assertLook(x)` check one.

### Units, size and the collider

The model is built in metres, at the size of the island's avatar.

| | |
|---|---|
| `HEIGHT` = 2.29 m | From the soles (they dip 0.008 m under y = 0) to the top of the hair, for the default Classic at its normal size. Another base, hair or size is not this tall: measure with `new THREE.Box3().setFromObject(c.object)`. |
| `RADIUS` = 0.49 m | The Classic's trunk: the widest part of the body without the arms. Use it as the radius of a cylinder or capsule collider. |
| Facing | +Z. `object.rotation.y = Math.atan2(dx, dz)` turns it to walk along (dx, dz). |
| Its left | +X (the character's own left hand is at +X). |

The body is **display only**. A game decides its own collider, jump and reach: use the same numbers for every base and size, so that
a player's choice of body never changes a rule. nano133.com's island and room do the same. A size changes a scale of the drawing (`height`) and nothing else.

### Draws, quality, speed and size

| | `quality: "high"` | `quality: "low"` |
|---|---|---|
| Draws | 2 (toon body with its shadow disc, ink outline) | 1 (toon body with its shadow disc) |
| What it costs | | No outline: the character reads flatter against a background of its own colours. |
| What it saves | | One draw and the skinned ink vertices each frame. |

`"low"` keeps every shape and colour: only the ink pass goes. Choose it for slow phones. It is fixed when the character is made.

- Each character builds its own geometry. A scene with many characters of the same look should share it; this package does not yet.
- The meshes are not frustum-culled by their bones (they move every frame): the package gives each a fixed bound. Set `c.object.visible = false` for a character that is far from the camera or off screen.
- The ink line is a second draw of the same skinned mesh, with its back faces, pushed out along its normal in screen space, so it keeps one width in pixels (2.6). Use `WebGLRenderer`: the ink is a GLSL `ShaderMaterial`.
- Frame rate has not been measured on a real phone by this package. nano133.com's island draws a room of twelve of these characters at 60 frames a second on a throttled phone profile.

## Worn things and sockets

A worn thing reaches the builder through **one small interface**, `WornAdapter`. It has two ways, and a thing may use both:

- **Merged shapes** (`add(ctx)`, and what it does to the hair `fit`, `hidesBadge`, `hideTail`, `hideWings`): the thing's shapes go into the body's own buffers, so it
  **adds no draw**. nano133.com fits the island's 14 shop items (hats, scarves, packs, tops, a buddy, a blade) to every base this way, with its own code.
- **A model on a socket** (`socket` and `object`, since 0.3.0): your own `THREE.Object3D` (a `.glb` you loaded, say) hangs on one of the character's three
  attach points and follows its bone. It costs **its own draws** (1 or 2 for each thing). The character never frees it: you load it and you free it.

```ts
const c = createCharacter({ record });
const shovel = (await new GLTFLoader().loadAsync("/looks/shovel.glb")).scene;
c.setWorn([{ socket: "hand", object: shovel }]); // or: c.socket("hand").add(shovel)
c.setLook(otherRecord); // another base: the shovel moves to the new hand
c.setWorn([]); // the shovel comes off; free its geometry and materials yourself
```

| Socket | Bone | Where | Its axes |
|---|---|---|---|
| `"head"` | `head` | the base's hat frame (`BASE_SPECS[base].hat`: about the middle of the head), scaled by the hat frame and the head's size | the character's: +Y up, +Z forward. A thing made round the middle of the Classic's head (radius 0.42 m) fits every head |
| `"hand"` | `grip_R` | the middle of the drawn right hand (a wide build or base draws its hands further out than the bone) | `HAND_HOLD`: a thing modelled standing up (+Y) with its grip at the origin is held pointing forward, its front (+Z) up |
| `"back"` | `chest` | on the back of the torso at the chest's height (`BASE_SPECS[base].back`, else the torso's radius at 1.12) | the character's: the side that touches the body at the origin, the bulk towards -Z. Give the thing `hideTail: true` and `hideWings: true` to take a Critter's tail and a Bee's wings off under it |

`socketFrame(spec, look, name)` gives a socket's bone, place, turn and scale for a base and a look, and `placeSocket(object, bones, spec, look, name)`
puts an object there: a host that uses `buildCharacter` and `assemble` (not `createCharacter`) makes its own sockets with them. Check a socket model
with the presets of `@nano133/nanoterra/model` (`HEAD_ITEM`, `HAND_ITEM`, `BACK_ITEM`) before you ship it.

A player's item ids come in the sign-in answer (`ticket.items` here, `character.items` in the code exchange). The island's item art is not in this package;
a game may ignore the ids or draw its own things.

## Model check (`@nano133/nanoterra/model`; since 0.3.0)

`checkModel(bytes, limits)` reads a `.glb` (binary glTF 2.0) from its bytes and answers `{ ok, problems, facts, advice }`. It is pure (no Three.js, no
network, no DOM) and it never throws: a file that cannot be read answers a problem. The file comes from a stranger, so every read is bounded (no size in the
file is trusted, the work has a cap and a time limit).

- `problems`: each `{ rule, fix }`, the fix in one or two plain sentences for the creator. Rules: `file`, `size`, `embedded`, `extensions`, `lights`,
  `motion`, `triangles`, `textures`, `draws`, `zone`, `markers`, `time`.
- `facts`: the bytes, the triangles, the **draws** (each part of each drawn mesh instance), the **materials** the parts use, the textures (their type and size,
  read from the picture itself), the box and the reach, the markers, the anchor.
- `advice`: lines that are never a failure: a large PNG or JPEG (KTX2 makes it smaller), 32-bit positions (`KHR_mesh_quantization` halves them),
  parts that share a material (joining them saves draws).
- `modelSummary(facts)`: one short line ("646 triangles, 0 textures, 49 KB, 0.5 x 0.4 x 1.0 m").

The presets (`limits.ts`; a game may make its own `ModelLimits`). The cosmetic numbers are Wes's of 2026-10-28 (the hand zone his second choice that day, so that a shovel held by its T-handle fits); the zone is in metres for a character 2.29 m
tall, its origin the socket's point (a hand item's `grip_R` marker when it has one):

| Preset | Zone (w x d x h) | Triangles | Textures | Draws | File |
|---|---|---|---|---|---|
| `HEAD_ITEM` | 0.9 x 0.9 x 0.8, from 0.1 below the socket | 3,000 | 1 of 512 px | 2 | 300 KB |
| `HAND_ITEM` | 0.96 x 0.68 x 1.6, from 1.17 below the grip to 0.43 above (a tool held near its top) | 3,000 | 1 of 512 px | 2 | 300 KB |
| `BACK_ITEM` | 1.0 x 0.6 x 1.2, from 0.6 below the socket | 4,000 | 1 of 512 px | 2 | 400 KB |
| `ISLAND_MODEL` | a disc of 9 m radius (18 m across), 18 m high, from the ground | 50,000 | 8 of 1,024 px | no limit | 5 MB |

Every preset refuses skins, animations, morph targets, lights, external files and compressed meshes (Draco, meshopt): a worn thing is rigid on its socket.
`COSMETIC_LIMITS` gives the preset of each socket by its name. The island preset is nano133.com's (its "Launch my game" check uses this same code).

## Leaving the page (`@nano133/nanoterra/input`; since 0.3.1)

The browser sends a key's "up" only to the window that has the focus. A key that is down when the player leaves the page (another tab, another window, a pop-up,
Cmd+Tab, another app on a phone) never sends it to your game. A game that keeps a "held keys" set keeps the key, and the character **walks on by itself** when the
player comes back. nano133.com's island had this, and so did the starter. One call fixes it, and one more pauses a free round:

```ts
import { pauseWhenLeft, releaseWhenLost, swallowsKeyup } from "@nano133/nanoterra/input";

const keys = new Set<string>();
window.addEventListener("keydown", (e) => { if (!swallowsKeyup(e)) keys.add(e.key); }); // a key with Cmd is the browser's shortcut: never held
window.addEventListener("keyup", (e) => keys.delete(e.key));
releaseWhenLost(() => { keys.clear(); stick.reset(); queuedJump = false; });             // at each leave: let go of everything
pauseWhenLeft(() => { game.paused = true; resumeCard.hidden = false; });                // a FREE round: stop the clock, show Resume
```

- `releaseWhenLost(release, keysOnly?)` calls `release` at a window **blur**, **focus**, **pagehide**, a **hidden tab**, and the **Cmd key** (on a Mac a key that is released
  while Cmd is down sends no keyup). `keysOnly` is called when a menu opens (a right click): a menu takes a keyup, but a long press on a touch screen asks for a menu too,
  so a thumb on a stick must not lose its walk for it. A menu that your page stopped (`preventDefault`) lets go of nothing.
- **After a leave, a key repeat is dropped until a key goes down again.** One more repeat of the held key can arrive after the release, or the repeats go on when the
  player comes back, and they put the key back (its keyup went to the other window). The helper stops such a repeat in the capture phase, so your own key handlers
  never see it. The player presses the key again to walk on. A menu is no leave: its repeats still put the key back.
- `pauseWhenLeft(pause)` calls `pause` when the tab is hidden or the window loses the focus to another window (a real `blur`: not a script's, and not a focus that moves
  inside your page into a dialog). It can call `pause` twice for one leave, so make it safe to call twice. Show a Resume key and start nothing until it is tapped.
- **A round that costs money must not pause**: its deadline must not move (nano133.com's arcade has the same rule). Keep `releaseWhenLost` (the character always stops)
  and leave `pauseWhenLeft` out.
- It returns the function that takes its listeners away. It names no package and reads only plain browser events. The same code runs in nano133.com's island and rooms,
  and in the [game starter](https://github.com/nano133-com/nano-game-starter).

## The sign-in ticket

`@nano133/nanoterra/ticket` reads and checks a sign-in ticket in the player's browser. It is for a game on a **static site**: no server, no secret.
A player who is signed in at nano133.com presses Play in Nanoterra, agrees once on a card, and arrives at your game with a signed ticket after
the `#` of its address. This package checks the ticket and gives you the player's **username**, **Nano address** and **character** (the five colours,
the whole record, and the cosmetics the player owns).

If your game has a server, use the code exchange instead (the [game starter](https://github.com/nano133-com/nano-game-starter) does): a server that
holds a secret can know who is at the other end. A ticket cannot.

`readTicket()` does four things, in this order:

1. Finds `#nanoterra=<ticket>` in the page's address. With none, it answers `{ ok: false, reason: "none" }` and does nothing else (no network call).
2. **Takes the ticket out of the address bar** (`history.replaceState`), so a reload, a copied link, a screenshot or a bookmark never carries it.
3. Reads the public keys from `https://nano133.com/api/nanoterra/keys` (once for the session, and again if a ticket names a key it does not know; it waits 5 seconds at most, then the player is a guest).
4. Checks the signature, the kind, that the ticket is **for this origin** and that it has not run out. It never throws.

Call it once, when the page loads.

### Rules

- **A ticket proves nothing to your server.** The ticket sits in an address bar: anyone who sees it can use it for two minutes. Use it to show the
  player's name and character. **Never give a sale, a prize or a score on a ticket alone.**
- **Ask before you treat the player as that name.** Anyone can send a link that holds their *own* ticket (login CSRF). Show "Sign in as *name*? Continue / Not me"
  and keep the player a guest until Continue.
- **Show the name** wherever the player is "signed in", and say whose account it is before a payment.
- **The username comes from another site.** Put it in the page as text, never as HTML.
- A guest is a normal visit. Every refusal (`reason`) means "play as a guest".

### What you get

```ts
type Ticket = {
  username: string;
  address: string; // the whole Nano address; also the player's id
  look: { skin: string; hair: string; shirt: string; pants: string; shoes: string }; // "#rrggbb": every ticket has these
  record?: LookRecord; // the whole character, when the ticket carries one (see below); a ticket from before it has no `record` at all
  items: string[]; // the Nanoterra cosmetics the player owns, in the character's slots
  game: string; // your game's id at nano133.com
  audience: string; // the origin the ticket is for
  issuedAt: number; // ms since 1970
  expiresAt: number;
  id: string;
};
```

`record` is read with care: the ticket's claim is two numbers, and it is kept only when both are whole numbers on the closed lists (`unpackRecord`).
A ticket without a record, or with one that is not whole, is still a good ticket and reads **exactly as the `@nano133/ticket` 0.1.0 ticket did**: the field is not there.
`createCharacter({ record: ticket.record, look: ticket.look })` takes both.

### Refusals

| `reason` | Meaning |
|---|---|
| `none` | no ticket in the address: a plain visit |
| `unsupported` | this browser has no Ed25519 in Web Crypto (Chrome 137, Safari 17, Firefox 129 and later have it) |
| `malformed` | not a ticket |
| `keys` | the public keys could not be read (offline, or nano133.com did not answer) |
| `unknown-key`, `signature` | signed with a key that is not nano133.com's, or the signature does not hold |
| `wrong-kind` | signed right, but not a version 1 ticket from nano133.com |
| `audience` | a ticket for another origin |
| `expired`, `early`, `life` | the time does not hold. A player's clock may be a minute off, either way |

### Options

```ts
readTicket({
  keys, // pin the public keys: no fetch at all
  keysUrl, // another place for the keys (tests)
  keysTimeoutMs, // how long to wait for the keys; default 5,000 (a slow nano133.com never holds your first screen)
  audience, // the origin to expect; default: this page's own
});
```

`verifyTicket(token, { audience, keys })` checks a ticket you already hold, and `fetchKeys()`, `ticketFromHash(hash)` and `hashWithoutTicket(hash)` are the parts.

### The format

For any language. A ticket is `base64url(JSON claims) "." base64url(signature)`: an Ed25519 signature over the ASCII of the first part, made with the key whose `kid` the claims name.

```json
{ "v": 1, "typ": "ticket", "iss": "nano133.com", "kid": "fe812c12f3ab4ce6", "aud": "https://game.example",
  "game": "gem-island", "sub": "nano_3i7m…", "name": "Ann",
  "look": { "skin": "#f2c29b", "hair": "#3a2a1e", "shirt": "#2a9df4", "pants": "#1e2a4a", "shoes": "#ffffff" },
  "record": { "v": 2, "k": [2359336, 1642] },
  "items": ["hub.sun-hat"], "iat": 1800000000, "exp": 1800000120, "jti": "AAAAAAAAAAAAAAAA" }
```

`record` is optional: `k` is the two numbers of `packRecord`. `GET https://nano133.com/api/nanoterra/keys` answers
`{ "keys": [{ "kid", "kty": "OKP", "crv": "Ed25519", "x", "alg": "EdDSA", "use": "sig" }] }` and may be read from any page.
A ticket lives two minutes (`exp - iat` is 120; a longer life is refused).

### Turn it on

Your `nano-game.json` says `"signin": "ticket"`. Nanoterra's Play key then sends signed-in players to your play address with a ticket.
A player who has not agreed, or who plays as a guest, arrives with no ticket.

## The looks ladder

`@nano133/nanoterra/looks` is the code behind the **Shelf** screen in the game starter's `/admin`. Use it in any game that sells looks for Nano (XNO).
It has no dependencies, runs in a Worker, a browser and Node, and never makes a network call. **It never takes part in a sale:** nothing here sends a price, a sale or a
player to nano133.com. Your game is the seller.

```ts
import { checkLooks, removalProblems, looksJson, PRICE_LADDER } from "@nano133/nanoterra/looks";

const looks = checkLooks(JSON.parse(fileText)); // throws an Error with the first mistake in plain words
const problems = removalProblems(looks, newLooks, ownedLookIds); // a look that a player owns must stay
const text = looksJson(newLooks); // the new looks.json: one look on each line
```

(A shop look here, `Look` of `/looks`, is a thing a player can buy. It is not the five colours `Look` of the small part: they live on different paths.)

```ts
type Look = {
  id: string; // 1 to 40 lowercase letters, digits or dashes: "mint-cap"
  name: string; // 1 to 40 characters
  priceUsd: number; // US dollars, at most 2 decimals; 0 is the free look
  wear?: string; // the wear slot it fills: none (an outfit), or your game's own slot ("shovel"): see "Wear slots" below
  change?: { body: string; hat?: "cap" | "beanie" | "crown" | "tophat"; hatColor?: string }; // an outfit's colours ("#rrggbb"); an item of another slot has none
  slots?: Record<string, string>; // what YOUR game defines for itself: see "Slots" below. Optional.
};
```

### Wear slots: an outfit, and the items beside it

A look fills one **wear slot**, and a player wears one look in each slot at once. An **outfit** (no `wear`, or `"wear": "outfit"`) is the character's own look: its body colour and
its hat (`change`). Every other wear slot is **your game's own**: a tool's skin, a charm, a trail. An item there has **no `change`** (it does not change the body); your game knows
what it is from its id or its `slots`:

```json
{ "id": "classic", "name": "Classic", "priceUsd": 0, "change": { "body": "#4aa8ff" } },
{ "id": "toy-spade", "name": "Toy Spade", "priceUsd": 0.1, "wear": "shovel" },
{ "id": "echo-bat", "name": "Echo Bat", "priceUsd": 1, "wear": "pinger", "slots": { "ring": "ripples" } }
```

- A wear slot's name is like a slot's: 1 to 24 lowercase letters, digits or dashes, starting with a letter (`SLOT_NAME_PATTERN`); `outfit` (`OUTFIT`) is the outfit's.
- **Keep one free OUTFIT:** every player starts with it. A free item is fine beside it, but it does not count.
- `"change"` on an item is a mistake (`lookProblems`, field `change`): an item never changes the body. An outfit still needs its `change.body`.
- `checkLooks` leaves `wear` out for an outfit (no `wear` and `"wear": "outfit"` are the same look) and `change` out for an item; `looksJson` writes `wear` after `priceUsd`, on the
  look's own line. `wearOf(look)` gives the slot (`OUTFIT` for an outfit); `isOutfit(look)` tells an outfit (with its `change`) from an item.
- **Players own a look by its id, so the wear slot of a look that a player owns must not change:** a shovel that a player owns stays a shovel. `removalProblems` reports it with the
  field `"wear"`; `diffLooks` lists it as `"wear"`.
- The Shelf shows an item's slot on its card ("Worn in the shovel slot") and a tag in place of the character picture (give the Shelf your own `picture` to draw the real item), and
  its editor has a **Wear slot** field (locked for an owned look and the last free outfit) in place of the body and hat of an outfit.
- What a player wears in each slot is your game's to keep (the starter keeps the outfit in the browser); ownership stays by id, as before.

A file of outfits only reads and writes exactly as it did. `change` is optional in the type now: read an outfit's colours after `isOutfit(look)` (or `look.change?.body`). This is a
minor change (0.5.0); a game on 0.4 or before drops `wear`, so a game with items must move to the new version in the game, the server and the Shelf.

### Slots: what your game defines on a look

A game with its own parts (a pair of wings, a trail colour) needs a place for them on a look. That place is `slots`, an optional object of names and values:

```json
{ "id": "ember-wings", "name": "Ember wings", "priceUsd": 0.25, "change": { "body": "#ff7a3d" }, "slots": { "wings": "ember", "trail": "#ffcf5a" } }
```

- A **name** is 1 to 24 lowercase letters, digits or dashes, starting with a letter (`SLOT_NAME_PATTERN`).
- A **value** is a **word** (1 to 40 lowercase letters, digits or dashes, `SLOT_WORD_PATTERN`) or a **colour** (`#rrggbb`). Nothing else: no number, no list, no nested object. A game that needs
  a number writes it as a word it understands (`"size": "large"`).
- **At most 8 slots** on a look (`SLOTS_MAX`), so at most 512 characters of names and values. The names `constructor` and `prototype` are reserved (`RESERVED_SLOT_NAMES`).
- **A colour is written in lower case** by `checkLooks`, `cleanSlots` and `looksJson` (`#FFCF5A` becomes `#ffcf5a`), so the game reads one text for one colour and a change of only the case is no change.
- A look with no `slots`, or with an empty one, is **the same look**. A file from before slots reads and writes exactly as it did. Any other unknown field of a look is still dropped by `checkLooks`.
- Your game reads `look.slots` from the checked looks; the package gives them no meaning.
- `lookProblems` names a bad slot with the look, the field (`slots` or `slots.wings`) and plain words. `checkLooks` keeps the slots (a clean copy). `looksJson` writes them after `change`, on the
  look's own line, in your order of names. `diffLooks` lists a change as the field `"slots"` (the same names and values in any order are not a change; a colour in upper or lower case is the same).
- **Players own a look by its id, so the slots of a look that a player owns must not change:** the game reads the slots of the id, and a new slot would change what they own. `removalProblems`
  reports a changed slot on an owned look as a mistake with the field `"slots"` ("Add a new look with the new slots"), as it reports a removed owned id. A price, a name, a body colour or a hat of an
  owned look may still change. The free look is every player's and no order owns it, so its slots may change; a look that nobody owns may change its slots too. The Shelf never gives an id that a
  player owns to a NEW look (when an owned look is no longer in the file, a new look named like it gets the next free id, such as `mint-cap-2`).
- The Shelf (`/admin/panel`) keeps the slots in its draft, shows them on the look's card, and has a "Slots" editor on each look: rows of a name and a value, Add and Remove, with the count of 8.
  A name used twice, a bad name and a bad value are shown before anything can be copied.

A game on version 0.1.0 of this package drops `slots` when it checks a file: use the version that has them (a minor change, 0.2.0) in the game, the server and the Shelf.

The rules (the same as the starter's `AGENTS.md`):

- A look only changes how the character looks. **It never changes a score, a speed or a rule.**
- Every look shows its price before the player buys. **Nothing is random: no loot boxes, no mystery looks.**
- The list has **at least one free look** (`priceUsd: 0`): every player starts with it.
- **Never change or remove the `id` of a look that someone owns.** Owned looks are kept by id. To stop selling a look, keep it in the file.

| | |
|---|---|
| `lookProblems(raw)` | Every mistake in a list of looks, as `{ look, field, message }`. An empty array is a good list. |
| `checkLooks(raw)` | The looks, or an `Error` with the first mistake in plain words. |
| `removalProblems(before, after, owned)` | The looks in `before` that a player owns (`owned` is a set of ids) and that `after` leaves out, or whose slots `after` changes. |
| `diffLooks(before, after)` | `{ added, removed, changed }` by id. A new order is not a change. |
| `looksJson(looks)` | The text of `looks.json`, one look on each line, as the starter writes it. A change of one look is a change of one line. |
| `slugId(name, taken)` | A free id for a name: `"Mint Cap"` gives `mint-cap`, then `mint-cap-2`. |
| `PRICE_LADDER`, `rungOf(usd)`, `priceText(usd)` | The six steps nano133.com uses, from 1¢ to $1, and a price as a page writes it (`25¢`, `$1.10`). |
| `usdText(usd)`, `wholeCents(usd)`, `HATS` | `"$0.25"`; whether a price has no fraction of a cent; the hats. |
| `sameSlots(a, b)`, `cleanSlots(slots)`, `slotValueOk(v)`, `SLOTS_MAX` | Whether two looks have the same slots; a clean copy (none when empty); whether a value is a word or a colour; 8. |

| Step | Price | For |
|---|---|---|
| dye | 1¢ | a colour |
| charm | 2¢ | a small mark or a badge |
| piece | 5¢ | one worn thing, like a hat or a scarf |
| statement | 25¢ | a bigger piece that people notice |
| set | 50¢ | a few pieces that go together |
| outfit | $1 | a whole look |

The ladder is a suggestion. Any price with at most 2 decimals, up to $1000, is good. `wholeCents` accepts every price in whole cents (the starter's old check,
`Math.round(x * 100) === x * 100`, refused $0.07, $0.29, $0.57 and $1.10 because of floating point).

## The admin (`/admin`; since 0.2.0)

The admin of a game that sells Nanoterra looks for Nano, in the package: one panel for the game, its looks and its orders. It has two parts that never load each other:
the **server part** (`/admin`: the guard, the routes and a test suite) and the **panel** (`/admin/panel`: the page, drawn in the browser). Neither has Three.js. The package has no
database and reads no cookie: **the game gives a session and a store**.

```ts
import { createAdminHandler } from "@nano133/nanoterra/admin";

const admin = createAdminHandler({
  store,                                   // your database: readSettings(), saveSettings(patch, now), summary(now)  (a memory store is in the package, for tests)
  defaults: { character: "nanoterra", signin: "exchange", friends: "nanoterra" },   // what the switches are until /admin sets them (your game.config.json; friends may be left out)
  owner: ownerAddress,                     // "nano_..." lowercase, its checksum checked by you; null when none is set
  session: (req, now) => readAdminSession(req, now),          // YOUR admin login: its own cookie; return { address, createdAt, via: "wallet" } or null
  status: (now, summary) => ({ address: ownerAddress, testMode, warnings }),   // what only your game knows (the store's numbers come too, for a warning like "2 payments came late")
  lookName: (id) => looks.find((l) => l.id === id)?.name,
  check: (now) => checkPayments(now),      // optional: the payment check
});

const answer = await admin.handle(request);   // null when the request is not for /api/admin
if (answer) return answer;
```

**The guard** is `adminAccess({ owner, session, now, maxAgeMs? })`, one pure function with the same five checks as the game starter's `adminGuard`, in the same order: the
game has a real owner address; there is a login; it was made with a wallet signature (a sign-in from Nanoterra names an address but proves no key, so it never opens the
admin); it is the owner's address; it is not more than a day old. **It only refuses more than the starter does, never less**: a bad owner, a time that is not a number
or lies more than five minutes in the future, a login word that is not exactly `"wallet"` and a limit that is not a real number are refusals, a limit above one day is cut
to one day, and a fault inside the guard is a refusal. A test runs the starter's guard and this one over 10,000 inputs and proves that this one never allows what the
starter refuses.

**The handler** refuses a request that says it comes from another page, for a read as for a write: an `Origin` that is not the game's (also `"null"`), or `Sec-Fetch-Site` `cross-site` or `same-site`
(a sibling subdomain has the game's cookies). The admin API is called only by its own page, so whatever CORS headers a game's router might add, the answer is not for another page. A tool with
neither header (curl) and the browser's own address bar (`Sec-Fetch-Site: none`) are not foreign.

**The handler** sends every request under the base path (`/api/admin` by default) through the guard first, before the route is looked up: a visitor who is not the owner
gets 401 or 403 for any path, so nothing about the routes leaks. A POST must come from the game's own page (`Origin`, else `Sec-Fetch-Site: same-origin`). It sets no CORS
header, always sends `Cache-Control: no-store`, reads at most 512 bytes of a press, and limits presses to 30 a minute. A fault in your store gives a plain 500 that shows
nothing of the fault (`onError` hears it). The only writes are the three settings (and, when the game turns on the sign-in list, the deletion of the admin sessions), **never a look, a price or an order**: a change of looks stays a change of your repository.

**Your own routes read the switches** with `loadGameSettings(store, defaults)` (for the listing file's `signin` word and for the character): the stored word, else your default,
and your defaults when the store fails.

**The conformance suite** proves your whole chain, not only the guard: the cookie you read, the session lookup, the owner you pass.

```ts
import { adminConformance } from "@nano133/nanoterra/admin/conformance";

const host = { routes: admin.routes, basePath: admin.basePath, origin: "https://game.example", request: (who, req) => sendAs(who, req) };
for (const c of adminConformance(host)) it(c.name, c.run);   // vitest, node:test or any runner
```

`sendAs(who, req)` makes a request as one of eleven visitors from YOUR sessions: `signed_out`; `game_login` (a login made for your players, which must NOT open the admin);
`game_token_as_admin` (the token of that player login put in the ADMIN cookie: your store must keep the two scopes apart, not only the cookie names); `nanoterra_login`;
`unknown_via_login` (an admin login whose `via` is a word you do not know, like `"ticket"`: it must fail closed); `other_wallet`; `no_address`;
`expired_login` (made LESS than a day ago and expired by your own store, so only your store can refuse it: a game that ignores its own expiry fails); `signed_out_login` (a login that your own
sign-out ended); `old_valid_row` (an admin login more than a day old whose stored row is still valid, so only the guard's age check can refuse it); and `owner`. **Support `req.again`:** when it
is true, send the SAME login as the last request of that kind and do not make a new one. The suite sends `old_valid_row` three times, the last two with `again`, and requires 401 each time: a
session that renews its creation time on every read is a rolling session, and a stolen cookie would then live for ever.
The suite checks every route in `admin.routes` for each, and also: an unknown path gets the same refusal; **OPTIONS and HEAD** on every route are refused like any other method and no
preflight is ever answered; other spellings of EVERY admin path (upper case, a doubled slash, a percent code, a backslash, a dot segment) open nothing with any method; **a request from another
page** (a foreign Origin, `"null"`, a sibling subdomain, Sec-Fetch-Site cross-site or same-site) is refused on every route with every method, for the owner too, and never gets a CORS header; a POST
from another site is refused; a method that a route does not have is refused; a body that is too big is refused; and **every answer is `no-store` with no CORS header**, for every method and
status. A route that someone adds later cannot skip the guard, because the suite walks the route list.

**Three more things a host should support**, so that the suite can catch the wirings that a security read invented against it: `host.endLogin(who)` (end the login of the last request of that kind with
your REAL sign-out route: the suite then sends the same login again and requires a refusal, so a game that keeps sessions in a cache fails); `req.tokenAt` (send a player's login token as a Bearer
header, in the query or in another header instead of the cookie: a game that also reads a player's token from there fails); and the suite sends every refused visitor again right after the owner was
served on the same URL (a game that caches answers by URL fails) and uses the login that did "Sign out everywhere" again (it must be refused at once).

**The sign-in chain contract** (`adminSigninConformance(host, { signOutEverywhere })`, in the same path) tests the code that MAKES the logins, which the suite above cannot see. Give it a host that drives your own sign-in:
`start(scope)` (a new browser starts a request for the game or for the admin), `sign(request)` (the owner's wallet signs it; it MUST throw when the signature is refused, so a signature that stops working
cannot make the contract pass), `finish(request, as, credentials)` (a browser asks to finish it as a scope with its own credentials, as another browser, or with its credentials "retyped" for the other
scope: a cookie copied to the other scope's name, a value that the other scope's hashing would match), optionally `advance(ms)` (moves the game's clock; the cross-scope asks then repeat 10 and 55 minutes after the start, after the admin's
request life has ended and inside the game's hour of delivery) and optionally `signOutEverywhere()`. It requires: a request started for the game never makes an admin login, a request started for the admin never makes a game login (a cross-scope
ask gives NO login of either kind, and the request still signs in its own browser afterwards), each signs in once in its own scope (a request that was collected gives no other browser a login either), a request signs in only the browser that started it (also inside the same
scope), and Sign out everywhere ends the admin's pending requests, those that are signed and those still waiting for a signature, and leaves a player's request alone. Pass `{ signOutEverywhere: true, advance: true }`
when your store has the call and your host can move its clock: a host that then has none fails the contract, so the case cannot be skipped by leaving the call out.

**List the other routes that your own router serves under the admin base** in `host.otherRoutes` (`{ method, path }`: an old `/api/admin/orders`, a debug route, a route kept for an old page).
The suite sends each one as every visitor who is not the owner and requires a refusal. It cannot find a route that your router hides from it, so a route that answers BEFORE the handler with no
guard is a fault only if you list it. **What the suite cannot see:** the code that CREATES admin logins (your wallet sign-in). Test that separately: only a wallet signature started from the
admin may make an admin login, and never from another sign-in. A security read found these gaps in the first version of this suite, and each one is a test now.

### The store (an adapter for your database)

`createAdminHandler` needs a store: three calls, `readSettings()`, `saveSettings(patch, now)` and `summary(now)`. Two adapters come with the package, and **both write only the three settings** (the D1 store also deletes the admin sessions, but only when the game turns on the sign-in list: see below)
(`setting:character`, `setting:signin` and `setting:friends`); every other call they make is a read. Both must pass the same **store contract**, `adminStoreConformance(make)` in
`@nano133/nanoterra/admin/conformance`: the settings are kept and accumulate, saving changes no order, no owned look and no other row, an open order past its expiry counts as expired,
the money is totalled right, the newest 500 orders come first, and a bad rate row is ignored. A game with another database writes its own store and runs the same contract.

```ts
import { createD1Store } from "@nano133/nanoterra/admin/d1";            // the game starter's tables: meta, orders, owned (migrations/0001_init.sql)
const store = createD1Store(env.DB);                                      // Cloudflare's D1Database fits

import { createFirestoreStore } from "@nano133/nanoterra/admin/firestore";   // Firestore (the Admin SDK's `Firestore` fits the small interface)
const store = createFirestoreStore(db);                                   // meta/{key}, orders/{id}, owned/{player__lookId}; the three names can be changed
```

The D1 adapter uses the starter's own queries (the counts and the totals over all orders; the list is the newest 500). The Firestore adapter reads the newest 5000 orders and every owned look,
so it is for a small game; its data model is in the file's top comment. **The Firestore adapter was tested against an in-memory fake of the interface, not against real Firestore.** The D1 adapter
was tested on SQLite with the starter's tables, not on Cloudflare's D1.

### Who signed in, and "Sign out everywhere" (optional)

A creator can see who opened the admin lately, and end every admin login at once. Both are optional: they exist only when the game's store has `recentLogins(limit)` and `signOutEverywhere()`.
With them the panel has a **Sign-ins** card (the last 10 admin sign-ins, newest first: the time, the rough country and a short browser name such as "Chrome on macOS") and a **Sign out
everywhere** button (two presses: "This ends every admin sign-in, in every browser, this one too"). The handler gets the route `POST {base}/signout-all` (behind the same guard, the same
origin rule and a limit of 5 a minute). It deletes the admin sessions and **no player session**, and says how many.

**What is kept, and for how long.** For each admin sign-in the game keeps three things: the **time**, the **country** that the request's country header gave (two letters, or none) and a **short
browser name** that the game makes from the browser text (a family and a system from fixed lists: "Chrome on macOS"). It keeps **no address, no IP and no browser text**. The handler sends only those
three things to the page, whatever the store gives. How long the game keeps them is the game's choice: **30 days is the suggestion**, and the game's `loginsNote` option says it on the card
(the starter deletes a row older than 30 days). The package cannot write a sign-in: the game writes one when it makes an admin login.

With D1: `createD1Store(db, { logins: true })` needs the table `admin_logins (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, country TEXT, browser TEXT NOT NULL)`, a `scope` column on
`sessions` (`'admin'` for an admin login) and a `scope` column and a `delivered` column on `signin_requests` ("Sign out everywhere" also marks every admin request that was started and not delivered as
delivered and ends it (`expires_at = 0`, so the wallet app does not show "Signed in" for it either), so a request that the owner signed a moment ago, or signs a moment later, cannot make a new admin login afterwards). The panel shows a browser name only when it is words (letters and spaces, 40 at most): anything else
a store gives, such as a raw browser text or an address, is shown as "Unknown browser". Without the option the store has neither call, so a game without those tables is not broken. The store contract has cases for both calls.
The Firestore store does not have them yet (a game's sessions are its own): a game with Firestore writes its own `recentLogins` and `signOutEverywhere`.

### Later ideas (not built)

- **A second signature for a write.** The only server write the admin makes is the sign-in switch (and the Shelf never writes), so asking the owner to sign again for each press adds friction for
  little gain. A later version could ask for it if the admin ever writes more.
- **An optional passkey for the admin, bound to the domain.** A passkey (WebAuthn) belongs to the domain it was made for, so a sign-in request that a stranger relays to the owner from another
  page or link **cannot be answered with it**: the browser will not use the passkey on another domain. That is the strongest fix for the relay of an admin wallet sign-in. The wallet text names
  the admin now, but a wallet cannot tell where a request started; a passkey can. Later, not now: the owner's wallet signature would stay as the way to make the first admin login or to
  recover, and the passkey would be a second, optional way that cannot be relayed.

### The panel

```ts
import { mountAdmin } from "@nano133/nanoterra/admin/panel";
import "@nano133/nanoterra/admin/style.css";

mountAdmin(document.getElementById("admin")!, {
  looks,                                        // your looks.json as the game has it now: the Shelf starts from it
  signIn: (into, done) => showWalletSignIn(into, done),   // YOUR wallet sign-in for the ADMIN login; call done() when the owner has signed in
  signOut: () => signOutOfAdmin(),              // sign out of the ADMIN login only (the game's own login stays)
  defaultsFile: "game.config.json",             // optional: where your switches' defaults are written
});
```

The panel draws, from the top: a bar with who is signed in (the short address and a copy key), Live or Test mode, the bot check and Sign out; what is still off (the
status warnings, one banner); four numbers (Earned, Open now, To send back, Players: a press opens the list behind each); then five tabs. **Overview**: the best-selling
looks with their share of the money, the last five orders, the switches as On or Off (and the friends list's choice) and the shelf in numbers (a game with no order yet gets three first steps).
**Cosmetics**: the **Shelf** (below). **Orders**: a filter by status with its count, a search (a look, an address or a block), "Check payments now" when the game gave a
check, "Paid late" with the address to send the money back to, 20 orders at a time; a card each on a phone, a table on a wide panel. **Players**: each player who owns a
look, with their looks. **Settings**: the **Game** card (the two switches and the friends list's three-way choice), the Sign-ins card and the facts (the address, the mode, the nodes, the last price). The tabs are
real tabs (the arrow keys, Home and End work); every tab is made once, so a draft, a search and a switch keep their state, and the panel never writes the page's address.
A visitor who is signed out gets the game's sign-in; a wrong wallet, a Nanoterra sign-in and a missing owner address each get their own screen and see no data (a sign-out
takes the drawn data off the page). Options: `api` (the handler's base path), `noAddressHelp`, `lookPicture(look)` (your own picture of a look for the Shelf), `repoHelp`,
`loginsNote` and `fetch`.

**The Shelf** shows the looks your game sells now in a grid of cards: a big picture on a soft tint of the look's colour, the price with its step on the ladder ("25¢ ·
statement"), what it has sold and its share of the sales, its slots as chips; filters (All, For sale, Free, Not sold yet) and a sort (Best selling, price, name, the
file's order). **Edit the shelf** opens the draft: one card at a time opens with its fields in groups (the name; the price, with the ladder's seven steps as keys; the
look: body colour swatches and any colour, the hat as pictures, the hat colour; the slots), and each card says "New", "Changed", "Owned" or how many problems it has.
A bar at the bottom of the screen holds the state of the draft and the two copy keys ("Copy looks.json", "Copy for my AI"); under the cards are the full list of
problems, GitHub, Start over, what changed and the new file. A removed look can be put back. The pure helpers are exported for a game's own page: `shelfFilter`,
`shelfSort`, `bestSellers`, `orderMatches`, `playerMatches`.

**The Shelf's pictures on the real character** (since 0.3.0). The panel has no Three.js, so it takes the pictures from you, lazily:

```ts
// admin.ts
import { mountAdmin, previewPicture } from "@nano133/nanoterra/admin/panel";
mountAdmin(el, { looks, signIn, signOut, lookPicture: previewPicture(() => import("./lookPreview").then((m) => m.render)) });

// lookPreview.ts (loaded only when the Shelf shows a look)
import { createLookPreview } from "@nano133/nanoterra/character";
const preview = createLookPreview({ body: () => yourDressedCharacter() }); // left out: the package's character, its shirt in the look's colour
export const render = (look) => preview.render(look);
```

`previewPicture(load)` shows the flat picture at once and puts the drawn one in its place when it is ready; with no WebGL, or when `load` fails, the
flat picture stays. `createLookPreview({ size?, body?, record?, background?, key? })` draws each look once with ONE shared offscreen WebGL renderer
(one context for the whole Shelf; a page may have about 16), one picture at a time, and keeps each picture (a PNG data URL) by the look's text.
`body()` gives `{ object, dress(look), dispose() }`: your own character dressed in the look (a hat, a model that loads: `dress` may return a promise).
`dispose()` frees the renderer and its context. The page's Content-Security-Policy must allow `img-src data:`.

**The Shelf never writes.** It edits a draft in the owner's browser and gives text to copy (`looks.json`, or a message for an AI assistant): there is no call in the panel that
changes a look, a price or an order, and a test proves that editing the Shelf sends no request. A change of looks is a change of your repository. The **Game** card writes only the
three settings. The stylesheet is scoped under `.n133-admin`, so it cannot leak into your page; to theme it set `--n133-ink`, `--n133-ink-soft`, `--n133-paper`, `--n133-line`,
`--n133-gem`, `--n133-gem-dark`, `--n133-sea`, `--n133-radius`, `--n133-font`, `--n133-ground` (the wells inside a card), `--n133-warn`, `--n133-bad` or `--n133-shadow` on the
element that holds it. The keys, inputs, switches, swatches and price steps are 44 px or more; the tabs, filter keys and copy keys 40 px. The layout follows the panel's own
width (a container query), not the window's: on a phone two cards a row and the five tabs as icons over their words; three cards a row and the orders as a table from
760 px; four cards from 1000 px. The panel can be up to 1200 px wide: the page that holds it sets the width (the starter's admin page is 900 px).

The wallet sign-in stays yours (`signIn`), because only your game can start a request in the ADMIN scope with its own cookie. The panel never signs anyone in.

## The friends list (`/friends`; unreleased)

A Friends key for the game, and a list behind it. The admin's **Game** card chooses which list (`friends` in the settings; Nanoterra by default):

| Choice | The word | What the player gets |
|---|---|---|
| Nanoterra | `"nanoterra"` | their **Nanoterra friends**, in a small nano133 window in the game. Friends on Nano Island see "Playing <game>" with Join. The friends stay on nano133: the game gets none of them. |
| The game's own | `"own"` | a friends list of **the game's own players**, on the game's own database (this package's handler and stores). Nanoterra friends do not show. |
| Off | `"off"` | nothing. |

```ts
import { mountFriends } from "@nano133/nanoterra/friends/panel";
import "@nano133/nanoterra/friends/style.css";

const settings = await (await fetch("/api/settings")).json();       // your route: loadGameSettings(store, defaults) from "@nano133/nanoterra/admin"
const friends = mountFriends(document.getElementById("friends")!, {
  mode: settings.friends,          // "nanoterra" | "own" | "off"
  game: "my-game",                 // your game's id on Nanoterra (its listing's id: Echo Island's is "gem-island")
  where: "Lobby",                  // where the player is, in your words: friends see it
  onJoin: (target) => go(target),  // optional: "nanoterra" gives a friend's https address, "own" an invite's place (and the friend's name)
});
friends.setWhere("Level 2");       // when the player moves; null for no place
// friends.open(), friends.close(), friends.destroy()
```

The key is 44 px, with a badge (the requests, or else the friends online). The panel is a sheet from the bottom on a phone held upright and from the right on a wide or sideways screen;
Escape and its close key close it. Theme it with the same `--n133-*` properties as the admin panel, and `--n133-friends-z` for its z-index (default 1000).

### The nano133 window (contract v1 with the site)

In `"nanoterra"` mode the panel holds an `<iframe>` of `https://nano133.com/embed/friends?game=<gameId>&v=1` (`origin` changes the host, for a test). The site lets
only a **listed** game's own address frame it. This is the contract between the kit and the site, version 1 (accepted by the site on 2026-10-30):

- **Loaded at once, kept while closed.** The window is made when `mountFriends` runs (no lazy loading) and stays while the panel is closed: it holds the player's
  live connection to nano133's room server, which shows "Playing <game>" to their friends and keeps the badge true. Closed, it is hidden (`visibility: hidden`, moved
  off the screen, `aria-hidden="true"` and `tabindex="-1"`), never `display: none` and never removed. `open` and `closed` change only the window's own view.
  `destroy()` removes it.
- **The frame:** `title="Friends"`, `referrerpolicy="origin"`, `allow="storage-access"`, and
  `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation"`: no top navigation,
  so the window can never move the game's page.
- **Messages** are objects `{ source: "nanoterra-friends", v: 1, type, ... }`, both ways. The window sends with `parent.postMessage(msg, <the game's origin>)`; the kit
  sends with `iframe.contentWindow.postMessage(msg, <nano133's origin>)`. Both sides check `event.origin` and `event.source`. A message with another `source`, another
  `v`, another type or a bad field is ignored. **No message carries an address, a pass or a player id.**

| Direction | `type` | Fields | What the other side does |
|---|---|---|---|
| window → game | `ready` | | the window has loaded. The kit answers at once with `where`, then `open` or `closed` (it sends nothing before `ready`). |
| window → game | `size` | `height` (CSS pixels its content needs) | the kit sets the frame's height to it, at most the panel's own height |
| window → game | `badge` | `online`, `requests` (each 0 to 99) | the key's badge shows the requests (the thing to do) when there are any, else the friends online in the gem colour; "9+" from 10. The key's name says both ("Friends, 2 requests, 5 online"). |
| window → game | `join` | `url` | the player chose Join on a friend. The kit asks "Leave this game to join your friend?" (the window sends no name), then calls `onJoin(url)`, or goes to the address when there is no `onJoin`. |
| window → game | `signin` | | the window needs a tap for Storage Access, inside itself. The panel stays as it is; the kit does nothing else. |
| game → window | `where` | `where` (text or null) | after `ready`, and again on each `setWhere` |
| game → window | `open`, `closed` | | after `ready` (after `where`), and when the panel opens or closes |

- **`where` is plain text, and friends see it.** The kit removes control characters, trims it and cuts it to 64 characters before it sends it; it may send null (no
  place). The site does the same again and shows it as text only.
- **Join:** `url` is **https only** (no user name or password in it): an island friend gives `https://nano133.com/nanoterra?room=<code>`, a friend in a game gives that
  game's listed address.
- **Safari, and any browser that blocks third-party cookies:** the window needs one "Show my friends" tap (the Storage Access API) on each page load of the game
  before the player shows online there (the window says `signin` when it shows that tap). Chrome with third-party cookies on needs none.

### The game's own list

The server part, `@nano133/nanoterra/friends`, has no database and reads no cookie: **the game gives a store, a directory of its players and its signed-in player**.

```ts
import { createFriendsHandler } from "@nano133/nanoterra/friends";
import { createD1Friends } from "@nano133/nanoterra/friends/d1";

const friends = createFriendsHandler({
  store: createD1Friends(env.DB),                  // or createFirestoreFriends(getFirestore()), or createMemoryFriends() for a test
  directory: {
    byName: (name) => findPlayerIdByName(name),    // your players: an id for a name, or null
    names: (ids) => namesOf(ids),                  // a Map of id -> the name to show
  },
  player: (req) => signedInPlayerId(req),         // YOUR player's sign-in (not the admin's): an id, or null
  base: "/friends",                                // the default
});
const answer = await friends.handle(request);      // null when the request is not for /friends
if (answer) return answer;
```

- `GET /friends` gives `{ showOnline, people }`: one row a person, `{ edge, name, state, online, where, invite }`, `state` one of `"friend"`, `"incoming"`,
  `"outgoing"`, `"blocked"`. **No answer holds a player id:** a row names a player by the directory's name and an opaque `edge`.
- `POST /friends` takes one `{ op, ... }`: `request { name }`, `accept`, `decline`, `remove`, `block`, `unblock { edge }`, `invite { edge, where }`, `pulse { where, lease }`
  (`where` null: this tab leaves) and `visibility { showOnline }`. It answers the new view (a pulse answers `{ ok: true }`), or `{ error }` with words a player can read.
- A visitor who is not signed in gets 401. A POST must come from the game's own page and a read must not come from another page (403). Each player has 30 calls a
  minute (429); a body is at most 1 KB. A fault in the store is a plain 500 that shows nothing of it (`onError` hears it).

**The rules** (every store keeps them; `friendsStoreConformance` proves it):

- A pair of players has at most one edge: a request (from one of them), a friendship or a block. A request to a player who already asked you is an accept.
- **A block wins** over a friendship or a request, and hides the pair from the player who is blocked, both ways. The player who blocked sees a "blocked" row, to
  unblock it; unblock leaves no edge (not friends again). Neither can ask while a block stands.
- `FRIEND_LIMIT` (100) live rows a player (friends, requests both ways, blocks): a full list refuses a new request, on either side.
- A request nobody answers goes after `FRIEND_REQUEST_MS` (30 days): not shown, not counted.
- An invite is only between friends, and the friend sees it for `FRIEND_INVITE_MS` (10 minutes). Its place is plain text, cut to 64 characters.
- A friend is online only for `FRIEND_LIVE_MS` (2 minutes) after a pulse, and only while they show online. A pulse carries a lease for each tab, so an old tab that
  leaves cannot clear a newer tab's place.
- `forget(player)` (for "Delete my data") leaves no row of the player.

**The stores.** Each writes ONLY its friend rows, presence rows and the show-online choice:

- **D1:** add `@nano133/nanoterra/friends/d1.sql` to your migrations (the tables `friend_edges`, `friend_presence`, `friend_prefs`). D1 has no transaction that reads and
  then writes, so each write is one statement with its own check: a change says which `rev` it read (a row that changed in between is refused, 409, "Try again"), and a
  new edge counts both players' rows in the same INSERT.
- **Firestore:** `createFirestoreFriends(db, { edges, presence, prefs })` (the default names `friend_edges`, `friend_presence`, `friend_prefs`). A pair is one document named
  by a SHA-256 digest, so two requests at the same moment meet in their transactions; the indexes Firestore makes by itself are enough.
- **Your own database:** write a `FriendsStore` and run the rules on it:

```ts
import { friendsStoreConformance } from "@nano133/nanoterra/friends/conformance";
for (const c of friendsStoreConformance(async () => ({ store: newEmptyStore(), dump: () => allRowsAsText() }))) it(c.name, c.run);
```

**The panel in `"own"` mode** reads the view at once, every 20 s while open and every 60 s while closed (for the badge), pulses every 45 s while it has a `where`, and
sends a leaving pulse when the page goes away. It draws Requests (Accept, Decline), Friends (online and the place, Invite to your `where`, Join an invite when you
give `onJoin`, Remove, Block), Sent (Cancel) and Blocked (Unblock), an add-by-name field and the "show friends when I am online" choice. The game's own friends have
no live connection: only Nanoterra's do.

## Moving from the three old packages

| Before | Now |
|---|---|
| `npm i @nano133/character` | `npm i @nano133/nanoterra three` |
| `import { createCharacter } from "@nano133/character"` | `import { createCharacter } from "@nano133/nanoterra/character"` |
| `import { defaultLook, isLook, LOOK_PARTS } from "@nano133/character"` | `import { defaultLook, isLook, LOOK_PARTS } from "@nano133/nanoterra/character/record"` (no Three.js) |
| `createCharacter({ look })` | the same; or `createCharacter({ record })` for the whole character |
| `scene.add(c.object, c.shadow)` | `scene.add(c.object)`: the shadow is a disc in the body and stays on the ground by itself (`c.shadow` is gone) |
| `c.setLook({ ...look, shirt: "#c8461a" })` (a colour not on the island's lists) | `c.setColors({ shirt: "#c8461a" })`. `setLook` takes a record or the five colours of the lists |
| `import { readTicket } from "@nano133/ticket"` | `import { readTicket } from "@nano133/nanoterra/ticket"`: the same answer, and `ticket.record` when the ticket has one |
| `import { checkLooks } from "@nano133/looks"` | `import { checkLooks } from "@nano133/nanoterra/looks"` |

## What it does NOT do yet

- The island's item art (see "Worn things and sockets"): a game brings its own things.
- A pose for a held thing: the arms swing free, so a two-handed thing (a `grip_L` as well as a `grip_R`) is held in the right hand only.
- The katana, the saya, the headband and the dojo look of the island's Ananos game. (The skeleton keeps their bones, with no vertices.)
- First-person arms, swimming, climbing, sitting and the room's other moves: only idle, walk, run, jump and wave.
- Shared geometry for many characters at once, and a react-three-fiber wrapper.
- `WebGPURenderer`: the ink is a GLSL `ShaderMaterial`, so use `WebGLRenderer`.
- Any server or Nano code. This package draws a character and reads a ticket; it moves no money.

## Build and test

```sh
npm install      # at the kit's root
npm run build -w @nano133/nanoterra
npm test -w @nano133/nanoterra
```

MIT license.
