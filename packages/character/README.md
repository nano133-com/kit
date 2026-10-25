# @nano133/character

Stage: Pre-alpha. What this means: https://nano133.com/stages

The character of [Nanoterra](https://nano133.com/build/nanoterra), nano133.com's
island, for a plain Three.js game. A creator's game can show the same character
that a player has on the island, coloured with the player's look: a round
toon body in a shirt, a face, hair, arms and legs, with the island's ink
outline, a toon blob shadow and its idle, walk, run, jump and wave.

It is plain Three.js: no React, no react-three-fiber, no runtime dependency,
nothing from the site. It builds and animates in Node too (no canvas needed for
the geometry), so it is easy to test.

Pre-alpha means: the shape of the API may still change, and it has not been run
on a real phone yet (see "Draws, quality, speed and size").

## Install

```sh
npm install @nano133/character three
```

`three` is a peer dependency (`^0.186.0`).

## Example: plain Three.js

A page with no build step (an import map; with a bundler, leave the import map out):

```html
<script type="importmap">{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",
  "@nano133/character": "https://cdn.jsdelivr.net/npm/@nano133/character@0.1.0/dist/index.js" } }</script>
<script type="module">
import * as THREE from "three";
import { createCharacter, defaultLook } from "@nano133/character";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color("#8fc4f0");
const sun = new THREE.DirectionalLight("#fff0c8", 2.75);
sun.position.set(4, 7, 5);
scene.add(new THREE.HemisphereLight("#d6e9ff", "#e2b98c", 1.8), sun);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 3.5, 9);
camera.lookAt(0, 1.2, 0);

const c = createCharacter({ look: defaultLook() }); // or the player's own look
scene.add(c.object, c.shadow);
addEventListener("pointerdown", () => c.wave());
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  c.update(clock.getDelta(), { speed: 3.75 }); // walking in place
  renderer.render(scene, camera);
});
</script>
```

## Example: Vite

`npm create vite@latest`, then `npm install three @nano133/character`, then
this as `src/main.ts` (arrow keys walk, Shift runs, Space jumps):

```ts
import * as THREE from "three";
import { createCharacter, defaultLook } from "@nano133/character";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor("#8fc4f0");
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
const sun = new THREE.DirectionalLight("#fff0c8", 2.75).translateX(4).translateY(7).translateZ(5);
scene.add(new THREE.HemisphereLight("#d6e9ff", "#e2b98c", 1.8), sun);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 4, 10);
camera.lookAt(0, 1.2, 0);

const hero = createCharacter({ look: defaultLook() });
scene.add(hero.object, hero.shadow);
const keys = new Set<string>();
addEventListener("keydown", (e) => keys.add(e.code));
addEventListener("keyup", (e) => keys.delete(e.code));
let vy = 0;
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const dir = Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
  const speed = Math.abs(dir) * (keys.has("ShiftLeft") ? 6.5 : 3.75);
  const p = hero.object.position;
  p.x += dir * speed * dt;
  if (dir) hero.object.rotation.y = dir * (Math.PI / 2); // it faces +Z: this turns it to +X or -X
  if (keys.has("Space") && p.y === 0) vy = 8;
  p.y = Math.max(0, p.y + (vy -= 26 * dt) * dt);
  if (p.y === 0) vy = 0;
  hero.update(dt, { speed, airborne: p.y > 0, verticalSpeed: vy }); // the shadow stays on the floor under it
  renderer.render(scene, camera);
});
```

The lights are the island's golden hour. Any lights work: the toon material
needs at least one. Draw with no tone mapping (the Three.js default), so the
colours are the island's.

## The API

```ts
import { createCharacter, HEIGHT, RADIUS, LOOK_PARTS, defaultLook, isLook } from "@nano133/character";

const c = createCharacter({ look, quality: "high" });
scene.add(c.object, c.shadow);
c.update(dt, { speed, airborne, verticalSpeed });
c.wave();
c.setLook(otherLook);
c.dispose();
```

| Call | What it does |
|---|---|
| `createCharacter({ look?, quality?, reducedMotion? })` | Builds a character. `look` is `{ skin, hair, shirt, pants, shoes }`, each `"#rrggbb"` (left out: `defaultLook()`). `quality` is `"high"` (default) or `"low"`. A bad look or quality throws a `TypeError` that names the part and the value. |
| `c.object` | A `THREE.Group`: feet at y = 0, facing +Z, `HEIGHT` metres tall. Add it to your scene; move it with `position`, turn it with `rotation.y`. It holds the skinned meshes. |
| `c.shadow` | A `THREE.Mesh`: the toon blob shadow, a flat dark disc of radius 0.62 m, lying 0.02 m over its own origin (so it does not flicker on a floor). It is not a child of `c.object`: add it to the same parent (the scene). `update` keeps it at the character's x and z, scales it with `c.object.scale` and shrinks it in a jump. Its y is yours: 0 for a floor at y = 0, or set `c.shadow.position.y` to the ground each frame (a slope, a platform). |
| `c.update(dt, { speed, airborne, verticalSpeed })` | One frame. `dt` is in **seconds** (a frame longer than 0.05 s counts as 0.05 s). Idle, walk, run and jump come from your numbers. Every field is optional. See "Motion". |
| `c.wave()` | Waves the left arm for 1.8 s (`WAVE_SECONDS`), as the island does. |
| `c.setLook(look)` | Changes the colours. It builds no geometry. A bad look throws and changes nothing. |
| `c.look` | The look now (a frozen copy). |
| `c.reducedMotion` | A boolean you may change: true turns off the swing of the arms and legs and the bob, and makes the wave still. Set it from `prefers-reduced-motion`. |
| `c.dispose()` | Frees the geometries, materials and textures that the character made, and takes `object` and `shadow` out of their parent. The other calls do nothing after it. |

Also exported: `HEIGHT`, `RADIUS`, `LOOK_PARTS`, `LOOK_KEYS`, `defaultLook()`,
`isLook(value)`, `lookProblem(value)` (the problem as a sentence, or `null`),
`assertLook(value)` and `WAVE_SECONDS`.

### Motion

`speed` is the speed over the ground in metres a second (not a velocity: the
direction is `object.rotation.y`, which you set). It is eased, as on the island.

| `speed` | What shows |
|---|---|
| 0 to 0.25 | Idle: arms 0.2 rad out, elbows a little bent. |
| 0.25 and more | A walk: legs and arms swing against each other, the hips bob and lean. The swing is full at 3 m/s. The island walks at 3.75 m/s. |
| 3.4 to 5 | The walk blends into a run: more swing, more bend at the elbows, more lean. The island runs at 6.5 m/s. |
| 9 and more | The same as 9. |

`airborne: true` shows the jump pose at once, whatever the speed: arms out, legs
apart. `verticalSpeed` (metres a second, up is positive) is used for the
shadow only: it adds up while the character is airborne to an estimate of the
height over the take-off place, and the shadow shrinks with it, to 0.55 of its
size, as the island's does. A character that is made smaller or larger than
`HEIGHT` by `object.scale` should be given `speed / scale` and
`verticalSpeed / scale`.

The first pose, before any `update`, is the idle pose.

### The look

A look is five parts, each `"#rrggbb"` (a `#` and six hex digits, any case):

| Part | What it paints |
|---|---|
| `skin` | The head, the hands. |
| `hair` | The hair cap and the back of the head. |
| `shirt` | The torso and the arms. |
| `pants` | The belt band, the thighs, the knees, the shins. |
| `shoes` | The shoes. |

The eyes, the mouth and the gold badge on the chest keep their own colours.
`LOOK_PARTS` lists the free colours that a player picks from on the island, for
each part (8 skins, 8 hairs, 8 shirts, 4 pants, 4 shoes). A look may hold any
`"#rrggbb"`: the island's shop sells shirt dyes that are not in the five.
`isLook(value)` is true for a good look. Extra keys on a look are ignored.
Nothing else is checked: you decide which looks your game accepts.

## Units, size and the collider

The model is built in metres, at the size of the island's avatar: a game that
sits beside the island's world has the same scale.

| | |
|---|---|
| `HEIGHT` = 2.29 m | From the soles (they dip 0.008 m under y = 0) to the top of the hair. |
| `RADIUS` = 0.49 m | The trunk: the widest part of the body without the arms. Use it as the radius of a cylinder or capsule collider. |
| Facing | +Z. `object.rotation.y = Math.atan2(dx, dz)` turns it to walk along (dx, dz). |
| Its left | +X (the character's own left hand is at +X). |

The arms reach further than `RADIUS`: hands hang 0.6 m from the middle at rest,
about 0.77 m in the idle pose, 0.94 m forward in a run, 1.27 m wide in a jump.
Keep them out of your collider unless you want them to push on walls. nano133.com's
own island uses a smaller collider (0.35 m radius, 2.0 m tall) so that the
avatar can pass close to things. To change the size, set `c.object.scale`
(the ink line keeps its width in pixels).

## Draws, quality, speed and size

| | `quality: "high"` | `quality: "low"` |
|---|---|---|
| Draws | 2 (toon body, ink outline) + the shadow | 1 (toon body) + the shadow |
| Triangles | 6,512 + 20 for the shadow | 3,532 + 20 |
| What it costs | | No outline: the character reads flatter against a background of its own colours. |
| What it saves | | One draw and 8,940 skinned vertices (46% of the triangles) each frame. |

`"low"` keeps every shape and colour: only the ink pass goes. Choose it for
slow phones. It is fixed when the character is made.

- `update` takes about 2 microseconds (Node, M-series Mac). Building a character
  takes about 3 ms, and `setLook` 0.05 ms.
- Each character builds its own geometry (about 1.1 MB). A scene with many
  characters at once should keep this in mind; sharing the geometry is a later step.
- The meshes are not frustum-culled (the bones move every frame, so a fixed bound
  would be wrong, as on the island). Set `c.object.visible = false` (and the same
  for `c.shadow`) for a character that is far from the camera or off screen.
- Size of the package's code: 15.4 kB minified, 6.1 kB gzipped, without Three.js
  (measured 2026-10-24: `esbuild dist/index.js --bundle --minify --format=esm --external:three`, then `gzip -9`).
- It was built for a phone: 3 draws and about 6.5 thousand triangles, no textures
  but a 3-pixel ramp and the bone texture. **Frame rate has not been measured on a
  real phone yet.**

The ink line is a second draw of the same skinned mesh, with its back faces,
pushed out along its normal in screen space, so it keeps one width in pixels (2.6)
near and far. It reads the size of the renderer's viewport before each draw, so
there is nothing to call when the canvas is resized.

## How it matches the island

The geometry, the skeleton, the colours, the toon ramp, the ink and the walk are
ported from the code of nano133.com's island avatar (the same shapes and the same
numbers), without React. It was checked against the live island avatar on
2026-10-24:

- The body's 10,596 vertices and the ink's 8,940 match the island's, number for
  number (positions, normals, bone indices and weights, colours): the largest
  difference is 3e-16.
- The 28 bone names, their order and their parents are the island's.
- An idle picture (three views, three looks) is identical to the island's, pixel for
  pixel, in the same light and camera. A walking and a running frame, drawn in the
  island's own bone state, differ in a few edge pixels at the rim of the shadow only
  (the island's shadow is part of its body mesh; here it is a mesh of its own).
- The idle, walk and run poses of the island's avatar, and a real jump on the island,
  are within 0.01 of this package's poses (every bone's turn and the hips' height,
  compared frame by frame; the island's speed reading has noise, so each frame is
  matched at the nearest speed).

The tests in `test/` hold the package to these numbers.

## What it does NOT do yet

- Worn items (cosmetics: hats, scarves, capes, companions). The place for them is
  `src/worn.ts`: they will be more pieces in the same two geometries, so a worn
  item adds no draw. A later version adds them.
- The katana, the saya, the headband and the dojo look of the island's Ananos game.
  (The skeleton keeps their bones, with no vertices.)
- First-person arms.
- Swimming and climbing out of water.
- Other animations (sit, emotes): only idle, walk, run, jump and wave.
- Shared geometry for many characters at once, and a react-three-fiber wrapper.
- `WebGPURenderer`: the ink is a GLSL `ShaderMaterial`, so use `WebGLRenderer`.
- Any server or Nano code. This package draws a character; it moves no money.

## Build and test

```sh
npm install      # at the kit's root
npm run build -w @nano133/character
npm test -w @nano133/character
```
