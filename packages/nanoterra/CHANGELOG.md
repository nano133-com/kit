# Changelog

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
