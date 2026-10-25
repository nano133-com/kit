# Changelog

## 0.1.0

- First version (Pre-alpha): the Nanoterra island character for a plain Three.js
  game. `createCharacter({ look, quality, reducedMotion })` gives an object with
  `object`, `shadow`, `update(dt, { speed, airborne, verticalSpeed })`, `wave()`,
  `setLook(look)`, `look`, `reducedMotion` and `dispose()`.
- The island's body, skeleton (28 bones), colours, toon ramp, ink outline and
  walk, run, jump, idle and wave, ported without React. Checked against the live
  island avatar: the same vertices and the same idle picture, pixel for pixel.
- 2 draws (toon body, ink outline) and a separate shadow mesh that `update` keeps
  under the character. `quality: "low"` drops the ink draw.
- `HEIGHT` (2.29 m) and `RADIUS` (0.49 m) for a collider; `LOOK_PARTS`,
  `defaultLook()`, `isLook()`, `lookProblem()` and `assertLook()` for the look.
- Left out for now: worn items (cosmetics), the katana, the saya, the headband,
  first-person arms and swimming.
