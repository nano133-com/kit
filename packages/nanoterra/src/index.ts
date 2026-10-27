// "@nano133/nanoterra": the small part. Two types, and nothing that loads: no Three.js, no code at all.
//   import type { Look, LookRecord } from "@nano133/nanoterra";
// The rest is on its own paths, so a page loads only what it uses:
//   "@nano133/nanoterra/ticket"            read a sign-in ticket in the browser (no Three.js)
//   "@nano133/nanoterra/character"          the player's character, drawn with Three.js (three is an optional peer)
//   "@nano133/nanoterra/character/record"   the character's record, packed, checked and changed, with no package at all
//   "@nano133/nanoterra/looks"              the looks ladder: looks.json, the prices, what a change does to the owners

/** A player's five colours (skin, hair, shirt, pants, shoes: each "#rrggbb"): every Nanoterra game has read them. */
export type { Look } from "./character/look.js";
/** A player's whole character as whole numbers on closed lists: the base, the face, the hair, the clothes, the sizes and the colours. */
export type { LookRecord } from "./character/record.js";
