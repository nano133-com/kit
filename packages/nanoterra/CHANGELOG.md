# Changelog

## Unreleased

(Not published. The version is set when Wes decides to publish.)

- **Slots** on a look (`@nano133/nanoterra/looks`, and the Shelf of `/admin/panel`): `slots?: Record<string, string>`, what a game defines for itself (a pair of wings, a trail colour). Names are 1 to 24
  lowercase letters, digits or dashes starting with a letter; values are words (1 to 40 lowercase letters, digits or dashes) or `#rrggbb` colours; at most 8 on a look. `lookProblems` checks them
  (`slots`, `slots.<name>`), `checkLooks` keeps them, `looksJson` writes them after `change`, `diffLooks` lists a change as the field `"slots"` (order and the case of a colour are not changes), and
  `removalProblems` reports a changed slot on a look that a player owns (players own a look by its id; a price, a name, a colour or a hat of an owned look stays allowed). New: `sameSlots`,
  `cleanSlots`, `slotValueOk`, `SLOTS_MAX`, `SLOT_NAME_PATTERN`, `SLOT_WORD_PATTERN`, the type `Slots`. A file from before slots reads and writes exactly as it did. The Shelf keeps the slots in its
  draft and has a Slots editor. This is a minor change (0.2.0); a game on 0.1.0 drops slots, so it must move to the new version.
- **`@nano133/nanoterra/admin`** (step 1 of the admin panel): the admin of a game, in the package, with no Three.js, no database and no cookie. The game gives a session and a store.
  - `adminAccess(input)`: the guard, ONE pure function. The same five checks as the game starter's `adminGuard`, in the same order (owner set, session present, wallet login,
    same address, not older than one day). It only refuses MORE than the starter does: a bad owner address, a time that is not a number or lies more than five minutes in the
    future, a login word that is not exactly "wallet", and a limit above one day are all refusals. A fault inside it is a refusal.
  - `createAdminHandler(options)`: the routes (summary, the two game switches, the payment check) on Web `Request` and `Response`. Every path under the base goes through the
    guard first, so a visitor learns nothing about the routes. A POST must come from the game's own page. No CORS header, always `no-store`, a body limit, a rate limit.
  - `AdminStore`: what a game gives (read the two settings, save a checked patch, the summary). The only writes are the two `setting:` values.
  - `loadGameSettings(store, defaults)`: the two switches for the game's own routes (the listing file, the character); the defaults when the store fails.
  - `createMemoryStore()`: a store in memory, for tests.
