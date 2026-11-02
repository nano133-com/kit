# @nano133/nanoterra

Stage: Pre-alpha. What this means: https://nano133.com/stages

Nanoterra for your game, in **one package**. [Nanoterra](https://nano133.com/build/nanoterra) is
nano133.com's island. A player who is signed in there presses Play, and arrives at your game as
themselves. This package gives your game these things:

- **The sign-in ticket** (`/ticket`): the player's name, Nano address and character, read in the browser. No server, no secret.
- **The player's character** (`/character`): the same toon body that the player has on the island, drawn with Three.js. Six bases, faces, hair, clothes, sizes and colours.
- **The looks ladder** (`/looks`): the rules of `looks.json`, the price steps, and what a change does to the players who own a look.
- **Held input that does not stick** (`/input`, since 0.3.1): lets go of the keys and the stick when the player leaves the page, so the character never walks on by itself, and pauses a free round.
- **A friends list** (`/friends`, since 0.6.0): a Friends key that holds the player's Nanoterra friends (a nano133 window), or a full friends list of the game's own players on the game's own database, as the admin's Game card chooses.
- **An options menu** (`/options`, since 0.8.0): the game's settings as data, with defaults for each device, kept in the player's browser, and a ready Options key and panel (Basic and Advanced); common settings to opt into, and a section another module adds.
- **The player's sign-in** (`/player-signin`, since 0.9.0): a passkey (Face ID, Touch ID or the device PIN) or a wallet app (Berry Wallet, NanChat, Nautilus), the sessions and a ready sign-in sheet, for a game with a server. It needs `@nano133/signin` (an optional peer).
- **Emotes** (`/emotes`, since 0.8.0): Nano Island's eleven emotes on the player's character (the Wave, Cheer, Clap, Dance and seven more, made in Blender), and the emote wheel of eight that the player picks, which also plays a game's own animations.
- **A shop** (`/shop`, since 0.9.0): sells looks for Nano (XNO) straight to the creator's address, with no key on the server: the routes, the payment check, D1 and Firestore stores, and the Looks and pay sheets (QR code, test mode stamp).

It replaces `@nano133/character` 0.1.0, `@nano133/ticket` 0.1.0 and `@nano133/looks` 0.1.0
(see "Moving from the three old packages"). The signature checks, checkout and late returns stay in their own packages
([`@nano133/signin`](../signin), [`@nano133/checkout`](../checkout), [`@nano133/late-returns`](../late-returns)).

nano133.com's island and its 3D room draw the player with **this same code**: the geometry, the skeleton, the colours and the record
are one source. A game made with this package shows the character exactly as the island does.

Pre-alpha means: the shape of the API may still change, and the character has not been run on a real phone yet.

## Install

```sh
npm install @nano133/nanoterra three
```

`three` is an **optional** peer dependency (`>=0.174.0`). A game that only reads a ticket does not need it. `@nano133/signin` is the other optional peer:
only the player's sign-in (`/player-signin`) needs it (`npm install @nano133/nanoterra @nano133/signin`).

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
| `@nano133/nanoterra/input` | let go of held keys and sticks when the player leaves the page, and pause: `releaseWhenLost`, `pauseWhenLeft`, `swallowsKeyup` (since 0.3.1); the camera's distance on one curve: `createZoom`, `listenZoom` (unreleased) | no | 0.5 kB, 1.0 kB more with the zoom |
| `@nano133/nanoterra/admin` | the admin of a game: the guard, the handler, the store type (server code; since 0.2.0) | no | 3.7 kB |
| `@nano133/nanoterra/admin/d1`, `/admin/firestore` | the admin store for D1 (the starter's tables) or Firestore (a small interface, no Firebase dependency): `createD1Store`, `createFirestoreStore` (since 0.2.0) | no | 1.5 kB each |
| `@nano133/nanoterra/admin/panel` | the admin page, drawn in the browser into one element, and its stylesheet `@nano133/nanoterra/admin/style.css` (since 0.2.0) | no | 18.9 kB with the tabbed layout (10.6 kB on 0.3.0, 8.5 kB on 0.2.0) + 5.9 kB of CSS (minified) |
| `@nano133/nanoterra/admin/conformance` | test cases that a game runs against its own admin (a dev dependency in practice; since 0.2.0) | no | n/a |
| `@nano133/nanoterra/admin-signin` | the admin's wallet sign-in on one fixed route, `/api/admin-signin`: the routes, `session(request)` for the admin handler, "Sign out everywhere", the sign-in list, a memory store, and (since 0.12.0, `passkeys: true`) the owner's linked passkeys (server code; it needs `@nano133/signin`; since 0.11.0) | no | 6.9 kB without `@nano133/signin` |
| `@nano133/nanoterra/admin-signin/d1`, `/admin-signin/firestore` | its store on D1 (the starter's own tables; a new game adds `/admin-signin/d1.sql`) or Firestore (a small interface, no Firebase dependency) (since 0.11.0) | no | 1.9 kB, 2.2 kB |
| `@nano133/nanoterra/admin-signin/panel` | the admin's sign-in in the browser, for `mountAdmin`'s `signIn` and `signOut`: `adminSignIn()`, `adminSignOut()`, with its own QR code, and (since 0.12.0) the Passkey tile and the `ownerPasskeys()` card (the passkey code loads only at a passkey's use); its stylesheet `@nano133/nanoterra/admin-signin/style.css` is the player sheet's (since 0.11.0) | no | 9.3 kB |
| `@nano133/nanoterra/admin-signin/conformance` | the store's rules as test cases, for a store a game writes itself (since 0.11.0) | no | n/a |
| `@nano133/nanoterra/friends` | the game's own friends list: the handler, the rules, a memory store (server code; since 0.6.0) | no | 3.7 kB |
| `@nano133/nanoterra/friends/d1`, `/friends/firestore` | the friends store for D1 (with the migration `/friends/d1.sql`) or Firestore (a small interface, no Firebase dependency): `createD1Friends`, `createFirestoreFriends` (since 0.6.0) | no | 3.0 kB each |
| `@nano133/nanoterra/friends/panel` | the Friends key and panel: the nano133 window, or the game's own list, and its stylesheet `@nano133/nanoterra/friends/style.css` (since 0.6.0) | no | 5.0 kB + 4.8 kB of CSS (minified) |
| `@nano133/nanoterra/friends/conformance` | the friends rules as test cases, for a store a game writes itself (since 0.6.0) | no | n/a |
| `@nano133/nanoterra/options` | the options store (no DOM), the common settings, `reflectOptions` and the panel's `mountOptions` (since 0.8.0) | no | 2.9 kB (`createOptions` alone), 8.7 kB (all) |
| `@nano133/nanoterra/options/panel` | the Options key and panel alone, and its stylesheet `@nano133/nanoterra/options/style.css` (since 0.8.0) | no | 2.3 kB of CSS (9.4 kB minified) |
| `@nano133/nanoterra/emotes` | the emotes' list, the wheel's eight places, the multiplayer message and the player's options: no DOM, no Three.js (since 0.8.0) | no | 1.4 kB |
| `@nano133/nanoterra/emotes/player` | the emotes on the kit's character: `createEmotes`, `playRemote`, `loadEmotes` (since 0.8.0) | yes | 2.9 kB; the clips load on the first emote, a chunk of their own: 84 kB, 18.8 kB gzip |
| `@nano133/nanoterra/emotes/wheel` | the Emotes key and the emote wheel: `mountEmotes`, and its stylesheet `@nano133/nanoterra/emotes/style.css` (since 0.8.0) | no | 5.9 kB + 7.4 kB of CSS (minified); the pictures (`/emotes/icons.webp`, 34 kB) load when the wheel first opens |
| `@nano133/nanoterra/player-signin` | the player's sign-in: the handler, the sessions, `player(request)`, `forget`, a memory store, `schemeVector` (server code; it needs `@nano133/signin`; since 0.9.0) | no | 5.1 kB without `@nano133/signin` |
| `@nano133/nanoterra/player-signin/d1`, `/player-signin/firestore` | the store for D1 (with the migration `/player-signin/d1.sql`) or Firestore (a small interface, no Firebase dependency) (since 0.9.0) | no | 1.2 kB, 1.3 kB |
| `@nano133/nanoterra/player-signin/panel` | the sign-in sheet, and its stylesheet `@nano133/nanoterra/player-signin/style.css` (since 0.9.0) | no | 8.7 kB with `@nano133/signin/passkey` + 8.1 kB of CSS (minified); the purse's signing code loads at a passkey sign-in, a chunk of its own: 39.8 kB gzip |
| `@nano133/nanoterra/player-signin/conformance` | the store's rules as test cases, for a store a game writes itself (since 0.9.0) | no | n/a |

| `@nano133/nanoterra/shop` | the shop's rules and routes, the payment scan, a memory store, the CSP lists (server code; since 0.9.0) | no | 9.1 kB (all), 7.1 kB (`createShopHandler` alone) |
| `@nano133/nanoterra/shop/d1`, `/shop/firestore` | the shop's store on D1 (the starter's tables, `/shop/d1.sql`) or Firestore: `createD1Shop`, `createFirestoreShop` (since 0.9.0) | no | 2.4 kB, 2.2 kB |
| `@nano133/nanoterra/shop/worker` | the shop for a Worker with D1, from the starter's settings: `createShop` (since 0.9.0) | no | 10.0 kB (with the D1 store and Turnstile) |
| `@nano133/nanoterra/shop/panel` | the Looks key, the looks sheet and the pay sheet with its own QR code: `mountShop`, and its stylesheet `@nano133/nanoterra/shop/style.css` (since 0.9.0) | no | 10.0 kB + 2.5 kB of CSS (gzip; 8.5 kB minified) |
| `@nano133/nanoterra/shop/conformance` | the shop's money rules as test cases, for a store a game writes itself (since 0.9.0) | no | n/a |

Measured 2026-10-26 (the friends paths 2026-10-30, the options, the emotes, the player sign-in and the shop paths 2026-11-01): `esbuild --bundle --minify --format=esm --external:three`, then `gzip -9`, without Three.js.
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

## The camera's distance (`@nano133/nanoterra/input`; unreleased)

One number, the camera's distance from the eyes, moved by the mouse wheel, a trackpad's two-finger scroll or pinch, a two-finger pinch on a touch screen
and the + and − keys, along ONE curve: nano133.com's island feel. Each notch moves `0.35 + 0.14 × distance` metres, so a notch feels the same near and
far, and every bit of a scroll counts (Echo Island's wheel had a dead zone and a speed limit, dropped most of a quick spin and needed about five times the
spins). The last notch in goes to the eyes and the first notch out goes past the switch, so the camera never rests half inside the head.

```ts
import { createZoom, listenZoom } from "@nano133/nanoterra/input";

const zoom = createZoom({ max: 10, start: 5.2, first: 0.6 }, { read: () => saved(), write: (d) => save(d) });
listenZoom(zoom, renderer.domElement, { skip: () => paused });   // the wheel over the canvas, + and − on the window
// each frame: the distance eases to the one asked for (at once with reduced motion)
const dist = zoom.step(dt, lessMotion);
const firstPerson = zoom.eyes();
```

- `read` is called the first time the distance is asked for (never on the server); `write` on every change: put a delay in it if your storage is slow.
- `listenZoom` stops the page's scroll and zoom over the canvas. A key with ctrl, alt or the command key (the browser's zoom) and a key typed in a field are
  left alone; `skip(e)` keeps any other event from the zoom (a key the player is binding).
- The touch pinch is yours to wire, because the fingers are also your stick and your look: `pinchStart(spread)` when the second finger lands, `pinch(spread)`
  as they move, `pinchEnd()`. Twice the spread divides `distance + 2.5` by 2^1.3, wherever the camera is: the wheel's curve.
- `set(d)` for a setting (a slider, a First person card), `subscribe(on)` for a menu that shows the distance. The pure parts (`wheelNotches`, `zoomedBy`,
  `pinchedTo`) are there for a test.

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
  priceUsd: number; // US dollars, at most 4 decimals (0.005 is half a cent; since 0.10.0); 0 is the free look
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
| `PRICE_LADDER`, `rungOf(usd)`, `priceText(usd)` | The six steps nano133.com uses, from 1¢ to $1, and a price as a page writes it (`0.5¢`, `25¢`, `$1.10`). |
| `usdText(usd)`, `usdDecimals(usd)`, `priceStepOk(usd)`, `PRICE_STEP_USD`, `wholeCents(usd)`, `HATS` | `"$0.25"`, `"$0.005"` (2 to 4 decimals); the same without `$`, as an order keeps it; whether a price has at most 4 decimals (the looks rule since 0.10.0); `0.0001`, the smallest price above 0; whether a price has no fraction of a cent; the hats. |
| `sameSlots(a, b)`, `cleanSlots(slots)`, `slotValueOk(v)`, `SLOTS_MAX` | Whether two looks have the same slots; a clean copy (none when empty); whether a value is a word or a colour; 8. |

| Step | Price | For |
|---|---|---|
| dye | 1¢ | a colour |
| charm | 2¢ | a small mark or a badge |
| piece | 5¢ | one worn thing, like a hat or a scarf |
| statement | 25¢ | a bigger piece that people notice |
| set | 50¢ | a few pieces that go together |
| outfit | $1 | a whole look |

The ladder is a suggestion. Any price with at most 4 decimals, up to $1000, is good: there is no minimum, so a fraction of a cent works ($0.005, $0.0001;
since 0.10.0, before it whole cents). The shop rounds the Nano amount up to a step of 0.0001 XNO and asks for at least one step, so a creator never gets
less than the price. `priceStepOk` and `wholeCents` compare a price with its own decimal text (the starter's old check, `Math.round(x * 100) === x * 100`,
refused $0.07, $0.29, $0.57 and $1.10 because of floating point).

## The admin (`/admin`; since 0.2.0)

The admin of a game that sells Nanoterra looks for Nano, in the package: one panel for the game, its looks and its orders. It has two parts that never load each other:
the **server part** (`/admin`: the guard, the routes and a test suite) and the **panel** (`/admin/panel`: the page, drawn in the browser). Neither has Three.js. The package has no
database and reads no cookie: **the game gives a session and a store**.

```ts
import { createAdminHandler } from "@nano133/nanoterra/admin";

const admin = createAdminHandler({
  store,                                   // your database: readSettings(), saveSettings(patch, now), summary(now)  (a memory store is in the package, for tests)
  defaults: { character: "nanoterra", signin: "exchange", friends: "nanoterra", emotes: "on" },   // what the switches are until /admin sets them (your game.config.json; friends and emotes may be left out)
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
nothing of the fault (`onError` hears it). The only writes are the four settings (and, when the game turns on the sign-in list, the deletion of the admin sessions), **never a look, a price or an order**: a change of looks stays a change of your repository.

**Your own routes read the switches** with `loadGameSettings(store, defaults)` (for the listing file's `signin` word, the character, the friends list and the emotes): the stored word, else your default,
and your defaults when the store fails.

**The conformance suite** proves your whole chain, not only the guard: the cookie you read, the session lookup, the owner you pass.

```ts
import { adminConformance } from "@nano133/nanoterra/admin/conformance";

const host = { routes: admin.routes, basePath: admin.basePath, origin: "https://game.example", request: (who, req) => sendAs(who, req) };
for (const c of adminConformance(host)) it(c.name, c.run, c.timeoutMs);   // vitest; node:test: test(c.name, { timeout: c.timeoutMs }, c.run)
```

Pass `c.timeoutMs`: the heavy cases (other spellings of a path, a request from another page, OPTIONS and HEAD) each send every visitor with every
method, a few hundred requests, and say they may need `HEAVY_CASE_MS` (120 s) on a slow machine. They are one case for each route (since 0.10.1),
so a game with many routes has many short cases, not one long one.

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
guard is a fault only if you list it. **What the suite cannot see:** the code that CREATES admin logins (your wallet sign-in). Test that separately (the sign-in chain contract above;
the package's own sign-in, `/admin-signin`, passes it): only a wallet signature started from the admin may make an admin login, and never from another sign-in. A security read found these gaps in the first version of this suite, and each one is a test now.

### The store (an adapter for your database)

`createAdminHandler` needs a store: three calls, `readSettings()`, `saveSettings(patch, now)` and `summary(now)`. Two adapters come with the package, and **both write only the four settings** (the D1 store also deletes the admin sessions, but only when the game turns on the sign-in list: see below)
(`setting:character`, `setting:signin`, `setting:friends` and `setting:emotes`); every other call they make is a read. Both must pass the same **store contract**, `adminStoreConformance(make)` in
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
The Firestore store does not have them yet (a game's sessions are its own): a game with Firestore gives it the admin sign-in's (`store.recentLogins = signin.recentLogins;
store.signOutEverywhere = signin.signOutEverywhere`, see "The admin's sign-in"), or writes its own.

### Later ideas (not built)

- **A second signature for a write.** The only server write the admin makes is the sign-in switch (and the Shelf never writes), so asking the owner to sign again for each press adds friction for
  little gain. A later version could ask for it if the admin ever writes more.
- **An optional passkey for the admin, bound to the domain.** Built in 0.12.0: see "A passkey for the owner" under "The admin's sign-in". A passkey (WebAuthn) belongs to the domain it was
  made for, so a sign-in request that a stranger relays to the owner from another page cannot be answered with it. The owner's wallet stays the way to make the first admin login, to link a
  passkey and to recover.

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
look, with their looks. **Settings**: the **Game** card (the character and sign-in switches, the friends list's three-way choice and "Allow Nanoterra emotes"), the Sign-ins card and the facts (the address, the mode, the nodes, the last price). The tabs are
real tabs (the arrow keys, Home and End work); every tab is made once, so a draft, a search and a switch keep their state, and the panel never writes the page's address.
A visitor who is signed out gets the game's sign-in; a wrong wallet, a Nanoterra sign-in and a missing owner address each get their own screen and see no data (a sign-out
takes the drawn data off the page). Options: `api` (the handler's base path), `noAddressHelp`, `lookPicture(look)` (your own picture of a look for the Shelf), `repoHelp`,
`loginsNote`, `playerPasskeys` (the game offers its players a passkey: on `*.workers.dev` the banner says that passkeys turn on with the game's own
domain), `cards` (since 0.12.0: cards of the game's own for Settings, after Sign-ins, `{ el, refresh? }`; `refresh()` runs at each sign-in; the owner's passkeys
card is one) and `fetch`.

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

The panel never signs anyone in: `signIn` draws the sign-in. Since 0.11.0 the package has one, `adminSignIn()` from `@nano133/nanoterra/admin-signin/panel` (see "The admin's
sign-in"); a game with its own keeps giving its own.

**Light and dark** (since 0.7.0). The top bar has a theme key (44 px, a half circle, a sun or a moon; its name says the choice: "Theme: Dark", "Theme: Device (dark
now)"). A press opens a menu of three: **Device** (the default: it follows the device's setting, `prefers-color-scheme`, and a live change of it), **Light** and **Dark**.
The signed-out screen has the same key. The choice is kept in this browser only, in `localStorage` under `n133-admin-theme`: no server call and no admin setting. A
browser that refuses storage (some private windows) reads Device, and a choice there holds for the page.

The panel gets `data-theme="light"` or `"dark"` on its root element and sets `color-scheme` to match (form controls, scroll bars, the colour picker). Every colour of the
stylesheet is a variable with a hook: `--n133-<name>` sets the light value, as before, and its twin `--n133-dark-<name>` sets the dark value. The names: `ink`,
`ink-soft`, `paper`, `ground`, `line`, `gem`, `gem-dark` (the green of text and marks), `on-gem` (text on a green fill), `sea` (links and the focus ring), `warn`, `bad`,
`ok-bg`, `ok-ink`, `info`, `info-bg`, `info-ink`, `warn-bg`, `bad-bg`, `bad-ink`, `neutral-bg`, `neutral-ink` (the badges and chips), `note-bg`, `note-line`, `note-ink`
(the "Check these" banner and the draft note), `alarm-bg`, `alarm-ink` (a late payment, a card's problems, Sign out everywhere), `quiet`, `violet`, `changed` (the accents
of the numbers and of a changed look), `stage` (the backdrop of a look's picture), `tint-empty`, `swatch-empty`, `swatch-edge`, `code-bg`, `code-ink`, and `shadow`
(`--n133-dark-shadow`). The dark defaults keep body text at 4.5:1 or more on the dark paper (most pairs are 7:1 or more).

**The page around the panel.** While the panel is mounted, `mountAdmin` also sets `data-n133-theme="light" | "dark"` on the page's `<html>`, so your page can follow it
with CSS alone. `destroy()` (on what `mountAdmin` returns) stops following the device and takes the attribute off. `theme` on the same object reads and sets the choice
(`theme.choice`, `theme.resolved`, `theme.set("dark")`, `theme.onChange(fn)`). The starter's `src/client/admin.css`:

```css
html[data-n133-theme="dark"]:has(.admin-page) {
  --ink: #e7edf5; --ink-soft: #a9b5c5; --paper: #171f2b; --line: #303c4e; --gem-dark: #3fd8b6; --sea: #62bcec;
  color-scheme: dark;
}
html[data-n133-theme="dark"]:has(.admin-page),
html[data-n133-theme="dark"] body.admin-page {
  background: #0f151e;
}
```

The pictures: a look's flat picture and the character previews (`createLookPreview` draws with a clear background) stand on the `stage` colour, which is a mid grey
blue in dark, so a dark outfit and the outlines still show. The panel draws no QR code.

## The admin's sign-in (`/admin-signin`; since 0.11.0)

The wallet sign-in that makes the ADMIN login, in the package, on **one fixed route in every game: `/api/admin-signin`** (`ADMIN_SIGNIN_BASE`). Before it, every game put it
somewhere else (the game starter: `/api/signin` with `scope: "admin"` in the body; AI helpers: their own `/api/admin-signin`). It is the game starter's admin sign-in moved into
the package, **with every check and every signed text unchanged**; only the paths are new. The checks are `@nano133/signin`'s (install it with this package).

```ts
// The Worker (D1)
import { createAdminSignin } from "@nano133/nanoterra/admin-signin";
import { createD1AdminSignin } from "@nano133/nanoterra/admin-signin/d1";
import { createAdminHandler } from "@nano133/nanoterra/admin";
import { createD1Store } from "@nano133/nanoterra/admin/d1";

const adminSignin = createAdminSignin({
  store: createD1AdminSignin(env.DB),           // the starter's own tables: no migration (a new game adds "@nano133/nanoterra/admin-signin/d1.sql")
  owner: receiveAddress(env),                    // the game's own address, or null: ONLY it makes an admin login
  limit: (key, n, ms, now) => d1Limit(env.DB, key, n, ms, now),   // optional: your limiter for the starts (default: this copy's memory)
  visitor: (req) => visitorKey(env.DB, req),     // optional: a keyed hash of the IP address
  personCheck: (token, req) => turnstileCheck(env, token, req.headers.get("CF-Connecting-IP")),   // optional (Turnstile)
});
const admin = createAdminHandler({
  store: createD1Store(env.DB, { logins: true }),   // the Sign-ins card and "Sign out everywhere", on the same tables
  defaults, owner: receiveAddress(env),
  session: (req, now) => adminSignin.session(req, now),   // the ADMIN cookie only
  status, lookName, check,
});
const answer = (await adminSignin.handle(request)) ?? (await admin.handle(request));   // null: not theirs; the game goes on
// the cron: await adminSignin.clean();

// The admin page
import { mountAdmin } from "@nano133/nanoterra/admin/panel";
import { adminSignIn, adminSignOut } from "@nano133/nanoterra/admin-signin/panel";
import "@nano133/nanoterra/admin/style.css";
import "@nano133/nanoterra/admin-signin/style.css";
mountAdmin(el, { looks, signIn: adminSignIn({ personCheck }), signOut: adminSignOut() });
```

| Route (`base` "/api/admin-signin") | Who calls it | What it does |
|---|---|---|
| `POST {base}/start` `{ way, turnstile? }` | the admin page | starts an admin request (`way` "berry", the default, or "nautilus"): `{ way, id, link, walletLink?, code?, expiresAt }` and the starter cookie `starter-admin` (30 minutes) |
| `GET`, `POST {base}/nano/:id` | Berry Wallet | reads the request; posts its signature (204 and no body when accepted, 401 and the words when refused) |
| `POST {base}/nautilus?id=` | Nautilus | its signature (always 200: Nautilus shows only a 200's words) |
| `POST {base}/nanchat` | NanChat's relay server | only with `nanchat: true` (else no route): its signature (always 200; a refusal starts "NOT signed in") |
| `POST {base}/check` `{ id, way }` | the admin page, every 2 s | `{ status }`: `waiting`, `expired`, `elsewhere`, `used`, `not_owner` (with `address`: another wallet signed; no login, the request stays unused), or `signedin` with `address` and the admin cookie |
| `POST {base}/signout` | the admin page | ends this browser's ADMIN login only: `{ ok: true }` |

**What the wallet signs names the ADMIN**, so a link that a stranger sends to the owner does not look like any sign-in. Berry Wallet signs the page `https://<host>/admin`
(`page`, with **no query**: Berry refused `/admin?from=US`); Nautilus signs the label `ADMIN of <host> sign-in ABCD-EFGH from <country>` and shows "Sign in to the ADMIN of
<host>. Started <time> UTC from <country>. If you did not start this, do not sign." It names the owner's address (no key, no payment). An admin request **lives 2
minutes**, is delivered for **one more minute**, and works **once**; only the browser that started it gets the login.

**NanChat is OFF by default.** Its text must start "Login to <host>" and **cannot name the ADMIN**, so the owner who is asked to sign cannot tell an admin sign-in from a game
sign-in. A start with `way: "nanchat"` is refused: "NanChat cannot open the admin yet. Use Berry Wallet or Nautilus." A game may turn it on with `nanchat: true` (and the
panel's `nanchat: true`): it then signs "Login to <host>" as a player's NanChat sign-in does, with the same admin checks, and the panel says that its text cannot say ADMIN.
**Berry Wallet is first** in every list of wallets. A passkey opens /admin only when the owner linked it (`passkeys: true`, see "A passkey for the owner" below).

**The two logins stay apart, on the server.** The admin login is its own cookie, `admin` (`__Host-admin` on https; HttpOnly, SameSite=Lax, **one day**), beside the player's
`session`, so the game and /admin can have different people signed in at once. The database keeps the SHA-256 of `"admin:"` and the token (`adminKey`), and the player's
session its plain hash: a player's token put in the admin cookie opens nothing, a player's starter copied to `starter-admin` finishes nothing, and an admin request never
makes a player's login (the store reads only its own scope's rows). **Only the game's own address (`owner`) makes an admin login**; the guard (`adminAccess`) decides again
on every call of /admin. `session(request)` gives `{ address, createdAt, via }` (a stored word other than `"wallet"`, `"nanoterra"` or `"passkey"` is `"unknown"`: refused;
a `"passkey"` session also carries `linkedTo`, only while its link exists: see below).

**What it keeps.** Each admin login writes one row of the sign-in list: the time, the country of Cloudflare's country header (two letters, or none) and a short browser
name from fixed lists ("Chrome on macOS"): no address, no IP and no browser text. A row is kept 30 days. `signOutEverywhere()` deletes every admin login and ends every admin
request that was not delivered; `recentLogins(limit)` reads the list (give both to an admin store that has neither: the Firestore one, or the memory one in a test).

**The stores** read and write only their three tables or collections, and only the admin's rows:

- **D1:** `createD1AdminSignin(env.DB)` works on the game starter's own tables and columns: `signin_requests` (`scope = 'admin'`), `sessions` (`scope = 'admin'`)
  and `admin_logins (id, at, country, browser)`. **The starter needs no migration**, and every creator who is signed in stays signed in. A new game adds
  `@nano133/nanoterra/admin-signin/d1.sql` to its migrations (the same tables, `CREATE TABLE IF NOT EXISTS`; beside the player sign-in's d1.sql it adds only `admin_logins`).
  "Sign out everywhere" is the same two statements as `createD1Store(db, { logins: true })`. Other table names: `createD1AdminSignin(db, { requests, sessions, logins })`.
- **Firestore:** `createFirestoreAdminSignin(db, { requests, sessions, logins })` (default `signin_requests`, `sessions`, `admin_logins`; the player sign-in's
  adapter keeps its own documents in the first two with `scope: "play"`). Each document carries `deleteAt`: set a TTL policy on it.
- **Your own database:** an `AdminSigninStore` that passes `adminSigninStoreConformance` from `@nano133/nanoterra/admin-signin/conformance`. The whole chain (the
  player's sign-in and the admin's, side by side) passes `adminSigninConformance` from `@nano133/nanoterra/admin/conformance`: the package runs it on the memory store and on D1,
  with Berry Wallet, Nautilus and NanChat turned on.

**The rest:** `base` (keep the default), `page` (default `/admin`), `domain` (the host every text names; a call to another host is refused), `cookies`
(default `{ session: "admin", starter: "starter-admin" }`), `now`, `onError`. Starts: 20 in 10 minutes per visitor (the player's key: one count for both);
checks 90 a minute and the wallets' calls 30 a minute per IP address. **The panel** (`adminSignIn(options)`, `adminSigninView(options)`, `adminSignOut(options)`): the
wallets as tiles, on a phone one key that opens the app, on a computer a QR code (the package's own; a link that is too long for it, Nautilus's, shows as a link), the
check every 2 seconds, and `done()` once the owner has signed in. Options: `base`, `nanchat`, `personCheck(box)`, `qr(text)`, `touch`, `fetch`. Text 16 px, keys 48 px.

**Moving the game starter onto it:** use `createD1AdminSignin(env.DB)` (no migration), answer `adminSignin.handle(request)` before the player's sign-in, give the admin handler
`session: adminSignin.session`, and in `admin.ts` `signIn: adminSignIn(...)`, `signOut: adminSignOut()`. The player's sign-in then needs no `sharedPaths`, and
`src/worker/signin.ts` and `src/client/ui/signin.ts` go. Old requests started on `/api/signin` with `scope: "admin"` are 2 minutes long: none outlive the deploy.

### A passkey for the owner (since 0.12.0)

The owner may **link passkeys** to the game's address (at most 10, `ADMIN_PASSKEY_LIMIT`) and then open /admin with Face ID, Touch ID or the device PIN, without
the wallet. **A passkey is only a key to /admin: the money stays in the owner's wallet.** It is off unless the game turns it on.

**The security rule, in plain words.** A link counts only when each side proves its key, as nano133.com's account links do:

1. **Only the owner's wallet writes a link.** `POST {base}/passkey/link` needs a live admin session made by the **wallet** of the game's own address. A passkey's
   session cannot add a passkey, and neither can a player's login, a Nanoterra sign-in or another wallet.
2. **The passkey proves its key** in the same call: its purse signs `Link this passkey to the ADMIN of <host>: sign in as <address> at <ms>`.
3. **A linked passkey opens /admin** with its own signature of `ADMIN of <host>: sign in as <address> at <ms>`. It never names the host alone: a player's passkey
   signature (`<host>: sign in as ...`) never opens /admin, a link signature is not a sign-in, and a sign-in signature links nothing. Each signature counts
   **once** (the admin's own table) and within **5 minutes**.
4. **The link is read on every request**, with the **current** owner address. Remove the link, or change the game's address, and the passkey's access ends at
   the next request; a removal also deletes that passkey's admin sessions. The guard's one new rule (Wes, 2026-11-01): a session with `via: "passkey"` opens
   /admin only with `linkedTo` equal to the owner address, and `session(request)` sets `linkedTo` only after it read the link. Every other check (the owner
   address, one day, the clock) is the same as for the wallet.

```ts
// The Worker: the same createAdminSignin, with passkeys on
const adminSignin = createAdminSignin({ store: createD1AdminSignin(env.DB), owner: receiveAddress(env), passkeys: true, limit, visitor, personCheck });

// The admin page: the Passkey tile in the sign-in, and the "Owner passkeys" card in Settings
import { mountAdmin } from "@nano133/nanoterra/admin/panel";
import { adminSignIn, adminSignOut, ownerPasskeys } from "@nano133/nanoterra/admin-signin/panel";
import { SCHEME } from "./scheme";   // the game's FROZEN passkey scheme: the same one the player sheet takes
mountAdmin(el, {
  looks,
  signIn: adminSignIn({ personCheck, passkeys: true, scheme: SCHEME, name: "My Game" }),
  signOut: adminSignOut(),
  cards: [ownerPasskeys({ scheme: SCHEME, name: "My Game" })],
});
```

| Route (with `passkeys: true`) | Who may call it | What it does |
|---|---|---|
| `POST {base}/passkey/link` `{ address, at, signature }` | a live **wallet** admin session of the owner | links the passkey that signed the link text: `{ ok, address, passkeys, limit, via, canChange, you }`; 409 `full` or `exists` |
| `POST {base}/passkey/unlink` `{ address }` | a live **wallet** admin session of the owner | removes the link and ends that passkey's admin sessions: `{ ok, removed, passkeys, ... }` |
| `POST {base}/passkeys` | any session the guard accepts | `{ passkeys: [{ address, createdAt }], limit, via, canChange, you }` (`canChange` only for the wallet) |
| `POST {base}/passkey` `{ address, at, signature, turnstile? }` | the admin page | the passkey's ADMIN signature (the person check and the start limit, like `start`); 403 `not_linked` unless linked; else a new admin session `{ via: "passkey" }` of one day, the sign-in list row and the admin cookie: `{ status: "signedin", address, linkedTo }` |

All four are POSTs from the game's own page (`Origin` checked) and are not routes at all while `passkeys` is off. The list, a link and a removal count 30 a minute
per IP address; a link and a passkey sign-in also count with the starts (`limit`, 20 in 10 minutes per visitor). A refusal of a link from a passkey's session has
`reason: "wallet_only"`. "Sign out everywhere" ends the passkeys' sessions too, and keeps the links (Remove ends one).

**The panel.** `adminSignIn({ passkeys: true, scheme, name })` adds a **Passkey** tile after the wallets ("Use my passkey"). `ownerPasskeys({ scheme, name })` is
a card for `mountAdmin`'s new `cards` option (cards of the game's own in Settings, after Sign-ins; each one's `refresh()` runs at every sign-in): the list, **Add a
passkey** ("Make a new passkey" or "Use a passkey I have") and **Remove** (two presses), both shown only with a wallet session; a passkey's session sees "Sign in
with your wallet to add or remove a passkey." The passkey code and the purse load only when a passkey is used. Text 16 px, keys 48 px. The passkey comes from the
game's frozen scheme (the player sheet's), so a passkey the owner also uses to play may be linked too: its PLAYER signature still opens nothing here.

**The store** needs the passkey methods (`createSession`, `linkPasskey`, `unlinkPasskey`, `passkeys`, `linked`, `useOnce`; the package's three stores have them, and
`createAdminSignin({ passkeys: true })` refuses a store without them); `adminSigninStoreConformance(make, { passkeys: true })` proves them. **D1** keeps them in two
new tables at the end of `d1.sql`. **A starter-shaped game adds this migration** (the starter: `migrations/0009_admin_passkeys.sql`); a game that already ran
`d1.sql` before 0.12.0 adds the same two statements:

```sql
CREATE TABLE IF NOT EXISTS admin_passkeys (
  owner TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner, address)
);
CREATE TABLE IF NOT EXISTS admin_once (
  key TEXT PRIMARY KEY,
  until INTEGER NOT NULL
);
```

Without it, the wallet sign-in and `clean()` work as before (the clean-up skips the missing table); only `passkeys: true` needs it. **Firestore** keeps one document
per owner in `admin_passkeys/{owner}` (`{ owner, passkeys: [{ address, createdAt }] }`, no `deleteAt`) and the used signatures in `admin_once/{key}` (`{ until,
deleteAt }`: add it to the TTL policy). Other names: `createD1AdminSignin(db, { passkeys, once })`, `createFirestoreAdminSignin(db, { passkeys, once })`.

## The friends list (`/friends`; since 0.6.0)

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
sends a leaving pulse when the page goes away. It draws Requests (Accept, Decline), Friends (online and the place, Invite to your `where` and Join an invite, both only when you
give `onJoin`, Remove, Block), Sent (Cancel) and Blocked (Unblock), an add-by-name field and the "show friends when I am online" choice. The game's own friends have
no live connection: only Nanoterra's do.

**Questions.** Remove, Block and (in both modes) Join ask the player first, in the panel itself: the question and a key for each answer; Escape or closing the
panel answers no. The kit never opens a browser dialog. To ask in your game's own dialog, pass `confirm(question)`, which returns a boolean or a promise of one.

## The options menu (`/options`; since 0.8.0)

A game's settings as data, kept in the player's browser, and a ready Options key and panel. A game declares its settings; the kit resolves their defaults for
the device, keeps only what the player changed, and draws them in two tabs, **Basic** and **Advanced**. A game with its own menu uses the store alone.

```ts
import { common, createOptions, keyBinding, mountOptions, reflectOptions } from "@nano133/nanoterra/options";
import "@nano133/nanoterra/options/style.css";

const options = createOptions({
  game: "my-game",                                         // the storage key is n133-options:my-game
  defs: [
    ...common("masterVolume", "musicVolume", "effectsVolume", "cameraSensitivity", "invertLook", "stickSide", "reducedMotion", "quality"),
    { kind: "toggle", key: "hints", label: "Show hints", help: "Arrows to the next gem", tab: "basic", group: "Game", default: true },
    keyBinding("jump", "Jump", "Space"),                   // keys.jump: a KeyboardEvent.code
  ],
});
music.volume = (options.get<number>("musicVolume") / 100) ** 2;
options.subscribe((key, value) => apply(key, value));      // every change: the panel, the game, a reset, a default that moved
reflectOptions(options, ["reducedMotion"]);                // <html data-n133-opt-reduced-motion="true|false"> for your CSS
const panel = mountOptions(document.getElementById("options")!, options);   // the gear key and the panel
// panel.open(), panel.close(), panel.isOpen, panel.destroy()
```

**The defs.** Each has a `key`, a `label` (short: the player reads it), an optional `help` line, a `tab` (`"basic"` or `"advanced"`), an optional `group` heading, a
`default`, and optionally `devices` (show the row only on `"phone"`, `"tablet"` or `"desktop"`; the value is kept everywhere).

| `kind` | Value | Drawn as | Its own fields |
|---|---|---|---|
| `"toggle"` | `true` or `false` | a switch: the whole row is the key | |
| `"choice"` | one of `choices[].value` (text or a number) | a row of keys (at most 4 labels of 10 characters), else a drop-down | `choices: [{ value, label }]` (two or more), `display?: "buttons" \| "list"` |
| `"range"` | a number on a step from `min` to `max` | a slider, its value and unit beside the label | `min`, `max`, `step`, `unit?` (put after the number as written: `"%"`, `" s"`) |
| `"key"` | a `KeyboardEvent.code` (`"KeyE"`, `"Space"`): the key's place, the same on every layout | a key cap; pressed, it waits for the next key (Escape keeps the old one) | |

A bad def (an empty label, a default that does not fit, a choice with one value) and a key that is there twice throw a `TypeError` or an `Error` when the store is
made or `add` is called, with what is wrong; nothing of that list is added.

**Defaults for each device.** A default is one value, or one for each device class: `{ phone?, tablet?, desktop?, reducedMotion?, default }`. The class: a coarse
pointer (a finger) with a screen whose short side is under 600 px is a **phone**, any other coarse pointer a **tablet**, anything else a **desktop**
(`detectDevice`; pass `device: () => "phone"` to choose it yourself). `reducedMotion` wins while the device asks for less motion
(`prefers-reduced-motion: reduce`), and the kit follows that setting **live**: a player who never set the option follows the device when it changes.
`store.redetect()` reads both again (a game that passes its own `reducedMotion` function calls it).

**What the browser keeps.** One `localStorage` key, `n133-options:<game>`, holds **only the values that differ from this device's default**, so a better default you
ship later reaches every player who never changed that setting. A kept value that no longer fits (the wrong type, out of range, a choice you removed) is dropped
when it is read, and so is a key that no def has, unless it has a dot: a module's section (`emotes.show`) may be added later, so its kept values wait for it. A
browser that refuses storage (some private windows) keeps the values for the page. `migrate(stored, storage)` (optional) changes what was kept before it is read:
a renamed key, or a game's old save under another key (read it when `stored` is empty, then remove it).

**The store** (`createOptions` returns it; no DOM): `get(key)` (throws for an unknown key), `set(key, value)` (a range's number goes to its nearest step inside min
and max; a wrong type or an unknown choice throws a `TypeError`), `reset(key?)`, `values()`, `defs()`, `def(key)`, `defaultOf(key)`, `isDefault(key?)`,
`subscribe(fn(key, value))` (returns the call that stops it), `subscribeDefs(fn)`, `add(defs)`, `redetect()`, `game` and `device`. **Two key bindings never share
a key:** setting one to a key that another has gives the other this one's old key, and both changes are heard.

**The common settings** (`common(...keys)` gives copies; `COMMON_OPTIONS` holds them, to spread and change: `{ ...COMMON_OPTIONS.quality, default: "low" }`). They are
plain defs: your game does what they say.

| Key | Label | Tab, group | Kind | Default |
|---|---|---|---|---|
| `masterVolume` | Volume | Basic, Sound | range 0 to 100, step 5, `%` | 100 |
| `musicVolume` | Music | Basic, Sound | range 0 to 100, step 5, `%` | 100 |
| `effectsVolume` | Sound effects | Basic, Sound | range 0 to 100, step 5, `%` | 100 |
| `cameraSensitivity` | Camera speed | Basic, Camera | range 10 to 100, step 5 | 50 (the game's own speed) |
| `stickSide` | Move stick | Basic, Controls (a phone and a tablet only) | choice `"left"`, `"right"` | `"left"` |
| `invertLook` | Invert look | Advanced, Camera | toggle | off |
| `reducedMotion` | Less motion | Advanced, Comfort | toggle | the device's setting |
| `quality` | Quality | Advanced, Graphics | choice `"low"`, `"medium"`, `"high"` | `"medium"` on a phone, else `"high"` |
| `showFps` | Show frame rate | Advanced, Graphics | toggle | off |

A volume's square is a fair loudness curve (`(v / 100) ** 2`: Echo Island's). `keyBinding(action, label, code)` makes a `"key"` def `keys.<action>` in Advanced,
under "Keys", on a desktop only.

**A section from another module.** A kit module (the emotes) or a part of your game adds its own settings later, beside the others:
`options.add(optionSection("emotes", defs, "Emotes"))` puts `emotes.` before each key and the group "Emotes" on each def that has none. Its keys are namespaced
(`emotes.show`), a key that is already there throws at once, a value kept before the section came is read when it comes, and a mounted panel draws the new rows.

**The panel.** `mountOptions(el, store, { title?, key?, onOpen?, onClose?, onRangeDone?, confirm? })` puts a 44 px key (a gear and "Options") in `el`, and a panel: a
sheet from the bottom on a phone held upright, from the right on a wide or sideways screen, over a scrim (a press on it closes the panel). The two tabs are real tabs
(the arrow keys, Home and End; one tab alone has no tab bar); each tab draws its rows without a group first, then each group under its heading. **A change applies
at once** (there is no Save key), and a change from elsewhere shows in place: the rows are drawn once, a slider under a finger is never drawn again, and the panel
never scrolls back to the top. **Reset to defaults** asks in the panel ("Put every option back to its default?", Reset and Cancel), never in a browser dialog;
Escape answers the question first, then closes the panel. `key: false` draws no key, for a game that puts "Options" in its own pause menu and calls `open()`.
**When it closes, the focus leaves the key and the panel** (to the page), so Space and the game's other keys reach the game again: a focused key would take
Space and open the panel again. The friends panel and the emote wheel do the same. `focusAfterClose: "key"` gives the focus back to the key (or, with no
key, to what had it before), for a page with no keys of its own. `onOpen` and `onClose` let a game pause under the panel; `onRangeDone(key, value)` hears a slider let go (play a sound at the new
level). The panel holds the focus while it is open. Every key, switch, choice and slider is 44 px or more, and a row's label is 16 px.

**Light and dark.** The panel follows `data-n133-theme="light" | "dark"` on the page's `<html>` when the page sets it (the admin panel does), else the device's
`prefers-color-scheme`. Every colour is a variable: `--n133-ink`, `--n133-ink-soft`, `--n133-paper`, `--n133-ground` (the tab bar and a choice's well),
`--n133-line`, `--n133-gem`, `--n133-gem-dark`, `--n133-on-gem` set the light theme, and each has a `--n133-dark-*` twin; `--n133-radius`, `--n133-font` and
`--n133-options-z` (default 1100, above the friends panel) too. The stylesheet is scoped under `.n133-options`.

**Less motion in your CSS.** `reflectOptions(store, keys, target?)` keeps each key's value on `<html>` (or `target`) as `data-n133-opt-<key in kebab case>`, and
returns the call that stops it:

```css
html[data-n133-opt-reduced-motion="true"] .my-hud * { animation: none !important; transition: none !important; }
```

## Emotes (`/emotes`; since 0.8.0)

Nano Island's emotes for a game: the same eleven, on the same character, with the same wheel. **The Wave** is the character's own `wave()`; **Cheer, Clap,
Dance, Bow, Shrug, Laugh, Point, Sit, Facepalm and Spin** are clips made in Blender on the character's own skeleton (the island makes them from this package's
`BONES`), so they fit every base. The wheel also plays **a game's own animations**: give it your list and an `onPlay`.

```ts
import { createEmotes, loadEmotes, playRemote } from "@nano133/nanoterra/emotes/player";
import { emoteMessage, readEmoteMessage } from "@nano133/nanoterra/emotes";
import { mountEmotes } from "@nano133/nanoterra/emotes/wheel";
import "@nano133/nanoterra/emotes/style.css";

const emotes = createEmotes(hero, { onEmote: (e) => net.send(emoteMessage(e)) });  // hero: createCharacter(...); onEmote only for a multiplayer game
const wheel = mountEmotes(document.getElementById("emotes")!, {
  game: "my-game",                       // the wheel's places are kept per game, in this browser
  onPlay: (id) => emotes.play(id),       // the player picked one
  onOpen: () => void loadEmotes(),       // the clips load when the wheel first opens, not with the game
  nanoterraEmotes: settings.emotes,      // the admin's "Allow Nanoterra emotes": "on" (the default) or "off"
});
// Each frame: nothing new. hero.update(dt, motion) plays the emote over the walk.
// Another player's emote, from your network:
net.on("message", (m, from) => { const id = readEmoteMessage(m); if (id) playRemote(characterOf(from), { id }); });
```

**The clips.** A clip turns each bone from its parent, 30 frames a second, and the hips' place; the game runs no IK for it. It plays as a layer over the
character's pose: `update` solves the walk, then the clip blends over it (a fade in of 0.12 s, a fade out of 0.22 s at its end), then the tail, the wings and the
long hair follow. The rules are the island's:

| Emotes | Kind | What stops it |
|---|---|---|
| Cheer, Dance, Bow, Laugh, Sit, Spin | the whole body | a move (the pose's speed over 0.4 m/s), a jump, the water, or `stop()`, with a fade of 0.18 s |
| Clap, Shrug, Point, Facepalm | the spine, the arms and the head: they play over the walk | their end, the water, or `stop()` |
| Dance, and Sit (its sitting down plays once, then its seated part) | loops | as above: a loop plays until the player moves |
| The Wave | the character's own wave (1.8 s) | its end |

With `reducedMotion` on the character, an emote shows its one picture (the clip's hold frame) for its time. Point never raises a straight arm: the hand stays
below the shoulder with the elbow bent (Wes's rule on the island). A clip's time is the sum of the steps `update` took, so a paused game pauses its emotes.
The kit's pose has no swim: a game with water calls `emotes.stop()` (or `stopEmote(character)`) when a character goes in.

**Loaded only when needed.** The clips (84 kB, 18.8 kB gzip) are in a module that only `import()` reaches (`loadEmotes`), so a bundler puts them in a chunk of
their own; `onOpen` loads them when the wheel first opens, and a clip that plays before they arrive (another player's) loads them and starts when they come. The
pictures (`icons.webp`, one strip of eleven 128 px squares, 34 kB) are found with `new URL("…", import.meta.url)` and load when the wheel first shows them. Checked
on Vite 8 (`vite build`: a `clips-<hash>.js` chunk and an `icons-<hash>.webp` file, neither fetched before the wheel opens; `vite` dev with the package
pre-bundled: the same) and in plain ESM with an import map. A bundler that does not follow `new URL(…, import.meta.url)` can pass the picture's address itself
(`icons`), e.g. Vite's `import icons from "@nano133/nanoterra/emotes/icons.webp?url"`.

| Call (`/emotes/player`) | What it does |
|---|---|
| `createEmotes(character, { onEmote?, onStop? })` | The local player's emotes. `play(id)` plays a Nanoterra emote (false, and nothing happens, for another id); `stop()` stops the clip with its fade; `playing` is the clip on show or null; `destroy()` stops the events. |
| `onEmote({ id, loop, at, again })` | The player played an emote; while a loop plays, it fires again every 10 s (`LOOP_AGAIN_MS`) with `again: true`, so a player who comes later sees it. Send `emoteMessage(e)`, which is `{ emote: id }`. |
| `onStop({ id, at, why })` | The player's clip ended: `"end"`, `"move"` (a move, a jump or the water) or `"stop"`. Nothing to send for a move: the others see the character move, and that ends it on their screens too. Send a stop only for `"stop"`, and call `stopEmote` on their side. |
| `playRemote(character, { id, at? }, { options? })` | Another player's emote on their character. An id that is not one of the eleven is ignored (false). The same play twice (the same `at`) is one, so you may pass the last one each frame; a loop that is on show goes on through a repeat. `at` is when it came (`performance.now()`; left out: now). |
| `stopEmote(character)` | Stops any character's clip, with its fade. |
| `loadEmotes()`, `emotesLoaded()` | Loads the clips (once; a failed load may be tried again), and says whether they are here. |

**The wheel** (`/emotes/wheel`) is nano133's island wheel in plain DOM. `mountEmotes(element, options)` puts an **Emotes** key (44 px) in `element`; a press opens the
wheel in the middle of the screen over a dim page: eight round places (58 px or more), slot 1 at the top and on clockwise, each the emote's picture and name, and a
middle disc with the name of the place under the finger and **Edit**.

- A tap on the key opens it and a tap on a place plays it; or a **hold on the key and a slide** onto a place and a let-go plays that one (a slide under 14 px is a tap; a
  let-go in the middle leaves the wheel open). A press beside the wheel or Escape closes it.
- On a keyboard **B** opens and closes it (not while a field has the keys, or when your `keyAllowed(e)` says no: B bound to an action, a dialog of your own) and **1 to
  8** play its places while it is open; the places show their numbers only where there is a mouse.
- **Edit** shows every emote of the list (it may hold more than eight; it scrolls): a tap puts one on the wheel in its first empty place or takes it off; a ninth says
  "Your wheel is full. Take one off first."; a tap on a place takes its emote off. The places are kept in this browser per game (`n133-emotes:<game>`); a browser
  that refuses storage keeps them for the page. Nanoterra's first wheel is the island's: Wave, Cheer, Clap, Dance, Laugh, Point, Sit, Spin.
- `emotes`: the list, Nanoterra ids (`"dance"`) and your own (`{ id, label, icon? }`, `icon` a square picture's address) in the order Edit shows them; default
  Nanoterra's eleven. `defaults`: your first wheel. `nanoterraEmotes: "off"` (the admin's switch) leaves Nanoterra's out and keeps yours; with nothing left
  there is no key. `keys: false` turns B and 1 to 8 off. `theme`: `"light"`, `"dark"` or `"device"` (the default: the page's `data-n133-theme`, which the admin
  panel sets too, else `prefers-color-scheme`). It returns `open()`, `close()`, `isOpen`, `slots` and `destroy()`.
- Theme it with the same `--n133-*` properties as the admin panel (and their `--n133-dark-*` twins), and `--n133-emotes-z` for its z-index (default 1000).

The clips and the icons are nano133's own work, made in Blender for Nano Island, and are part of the package under its MIT licence.

**The admin's switch.** The Game card has **"Allow Nanoterra emotes"** (`emotes` in the settings: `"on"`, the default, or `"off"`). Read it with
`loadGameSettings` and pass it to the wheel as `nanoterraEmotes`. When it is off, also do not call `playRemote` and do not send the player's emotes: the game shows no
Nanoterra emote. Your own emotes may still use the wheel.

**The player's options.** For the options menu (`/options`), `/emotes` exports three settings: `emotes.show` "Show the Emotes key" (Basic, on),
`emotes.others` "Show other players' emotes" (Advanced, on) and the wheel's key, `keys.emotes` "Emotes wheel" (Advanced, under Keys, B, a desktop only: what
`keyBinding("emotes", "Emotes wheel", "KeyB")` makes). `EMOTE_OPTIONS` holds all three with their whole keys, for `createOptions({ defs: [...yours, ...EMOTE_OPTIONS] })`
or `store.add(EMOTE_OPTIONS)`; `EMOTE_OPTION_DEFS` holds the two toggles with short keys, for `store.add(optionSection("emotes", EMOTE_OPTION_DEFS, "Emotes"))`, and
`EMOTE_KEY_OPTION` the key. Pass the store as `options` to `mountEmotes` (the key hides, live; B, or the player's own key, still opens the wheel) and to `playRemote`
(the others' emotes do not play). With no store, both toggles are on and the key is B. `/emotes` imports only the options module's types, none of its code.

**The message on the wire** is yours to carry: one small object, `{ emote: id }`. nano133.com's island is one example, not a rule: its room server takes
`{ t: "react", k: "dance" }` from a player, checks the id against its own list and sends the others `{ t: "react", id: <player>, k: "dance" }`; an old server that
does not know an id drops it, and nothing breaks.

## The player's sign-in (`/player-signin`; since 0.9.0)

The PLAYER's sign-in for a game with a server, in one path: **a passkey** (Face ID, Touch ID or the device PIN: no app to install) and the three
**wallet apps** (Berry Wallet, NanChat, Nautilus). No password, no email and no payment, and **the server holds no key**: every way is a signature from a
key the player holds, and the server checks it with [`@nano133/signin`](../signin), an optional peer of this package:

```sh
npm install @nano133/nanoterra @nano133/signin
```

A player is a **Nano address**, whichever way they sign in. The shop (`/shop`) and the friends list key a player by it, so a look a player buys stays with
that address. The admin's sign-in is another thing (`/admin`): this path never makes an admin login.

### The passkey: the passkey purse

The passkey gives the page 32 secret bytes (its **PRF** extension), and those bytes become the seed of a Nano account in the browser: the player's
address. The browser signs a short text that names the game's host with that account, and the server checks the signature (`POST {base}/passkey`). The
server keeps no credential and checks no assertion: the proof is the signature, as for a wallet. The seed never leaves the page and is never stored.

- **The scheme is the game's own, and it is FROZEN.** A player's account (and so their looks) lies at the address these exact texts give:

  ```ts
  // FROZEN: never edit. A new scheme is a new versionByte with new texts.
  export const SCHEME = { input: "mygame.com player v1", salt: "mygame.com", info: "mygame.com player seed v1", versionByte: 1 };
  ```

  Write it once, in one file, and test it with **fixed vectors** that must never change (a PRF output, its seed, its address):

  ```ts
  import { schemeVector } from "@nano133/nanoterra/player-signin";
  assert.deepEqual(await schemeVector(SCHEME, "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"), { seed: "…", address: "nano_…" });
  ```

  Run it once to read the seed and the address, write them into the test, and never change them. The kit gives no default scheme on purpose.
- **A passkey belongs to one domain** (its relying party id: the page's host, or `rpId`). Moving the game to another domain gives every player another
  account. Choose the domain before the first player. So the sheet offers **no passkey on a preview address** (`*.workers.dev`, `previewHost`), where the game
  starter runs first: the wallet apps only, until the game has its own domain (`passkey: true` offers it there anyway). The admin says so in its "Check these"
  banner when `mountAdmin` gets `playerPasskeys: true`: "Passkeys turn on when your game has its own domain."
- **It needs PRF** in the browser and in the passkey's provider. Where the browser says it has none, the passkey shows last ("Not on this browser"); where a
  passkey gives no PRF answer, the sheet says so in plain words and offers the wallet apps. As known in 2026-11, not tested here on each device (the sheet
  asks the browser, `getClientCapabilities`, and never guesses):
  Safari on iOS 18 and macOS 15 and later with iCloud Keychain, Chrome on Android with Google Password Manager, Chrome on a computer with Google Password
  Manager or iCloud Keychain (macOS 15), 1Password and recent Bitwarden: yes. Windows Hello and older systems: often no. Firefox: from 135, where the system's
  provider has it. A phone used through the computer's QR code (hybrid) gives its own PRF.
- **The spare key.** The player's looks belong to the passkey's address. A synced passkey (iCloud Keychain, Google Password Manager) survives a lost phone;
  a lost passkey with no sync loses the address and its looks (no XNO is in it: the payments go straight to the creator). So after a NEW passkey the sheet
  shows **"Keep a spare key"**: the seed, at the press only, and how to use it (import it as a seed in a Nano wallet such as Nautilus, then sign in with that
  wallet: the same address). It can be skipped, not missed. `spareKey: false` turns it off (a game for small children, say). Signing in with the wallet that
  PAID does not bring the looks back: a look belongs to the address that was signed in when it was bought. Linking a wallet to a passkey account (one
  player, two ways in) is planned for a later version.

### The server

```ts
import { createPlayerSignin } from "@nano133/nanoterra/player-signin";
import { createD1PlayerSignin } from "@nano133/nanoterra/player-signin/d1";

const signin = createPlayerSignin({
  store: createD1PlayerSignin(env.DB),         // or createFirestorePlayerSignin(getFirestore()), or createMemoryPlayerSignin() for a test
  siteAddress: env.RECEIVE_ADDRESS,             // Nautilus only NAMES it in its request; no key, no payment
  limit: (key, n, ms, now) => d1Limit(key, n, ms, now),   // your limiter (default: this copy's memory)
  visitor: (req) => visitorKey(req),            // a keyed hash of the IP address (default: the CF-Connecting-IP header)
  personCheck: (token, req) => turnstileOk(token, req),   // optional (Turnstile)
});
const answer = await signin.handle(request);    // null when the request is not a sign-in route
if (answer) return answer;
const player = await signin.player(request);    // the signed-in player's address, or null: the shop's and the friends' `player` hook
```

| Route (`base` "/api/signin") | Who calls it | What it does |
|---|---|---|
| `POST {base}/start` `{ way, turnstile? }` | the page | starts a wallet request: `{ way, id, link, walletLink?, code?, expiresAt }` and the starter cookie (30 minutes) |
| `GET`, `POST {base}/nano/:id` | Berry Wallet | reads the request; posts its signature (204 and no body when accepted, 401 and the words when refused) |
| `POST {base}/nautilus?id=` | Nautilus | its signature (always 200: Nautilus shows only a 200's words) |
| `POST {base}/nanchat` | NanChat's relay server | its signature (always 200; a refusal starts "NOT signed in"); limited in total and per nonce, never per visitor |
| `POST {base}/check` `{ id, way }` | the page, every 2 s | `{ status }`: `waiting`, `expired`, `elsewhere` (another browser started it), `used`, or `signedin` with `address` and the session cookie |
| `POST {base}/passkey` `{ address, at, signature, turnstile? }` | the page | the passkey purse's signature: `{ status: "signedin", address }` and the session cookie |
| `POST /api/signout` | the page | ends this browser's session: `{ ok: true }` |

These are the game starter's own routes and answers, so its page works unchanged. The rules:

- The signed texts name the game's **host** (the request's, or `domain`: with `domain` set, a call to another host is refused, 403). A signature made for
  another site counts nowhere here.
- **Only the browser that started a wallet request is signed in by it** (its starter cookie), **once**: the delivery and its session are one step of the store.
- A passkey signature counts **once** (by the hash of its text) and only within 5 minutes either way of its time: a replay is 409, a stale one 400.
- The page's calls must come from the game's own page (Origin), 403 otherwise; the wallets' calls have no cookie and no Origin. Starts and passkey sign-ins:
  20 in 10 minutes per visitor (`limit`); checks 90 a minute; the wallets' calls 30 a minute per IP address. A store's fault is a plain 500 (`onError` hears it).
- **The session** is the starter's: the cookie `session` (`__Host-session` on https; HttpOnly, SameSite=Lax, 30 days). The store keeps only the SHA-256 of
  its token and `via`: `"wallet"`, `"passkey"` or `"nanoterra"`.
- `signin.session(request)` gives `{ address, createdAt, via }`; `signin.signIn(request, address, "nanoterra")` makes a session for the game's own code
  exchange and returns the Set-Cookie value; `signin.signOut(request)` likewise; `signin.forget(player)` is for **"Delete my data"** (every session, signed
  request and once-only row of the player); `signin.clean()` is for a cron.
- **`sharedPaths: true`** for a game whose own admin signs in on the same paths (the starter's `scope: "admin"`): the admin's calls, and a wallet's call for a
  request this store does not hold, answer null, and the game's admin code answers them. A game that uses the package's admin sign-in (`/admin-signin`, on its own
  route) does not need it.
- `ways` (default all three), `passkey: false`, `base`, `signOutPath`, `cookies`, `sessionDays` change the rest.

**The stores** read and write only their three tables or collections, and only the player's rows:

- **D1:** add `@nano133/nanoterra/player-signin/d1.sql` to the migrations. Its `signin_requests` and `sessions` are the game starter's own tables (`CREATE
  TABLE IF NOT EXISTS`): on the starter it adds only `signin_once` and three indexes, and **every player stays signed in**. Rows of the scope `'admin'` are
  never read, delivered, ended or deleted. Other table names: `createD1PlayerSignin(db, { requests, sessions, once })`, and the same names in the SQL.
- **Firestore:** `createFirestorePlayerSignin(db, { requests, sessions, once })` (default `signin_requests`, `sessions`, `signin_once`). Each document
  carries `deleteAt`: set a TTL policy on it for each collection. Firestore's own single-field indexes are enough.
- **Your own database:** a `PlayerSigninStore` that passes `playerSigninStoreConformance` from `@nano133/nanoterra/player-signin/conformance`.

### The sheet

```ts
import { mountPlayerSignin } from "@nano133/nanoterra/player-signin/panel";
import "@nano133/nanoterra/player-signin/style.css";
import { SCHEME } from "./scheme";                // the frozen scheme above

const signin = mountPlayerSignin(document.body, {
  name: "My Game",                               // the device shows it next to the passkey: "My Game · 1 Nov 2026"
  scheme: SCHEME,
  qr: (text) => qrCanvas(text),                  // a QR code for a wallet's link on a computer (no hook: the link as text)
  personCheck: (box) => turnstileToken(box),     // optional
  onSignedIn: (player) => refresh(),             // { address, via: "wallet" | "passkey" }
});
const player = await signin.open();              // the shop's "sign in first": the player, or null when the sheet closed
```

- **Passkey first** ("Use a passkey", "Face ID, Touch ID or your device PIN"), then the three wallet apps as tiles. The passkey step has "Use my passkey" and
  "Make a passkey"; the main key is "Use" in a browser that made or used one before, and the device refuses a second passkey here ("This device has your
  passkey already. Use it."). A new passkey is used at once (its seed comes from a USE, never from the answer at create); a browser that allows one prompt
  per press shows one key, "Open my passkey".
- The faults, in plain words: no passkey used, no PRF, no passkeys in this browser, a password manager's answer in a form the kit does not read, another
  game's passkey, another passkey than the one just made, two answers for one passkey, the wrong host. None names a seed or a key; none says to delete a passkey.
- A wallet: on a touch screen one key that opens the app; with a mouse its QR code. The page asks every 2 s, at most 5 minutes.
- `signInView(options)` is the same content for a game with a sheet of its own (`{ node, stop, reset }`).
- Phone first (since 0.9.3 by default): every text 16 px or more, and every key, wallet tile, link, the back key and the close key 48 px or more each way
  ("Last used" sits in the flow, under a wallet's name or at the end of the passkey's row). The sheet comes from the bottom on a phone held upright, and is
  a card in the middle on a wide or sideways screen; Escape, the close key and the scrim close it; no browser dialog. Light and dark like the options panel (`data-n133-theme` on `<html>`, else the device), every colour a
  `--n133-*` variable with a `--n133-dark-*` twin; `--n133-signin-z` (default 1200) for its z-index.
- The page loads the purse's signing code (`@nano133/signin/purse`, 40 kB gzip) only when a passkey signs in.
- The browser remembers, in `localStorage["n133.player-signin.v1:<rpId>"]`, the ids of its passkeys, which were made here and never opened, and the last
  way: no secret and no address.

**Its words** (since 0.9.3). `words` on `mountPlayerSignin` and `signInView` changes any word of the sheet, for the game's own words or language: the keys
of `PlayerSigninWords` (the defaults are `PLAYER_SIGNIN_WORDS`), any of them, over the defaults. A text with a value in it is a function of that value, and
`faults` changes the words of any passkey fault (`faultWords(code, rpId, words)` gives them). The wallets' names stay. `refusal(text, status)` turns the
server's refusals (in English) into the game's words.

```ts
mountPlayerSignin(document.body, {
  name: "My Game",
  scheme: SCHEME,
  words: { lead: "No password.", waitingFor: (wallet) => `Waiting for ${wallet}…`, faults: { cancelled: { title: "Stopped", text: "No passkey was used." } } },
});
```

## The shop (`/shop`; since 0.9.0)

A shop that sells **looks** for Nano (XNO), the way the [game starter](https://github.com/nano133-com/nano-game-starter) sells them. A game
installs it instead of copying the starter's shop.

**The money model.** The money goes **straight from the player's wallet to the creator's address**. The server holds **no key** and sends
nothing: it only reads the Nano ledger to see that a payment came. Each order asks for a unique, clean amount (the price rounded up to
0.0001 XNO, one step more while another order holds that amount), and a payment counts only when it is a confirmed send of exactly that
amount to exactly that address, first seen after the order was made. (This is not `@nano133/checkout`'s address for each checkout: that
one puts a key on the server.)

| Path | What |
|---|---|
| `@nano133/nanoterra/shop` | the rules (amounts in raw text and BigInt, the reservation, the match, the price, the nodes, the address checksum), the routes (`createShopHandler`), the payment scan (`scanPayments`), a memory store, the CSP lists. No DOM, no database, no package. |
| `@nano133/nanoterra/shop/d1`, `/shop/d1.sql` | the store on Cloudflare D1, on the starter's own tables (`createD1Shop`), and `d1Limit` and `visitorKey` |
| `@nano133/nanoterra/shop/firestore` | the store on Firestore (a small interface, no Firebase dependency): `createFirestoreShop` |
| `@nano133/nanoterra/shop/worker` | the shop for a Worker with D1, set up from the starter's settings: `createShop(env, { catalogue, player })` |
| `@nano133/nanoterra/shop/panel`, `/shop/style.css` | the Looks key, the looks sheet and the pay sheet (QR code, test stamp), in plain DOM: `mountShop` |
| `@nano133/nanoterra/shop/conformance` | the money rules as test cases, for a store a game writes itself |

### On a Worker with D1 (the starter's way)

```ts
import { createShop } from "@nano133/nanoterra/shop/worker";
import looks from "../../looks.json";

// In the Worker's fetch, after the game's own sign-in has read the PLAYER session:
const shop = createShop(env, { catalogue: looks, player: async () => session?.address ?? null });
const answer = await shop.handle(request);  // POST /api/orders, GET /api/orders/{id}, POST /api/orders/{id}/check; null for any other path
if (answer) return answer;

// The cron (wrangler.jsonc "triggers": { "crons": ["*/10 * * * *"] }): finds a payment of a player who closed the page.
async scheduled(_event, env, ctx) { ctx.waitUntil(createShop(env, opts).scan()); }
```

`createShop` reads the starter's settings: `RECEIVE_ADDRESS` (the creator's address), `TEST_MODE`, `NODE_API_KEY` (a secret, optional),
`NANO_NODES` (optional), `TURNSTILE_SITE_KEY` and the secret `TURNSTILE_SECRET` (both, or no person check). `"none"`, `"skip"`, `"off"` and
`"-"` mean "not set". It also gives `shop.owned(player)` (for the game's `/api/me`), `shop.config()` (`{ testMode, turnstileSiteKey }`, for
the game's `/api/config`), `shop.status()` (the address, test mode, the nodes and the warnings, for the admin's Status card) and `shop.scan()`
(the admin's "Check payments now": `createAdminHandler({ ..., check: (at) => shop.scan(at) })`).

On any other server, use the handler and a store:

```ts
import { createShopHandler } from "@nano133/nanoterra/shop";
import { createFirestoreShop } from "@nano133/nanoterra/shop/firestore";

const shop = createShopHandler({
  store: createFirestoreShop(getFirestore()),  // or createD1Shop(env.DB), or createMemoryShop() for a test
  catalogue: looks,                            // looks.json as it was read: checked with checkLooks (a bad file throws here)
  payee: process.env.RECEIVE_ADDRESS,          // the creator's address: payments go straight there
  testMode: process.env.TEST_MODE === "on",
  player: async (req) => signedInPlayerId(req),  // YOUR player's sign-in (never the admin's): an id, or null
  nodes: nodesFor({ NODE_API_KEY: process.env.NODE_API_KEY }),  // optional: the public nodes by default
  personCheck: async (token, req) => myTurnstileCheck(token, req), // optional
});
```

### The routes and the answers

The starter's paths and JSON, so the starter's page keeps working. `base` is `"/api/orders"`.

- `POST {base}` `{ lookId, turnstile? }`: a new order. 201 and the **pay view**; 200 and the same open order again (one waiting order per look).
  The browser sends a look's id and nothing else: **the server decides every price**.
- `GET {base}/{id}`: the pay view of the player's own order. Another player's order looks like no order at all (404).
- `POST {base}/{id}/check`: a payment scan first (at most one for the whole game every 4 s), then the pay view.
- The pay view: `{ id, lookId, usd, amount, status, createdAt, expiresAt, xno, test, prices }`, and **only outside test mode** `address` and
  `uri` (`nano:<address>?amount=<raw>`, every digit). `status` is `"open"`, `"paid"`, `"expired"` or `"paid_late"`.
- Refusals are `{ error }` with the starter's words: 401 "Sign in first.", 403 (a POST from another page, or a failed person check), 400
  (no such look, a free look, a body that is not readable), 409 "You already own this look.", 429 (10 new orders in 10 minutes for one
  visitor; three waiting orders for one player), 503 (no believable price, or every amount of the price held), a plain 500 for a fault
  (`onError` hears it; the player sees nothing of it).

### The money rules (every store keeps them: `shopStoreConformance` proves it)

- An order holds its amount from its start to **an hour after** it ends (15 minutes): **no two held orders ever hold the same amount**, even
  when they are made at the same instant. A late payment is then still recognised, and never counts for a newer order.
- Amounts are text and BigInt, never floats. Prices round **up** (the creator never gets less than the price). At most a tenth of the price
  more (and at most 100 amounts); then the player is asked to try again in a minute.
- A payment is ONE step: the order becomes `"paid"` and the look goes to **the order's player** (once), or `"paid_late"` (sent more than 2
  minutes after the order ended: no look; the creator sends it back by hand from their wallet: the server has no key). The hash is recorded:
  **one payment pays one order, once**, and a paid order is never paid twice. An order whose hold has ended can never be paid.
- The scan **fails closed**: when no node answers, nothing is credited and the next scan tries again.
- The price is the median of CoinGecko, Kraken and KuCoin (no keys), kept 5 minutes; the last good one for up to 6 hours when every feed
  fails; then nothing is sold. The pay sheet says "Powered by CoinGecko" (CoinGecko's terms).

### Test mode

**On until the owner's own address is set AND test mode is off.** With no payee, the example address
(`nano_1111…hifc8npp`), an address with a wrong checksum (`validAddress` checks it) or `testMode: true`, the pay view carries **no address
and no link**, and the pay sheet shows **"TEST MODE: DO NOT PAY"** where the QR code would be, with the wallet key off. The sheet decides it
from the order, never from a setting of the page. A payment to an address that nobody holds the key for is lost for good.

### The stores

- **D1** (`createD1Shop(env.DB)`): the starter's tables `orders`, `owned` and `meta` (the keys `rate`, `scan`; `salt` for `visitorKey`), column
  for column. `@nano133/nanoterra/shop/d1.sql` creates them with `IF NOT EXISTS` (and `hits` for `d1Limit`): a new game adds it to its
  migrations; **a game made from the starter needs no migration** (its `migrations/0001_init.sql` made them). The names can be changed
  (`{ tables: { orders, owned, meta } }`), but the admin's D1 store reads the starter's names. The rules are in the statements:
  `amount_lock` and `hash` are UNIQUE, a payment and its grant are one batch, the scan's claim is one upsert.
- **Firestore** (`createFirestoreShop(db, { orders, owned, meta, amounts, hashes })`): `orders/{id}`, `owned/{player__lookId}` and `meta/rate`
  are what the admin's Firestore store reads; `shop_amounts/{amount}` holds each held amount and `shop_hashes/{hash}` each recorded payment, so a
  transaction can keep the two unique rules. The indexes Firestore makes by itself are enough.
- **Your own database:** write a `ShopStore` and run the rules on it (each case is short; give each its own test, with `SHOP_CASE_TIMEOUT_MS`):

```ts
import { shopStoreConformance, SHOP_CASE_TIMEOUT_MS } from "@nano133/nanoterra/shop/conformance";
for (const c of shopStoreConformance(async () => ({ store: newEmptyStore(), dump: () => allRowsAsText() }))) it(c.name, c.run, SHOP_CASE_TIMEOUT_MS);
```

**"Delete my data":** `store.forget(player, now)`. While an order of the player may still be paid (its amount is held) it deletes nothing and
answers `waitUntil` (try again then). Else the owned looks and the orders that were never paid go; a paid order stays as the creator's sales
record with the player (and its payer) replaced by `"deleted"`, and its payment's hash kept (so it never counts again); a **late** payment keeps
its payer, because the creator must send it back.

### The panel

```ts
import { mountShop } from "@nano133/nanoterra/shop/panel";
import "@nano133/nanoterra/shop/style.css";

const shop = mountShop(document.getElementById("shop")!, {
  looks,                                        // looks.json: the list (the server still decides every price)
  owned: () => me.owned,                        // the look ids the player owns (your /api/me: shop.owned(player))
  signedIn: () => Boolean(me.address),
  signIn: () => mySignIn(),                     // YOUR sign-in sheet: true when a player is signed in after it. The shop draws no sign-in.
  worn: (look) => wornIn(look.wear ?? "outfit") === look.id,
  wear: (look) => wearIt(look),
  takeOff: (slot) => takeOffIt(slot),           // optional: each item tab starts with its plain choice
  onOwned: (lookId, look) => { me.owned.push(lookId); wearIt(look); },  // a paid order gave this look
  personCheck: (box) => turnstileToken(box),    // optional: Turnstile drawn in `box`
  slots: { shovel: { tab: "Shovels", plain: "Plain shovel" } },        // optional words for the tabs
});
// key: false draws no Looks key: open it from your own key with shop.open(), or shop.buy("mint-cap") from your own Buy.
```

- The looks sheet: a tab for each wear slot (the outfits first) when the game sells items, each look with its price before any step; Wear,
  Wearing, or Buy. `picture(look)` gives the game's own picture instead of the swatch. **For a test:** the sheet opens on the first tab (the
  outfits), so the looks of another slot ("Shirts", "Hats") are not in the page until the test clicks their tab (`.n133s-tab`); or the test
  calls `buy(lookId)`, which needs no tab.
- Buy: the game's sign-in (`signIn`) when nobody is signed in, then the person check, then the pay sheet: the amount, the QR code of the exact
  `nano:` link (drawn by the package as SVG: no QR library, no outside service), "Open wallet", the address and the amount by hand, the time
  left (live only), and a check every 5 seconds for 2 minutes ("Check again" after). Paid: "Paid. Thank you!" and `onOwned`. Paid late: no look,
  and the creator sends it back. Ended: a payment sent in time still counts.
- Phone first (since 0.9.3 by default): every text 16 px or more (the price-source line, the time left, "Enter by hand"'s address and labels too), and
  every key, tab, the Looks key, the close key, the fold "Enter by hand" and its copy keys 48 px or more each way. On a phone held upright the sheet
  rises from the bottom; on a wide screen it stands in the middle; on a phone held sideways the QR code (or the stamp) stands alone on the left and
  the wallet key stays in view. A game that wants smaller text sets it in its own stylesheet, after the kit's.
- Light and dark: `theme: "light" | "dark" | "device"` (the default: the page's `data-n133-theme`, else the device's setting). Every colour is a
  `--n133-*` variable with a `--n133-dark-*` twin (and `--n133-sun` for Buy, `--n133-warn` for the stamp). The QR code stays dark on white.
- **A shop that is a modal `<dialog>` of the game's own** (its own sheet around `open()`) closes it in its `signIn` hook before it opens the sign-in
  sheet, or the sign-in sheet stays hidden behind it. The game starter's `src/client/main.ts` does this.
- **Buy from a game's own `<dialog>`** (its own looks sheet calls `shop.buy(lookId)`): close the game's dialog first, and let it finish closing (its
  `close` event) before the kit's sheet opens, or the game's close handler takes the focus and the Escape key from the kit's sheet. Since 0.9.2 the
  kit does this itself: `buy(lookId)` starts on the next frame (Chromium fires a dialog's `close` event at the frame, after a `setTimeout(0)`; a
  hidden page has no frames and starts at once), so `dialog.close(); shop.buy(id)` is safe. `shop.isOpen` is false until that frame. `open()` still opens at once.
- **`onSessionEnd()`** (since 0.9.3): the server refused an order with 401 (the player's session ended, though `signedIn()` said yes). The
  game marks the player signed out. The sheet's "Sign in" key then calls `signIn()` without asking `signedIn()` first, so a stale "yes" cannot
  post the refused order again.
- **`onSignInCancel(lookId, look)`** (since 0.9.3): when the game's own Buy (`buy(lookId)`) asks for a sign-in and the player closes it without signing
  in, the kit opens nothing (it closes its sheet if it was open) and calls this hook: the game shows its own looks sheet again. A Buy in the kit's own
  list goes back to that list, as before, and does not call it.

  ```ts
  const shop = mountShop(el, { ...options, key: false, onSignInCancel: () => myLooksDialog.showModal() });
  myBuyKey.onclick = () => { myLooksDialog.close(); shop.buy(look.id); };
  ```

**Its words** (since 0.9.3). `words` on `mountShop` (and on `looksView` and `payPanel`) changes any word of the looks sheet and the pay sheet: the
titles, the lines, every key, the states (waiting, paid, paid late, ended), the refusals (`refusal(text, status)`: the server's words are English) and
the names for a screen reader. Give the keys of `ShopWords` you want, over the defaults (`SHOP_WORDS`); a text with a value in it is a function of
that value:

```ts
mountShop(el, { ...options, words: { sendExactly: "Pay exactly", buyTitle: (look) => `Get ${look}` } });
```

The defaults are short: the pay sheet shows at most 30 words (TEST MODE and live) and no sentence has more than 10 (`test/panel-words.test.ts`).
Two things are not the game's words: the stamp **"TEST MODE: DO NOT PAY"**, and **"Powered by CoinGecko"** while CoinGecko is one of the price feeds
(its API terms; `priceLine` adds it when the game's `prices` leaves it out). Keep the meaning of the safety lines in any language: live, send the
**exact** amount, and the order ends at the timer; in test mode nothing can be paid and the wallet key is off; a late payment gives no look and
the creator sends it back.

### The page's Content Security Policy

The shop needs no other origin, except Turnstile when the game turns it on. Merge its lists into the game's own policy; never replace the game's:

```ts
import { SHOP_CSP, mergeCsp } from "@nano133/nanoterra/shop";
const CONTENT_SECURITY_POLICY = mergeCsp(MY_POLICY, SHOP_CSP);  // adds Turnstile to script-src and frame-src; keeps every source of yours
```

### Moving the game starter onto the package

The tables, the routes and the answers are the starter's, so the switch keeps **every order, owned look, price, scan time and limit
counter** as they are, and the page needs no change for the server part.

1. `npm install @nano133/nanoterra@<this release>`. No migration: the starter's `0001_init.sql` already made `orders`, `owned`, `meta` and
   `hits` (the shop's only tables; 0002 to 0007 hold sign-in, Nanoterra, admin and friends tables).
2. `src/worker/index.ts`: after `const session = await sessionOf(db, req, now)`, make the shop and let it answer (it replaces `createOrder`, the
   two order routes and `payView`): `const shop = createShop(env, { catalogue: looks, player: async () => session?.address ?? null, now: () => now });`
   then `const answer = await shop.handle(req); if (answer) return answer;`. In `/api/me`, `owned` is `await shop.owned(session.address)`. In
   `/api/config`, `testMode` and `turnstileSiteKey` can come from `shop.config()` (the same rules). In `scheduled`, `shop.scan(now)` replaces `sweep`.
   Keep the router's own per-visitor memory limits, its `sameOrigin` check and `secure()` as they are.
3. `src/worker/admin.ts`: `check: (at) => shop.scan(at)` and `nodes: nodesFor(env).map((n) => n.name)` (`nodesFor` from `@nano133/nanoterra/shop`).
4. Delete `src/worker/{orders,match,sweep,price,nodes}.ts` and their tests (`orders`, `sweep`, `price`, `nodes`, `amount`): the package carries
   them and their tests. `turnstile.ts` and `ratelimit.ts` stay while the sign-in uses them (or use `turnstileCheck`, `d1Limit` and `visitorKey`
   from the package: the same rows). `src/shared/amount.ts` goes when nothing else imports it.
5. The page: `mountShop` with `key: false` (the starter's own Looks keys call `shop.open()`), `signIn` opening the starter's sign-in sheet,
   `onOwned` reading `/api/me` again and wearing an outfit, `personCheck` with the starter's Turnstile. Delete `src/client/ui/{looks,pay}.ts`
   and the looks and pay rules of `style.css`; set the `--n133-*` variables from the starter's `:root`. `ui/qr.ts` (and `qrcode-generator`)
   stays while the sign-in sheet draws its QR code (or use `qrSvg` from `@nano133/nanoterra/shop/panel`).
6. Keep the starter's route tests (`admin.test.ts` "test mode" and "never shows one player's order to another"): they pass unchanged.

### What the shop does not do

- **Sign a player in.** It takes the game's signed-in player (`player(request)`) and asks the game for a sign-in (`signIn()`); the kit's
  player sign-in (wallets and a passkey) is its own path.
- **Send money back.** It holds no key: a late payment is listed (`"paid_late"`), and the creator sends it back by hand.
- **Sell anything random**, or anything that changes a score, a speed or a rule: a look only changes how the character looks.

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
- First-person arms, swimming, climbing and the room's other moves: only idle, walk, run, jump and wave, and the emotes (`/emotes`, which sit too).
- Shared geometry for many characters at once, and a react-three-fiber wrapper.
- `WebGPURenderer`: the ink is a GLSL `ShaderMaterial`, so use `WebGLRenderer`.
- A creator option to accept Berry Wallet only.
- Move money. The shop (`/shop`) reads the Nano ledger to see a payment to the creator's address; no part of the package holds a key or sends.

## Build and test

```sh
npm install      # at the kit's root
npm run build -w @nano133/nanoterra
npm test -w @nano133/nanoterra
```

MIT license.
