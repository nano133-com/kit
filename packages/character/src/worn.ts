import type { AddPiece, Buffers } from "./body.js";

// THE PLACE FOR WORN ITEMS (a later version). On nano133.com the island's avatar can wear cosmetics (a hat, a scarf, a
// cape): each is more pieces in the SAME two geometries, bound to the same skeleton, so a worn item adds no draw.
// `buildBody` calls `addWorn` after the body's own pieces. Version 0.1.0 wears nothing, so this adds nothing.
//
// A worn item will:
//   - call `add(geometry, matrix, part, bones, ink)` for each of its pieces (the same call as the body's pieces), or
//     push to `buffers` directly when it paints its own colours;
//   - hang its own bones (a cape, a scarf's tails) under the skeleton's, after the skeleton's list (./character.ts, where
//     the Skeleton is made), and turn them each frame after the solver (./pose.ts).
export function addWorn(_add: AddPiece, _buffers: Buffers): void {}
