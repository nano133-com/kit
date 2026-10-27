// What the island's own avatar is, read from nano133.com on 2026-10-24 (app/island/art/skeleton.ts, and the avatar's
// geometry read from the live avatar on /cosmetics-dev/wear in a browser). The tests hold the package to these numbers.

/** The island's skeleton: the bone names in order, each with its parent. */
export const ISLAND_BONES: readonly (readonly [string, string | null])[] = [
  ["root", null],
  ["hips", "root"],
  ["spine", "hips"],
  ["chest", "spine"],
  ["neck", "chest"],
  ["head", "neck"],
  ["clavicle_L", "chest"],
  ["upperarm_L", "clavicle_L"],
  ["forearm_L", "upperarm_L"],
  ["hand_L", "forearm_L"],
  ["clavicle_R", "chest"],
  ["upperarm_R", "clavicle_R"],
  ["forearm_R", "upperarm_R"],
  ["hand_R", "forearm_R"],
  ["grip_R", "hand_R"],
  ["thigh_L", "hips"],
  ["shin_L", "thigh_L"],
  ["foot_L", "shin_L"],
  ["thigh_R", "hips"],
  ["shin_R", "thigh_R"],
  ["foot_R", "shin_R"],
  ["saya", "hips"],
  ["weapon", "root"],
  ["band_L1", "head"],
  ["band_L2", "band_L1"],
  ["band_R1", "head"],
  ["band_R2", "band_R1"],
  ["shadow", "root"],
];

/**
 * The island avatar's geometry with the default look, as sums that weigh each number by its place in the array
 * (so a moved or swapped vertex changes the sum). The island's toon geometry also holds the 60 vertices of its shadow
 * disc, which this package makes a mesh of its own: the sums are of the body's vertices only.
 */
export const ISLAND_GEOMETRY = {
  toonVerts: 10596,
  hullVerts: 8940,
  toonPos: 88620.82391043464,
  toonNor: 286.4721730938181,
  toonColor: 73235.55919339135,
  toonIdx: 1297636,
  toonW: 74174.04565924406,
  hullPos: 64294.04419813551,
  hullNor: 324.73293970990926,
  hullIdx: 1185976,
  hullW: 62587.04565924406,
} as const;

/** The same weighted sum, for an array. */
export function weighted(a: ArrayLike<number>, n = a.length): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * ((i % 13) + 1);
  return s;
}