- **`@nano133/nanoterra/admin/panel`** (step 2): `mountAdmin(element, options)`, the admin page in plain DOM with no framework: the Game card, the status warnings, the totals, the Shelf (the
  starter's, moved here: it edits a draft and gives text to copy, and sends no request), the orders with "Paid late" and an optional "Check payments now", the looks that players own,
  and the screens for a visitor who is signed out, a wrong wallet, a Nanoterra sign-in and a missing owner address. The game gives `signIn`, `signOut` and its `looks`.
  `@nano133/nanoterra/admin/style.css`: its stylesheet, every rule under `.n133-admin`. The summary of the handler now says `canCheck`.
- **`@nano133/nanoterra/admin/d1`** and **`/admin/firestore`** (step 3): `createD1Store(db)` (the game starter's tables, with the starter's own queries) and `createFirestoreStore(db, names?)` (a small interface; no
  Firebase dependency). Both write ONLY the two settings. `adminStoreConformance(make)` (in `/admin/conformance`) is the store contract that every adapter passes: the memory store, D1 on SQLite and Firestore on a fake.
  The summary's numbers come from one file (`summarize`, `moneyOf`, `shapeOrders`), so every adapter says the same thing. The memory store now takes orders with a raw `amountRaw`, like a real database.
- **The Game card's words for sign-in Off** (Wes, "off means off"): "Sign-in from Nanoterra is Off, so every player plays as the island's first character, a player who signed in from Nanoterra before
  included." The card only says it: the game's own page must draw no Nanoterra character while sign-in is Off (the game starter's `src/client/ui/player.ts` does).
- **Who signed in, and "Sign out everywhere"** (optional, Wes's security ideas): `AdminLogin` (time, country, short browser name) and the optional store calls `recentLogins(limit)` and
  `signOutEverywhere()`. With them the summary has `logins` (the last 10, only those three things, whatever the store gives) and `canSignOutEverywhere`, the handler has `POST {base}/signout-all`
  (guarded, same origin, 5 a minute, deletes the admin sessions and no player session), and the panel has a Sign-ins card with a two-press "Sign out everywhere". `createD1Store(db, { logins: true })`
  reads `admin_logins` and deletes `sessions WHERE scope = 'admin'`. Memory store: `createMemoryStore({ logins: true })`. The store contract has cases for both. The panel option `loginsNote` says what
  the game keeps and for how long (30 days suggested).
- **`@nano133/nanoterra/admin/conformance`**: `adminConformance(host)` gives test cases that a game runs against its OWN session code and store: every route refuses a visitor
  who is signed out, a login made for the game's players (also its token in the admin cookie), a Nanoterra sign-in, a login made some way the game does not know, another wallet, a missing
  owner address, an expired login and a login that is old but still valid in the store; OPTIONS and HEAD are refused with no preflight answer; other spellings of an admin path open nothing with
  any method; the game's other routes under the base (`otherRoutes`) refuse a visitor; a POST from another site is refused; a body that is too big is refused; every answer is `no-store` with
  no CORS header. (The first version of this suite passed four wirings that leak everything; a security read found them, and each is a test now.)
- **A fourth security read** (the same fresh agent as the third, 2026-10-27, on the third-read fixes) found that `adminSigninConformance` still passed wrong chains: one with no binding of a request to its
  browser inside one scope, one whose cross-scope ask gave a login in the STORED scope, one whose `sign()` stopped landing (the checks then ran on an unsigned request), one that checked the scope only
  while the request was fresh, one whose Sign out everywhere left a request that was still waiting for a signature, and one with no `signOutEverywhere` at all (the case was skipped). Fixed: `sign()` must
  throw on a refusal; a cross-scope ask must give no login of either kind and the request must still sign in afterwards (the signature is proven to have landed); a same-scope ask from another browser gives
  none; the host may give `advance(ms)` to repeat the asks after the admin's request life; `adminSigninConformance(host, { signOutEverywhere: true })` fails a host that has no call; the store contract
  REQUIRES `seedRequests` and `pendingRequests` when the store has `signOutEverywhere`. `createD1Store(db, { logins: true })`'s `signOutEverywhere` also ends the pending admin requests
  (`expires_at = 0`). Eight fake chains (one good, seven wrong) run against the contract.
- **A third security read** (another new fresh agent, 2026-10-27) found that the suite still passed four wirings that leak: a game that caches 200 answers by URL, one that keeps the sessions it has read
  in memory (a login that sign-out or Sign out everywhere ended still opens), one that also reads a player's token from a Bearer header, and one that reads it from the query. Fixed: the suite sends every
  refused visitor again right after the owner was served; `host.endLogin` and the login that used Sign out everywhere are used again and must be refused; `req.tokenAt` sends a player's token in other
  places than the cookie; and `adminSigninConformance(host)` is a contract for the code that MAKES the logins (a game request never makes an admin login and the other way round, for the browser that
  started it, another browser and retyped credentials; once; and a signed admin request makes no login after Sign out everywhere). `createD1Store(db, { logins: true })`'s `signOutEverywhere` also marks
  the admin sign-in requests that were not delivered as delivered (needs `signin_requests.scope` and `.delivered`). The list shows a browser name only when it is words. Four tests run the four wirings
  against the suite, and three fake sign-in chains run against the contract (one good, three wrong).
- **A second security read** (new fresh agent, 2026-10-27) found that the second conformance suite still passed some wirings that leak or act. Fixed: the suite sends a foreign Origin (another site,
  `"null"`, a sibling subdomain) and Sec-Fetch-Site cross-site and same-site on every route with every method, for the owner too; it sends an old login that is still valid THREE times (the last two
  with `req.again`) so a rolling session fails; `expired_login` is now made less than a day ago so only the game's own store can refuse it; new kind `signed_out_login`; the spelling tricks run on
  every route and method; the game's other routes must refuse with a refusal that carries no data. **The handler now refuses a read that says it comes from another page**, as it refused a write.
  Looks: `wholeCents` is exact (`0.300000001` and `1e-9` no longer pass); a slot colour is written in lower case (a change of only its case is no change); the names `constructor` and
  `prototype` are reserved; `checkLooks` checks and copies one snapshot; the Shelf never gives an id that a player owns to a new look.
- **Fixes from a security read of the first admin code:** odd spellings of the base path (a bad percent code, backslashes, many levels of encoding) now reach the guard instead of falling through;
  a fault in the game's `now()` or `onError()` can no longer reject `handle()` with the raw error; the default limiter is keyed by base path and owner, so two games in one process do not share a
  count; the message for an AI assistant takes only valid look ids, written as JSON strings (an id from a database cannot write a line into it); the summary counts only the four statuses it knows
  and reads a dollar text only when it is plain dollars.

## 0.1.0

First version (Pre-alpha). **One package for Nanoterra.** It replaces `@nano133/character` 0.1.0, `@nano133/ticket` 0.1.0 and
`@nano133/looks` 0.1.0 (their npm versions stay; they are deprecated and point here).

- **`@nano133/nanoterra/character`**: the character is now the one that nano133.com's island and 3D room draw, from the same code. Six bases
  (Classic, Round, Critter, Bee, Robot, Pineapple), faces, hair, clothes, sizes and colours, from a **record** of whole numbers on closed lists.
  `createCharacter({ record, look, colors, quality, reducedMotion })` gives `object`, `update(dt, { speed, airborne, verticalSpeed })`,
  `wave()`, `setLook(recordOrFiveColours)`, `setColors(colors)`, `record`, `look`, `reducedMotion` and `dispose()`. `setLook` to another body builds new
  geometry and frees the old; a new colour only repaints. The default Classic is the old package's character, vertex for vertex.
  Also exported: `buildCharacter` and `assemble` (the geometry and the skinned meshes on the island's 28-bone skeleton), the lists, `WornAdapter`.
- **Changed from `@nano133/character` 0.1.0:** the blob shadow is a disc in the body (on the skeleton's shadow bone), so there is no `c.shadow` and one
  `scene.add(c.object)` is enough; it stays on the ground under a jump. A colour that is not on the island's lists (a shop dye) goes through `setColors`
  (`setLook` takes a record or the five colours of the lists). `HEIGHT` and `RADIUS` are the default Classic's.
- **`@nano133/nanoterra/character/record`**: the record with no Three.js and no package at all: `packRecord` and `unpackRecord` (two whole numbers; `null` for
  anything off a list), `recordProblem`, `clean`, `fromLegacy` and `toLegacy` (the five colours; all 8,192 old looks come back whole), `withLegacy`, `withBase`,
  `diceRecord`, `fromBlob` and `toBlob` (the room's blob), the lists, `defaultLook`, `isLook`, `lookProblem`, `assertLook`, `LOOK_PARTS`.
- **`@nano133/nanoterra/ticket`**: `readTicket`, `verifyTicket`, `fetchKeys`, `ticketFromHash`, `hashWithoutTicket`, as in `@nano133/ticket` 0.1.0, and the
  ticket's **`record`** when it carries one (read with care; absent for a ticket from before it, and then the answer reads exactly as it did). The same pinned
  ticket is checked byte for byte here and in nano133.com's own test.
- **`@nano133/nanoterra/looks`**: `@nano133/looks` 0.1.0 as it was (`checkLooks`, `lookProblems`, `removalProblems`, `diffLooks`, `looksJson`, `slugId`,
  `PRICE_LADDER`, `rungOf`, `priceText`, `usdText`, `wholeCents`, `HATS`).
- **`@nano133/nanoterra`**: the types `Look` and `LookRecord`, and nothing that runs. Importing the record, the ticket, the looks or this path loads no Three.js
  (a test reads the built files and proves it). `three` is an optional peer dependency (`>=0.174.0`).
- Body only. The island's 14 worn items are not in this package: the builder takes them through the `WornAdapter` interface, and a later version (0.2.0) adds
  the item art. A player's item ids are in the sign-in answer.
