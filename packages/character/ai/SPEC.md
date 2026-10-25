# Nanoterra character for Three.js: implementation spec

Follow these steps in order. Each step ends with a check. Ask the owner when a
step says "ask". Package: `@nano133/character`, version 0.1.0, stage Pre-alpha.

The package draws one character: the island's body, ink outline, shadow, and
its idle, walk, run, jump and wave. It has no worn items (cosmetics), no
katana, no swimming and no first-person arms yet. It contains no network, wallet
or Nano code. Read the package README first.

## 0. What the owner decides (ask)

1. Where each player's look comes from: a fixed look, the player's own picker,
   or a look that the server stores. A look is five colours.
2. The quality: `"high"` (toon body and ink outline, 2 draws) or `"low"` (no
   outline, 1 draw, for slow phones).
3. How the game moves the character: its speed in metres a second, its
   gravity and its jump. The package animates; it does not move the object.

**Check:** the owner has named the source of each look and the quality.

## 1. Install

```sh
npm install @nano133/character three
```

`three` must be version 0.186. The package imports only `three`.

**Check:** `import { createCharacter } from "@nano133/character"` builds and
runs.

## 2. The scene

- Draw with no tone mapping (the Three.js default). The toon material needs at
  least one light. The island's look is a `HemisphereLight("#d6e9ff", "#e2b98c", 1.8)`
  and a `DirectionalLight("#fff0c8", 2.75)` from up, front and to one side.
- The character is 2.29 m tall (`HEIGHT`). Size the game's world to metres, or
  scale `object` and pass `speed / scale` to `update`.

**Check:** a character added to the scene shows its toon colours and an outline.

## 3. Make the character

```ts
const c = createCharacter({ look, quality: "high" });
scene.add(c.object, c.shadow);
```

- `c.object` has its feet at y = 0 and faces +Z. Set `c.object.position` to the
  player's feet and `c.object.rotation.y = Math.atan2(dx, dz)` for a direction.
- `c.shadow` is not a child of `c.object`: add it to the same parent. `update` keeps it
  at the character's x and z and scales it. Its y is yours: 0 for a floor at y = 0, or
  set `c.shadow.position.y` to the ground each frame.
- Use `HEIGHT` (2.29 m) and `RADIUS` (0.49 m, the trunk) for a collider. The
  hands reach further when they move (up to 0.94 m in a run, 1.27 m in a jump):
  keep them out of the collider.

**Check:** the character stands on the ground, faces the way it walks, and its
shadow lies under it.

## 4. Drive it

Call once each frame, before the render:

```ts
c.update(dt, { speed, airborne, verticalSpeed });
```

- `dt` is in seconds, not milliseconds. A frame longer than 0.05 s counts as 0.05 s.
- `speed`: metres a second over the ground. 0 is idle, from 0.25 a walk (full swing
  at 3), from 3.4 to 5 a run. The island walks at 3.75 and runs at 6.5.
- `airborne`: true while off the ground (a jump or a fall). It shows the jump pose.
- `verticalSpeed`: metres a second, up is positive. It sizes the shadow in a jump.
- Set `c.reducedMotion = true` when the player asks for less motion.
- `c.wave()` waves the left arm for 1.8 s.

**Check:** idle, walk, run and jump each look different. The legs do not slide
on the ground at the game's walking speed.

## 5. The look

- A look is `{ skin, hair, shirt, pants, shoes }`, each `"#rrggbb"`.
- A look that comes from a player, a file or a server is data you did not write.
  Check it with `isLook(look)` (or `lookProblem(look)` for the reason) before
  `createCharacter({ look })` or `c.setLook(look)`; both throw a `TypeError` on a
  bad look. `LOOK_PARTS` lists the island's free colours for a picker.
- `c.setLook(look)` changes colours only and builds no geometry. Change it as often
  as needed.

**Check:** `setLook` changes the colours at once; a bad look is refused with a
message and the character keeps its colours.

## 6. Clean up

Call `c.dispose()` when a character leaves the game. It frees the geometries,
materials and textures that the character made and removes `object` and `shadow`
from the scene.

**Check:** after `dispose`, the renderer's `info.memory` counts fall.

## 7. Do not

- Do not edit the geometry, the skeleton or the toon and ink materials.
- Do not add the katana, the headband, worn items or other brands' art: this
  version has none of them.
- Do not use a look for a game's rules, a score or a payment: it is display only.
