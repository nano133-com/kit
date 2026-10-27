import * as THREE from "three";

// The toon look of nano133.com (app/arcade/toon.ts), for one character: three flat tones on every lit surface, and a
// dark ink line around the shape.
//
// - The tones: MeshToonMaterial with a 3 x 1 ramp (96, 182, 255), nearest-filtered, so light falls in three flat steps.
// - The ink: an inverted hull. A second draw of the same skinned mesh with its back faces, each vertex pushed out along
//   its normal IN SCREEN SPACE, so the line keeps one width in pixels near and far. The hull keeps the canvas size in its
//   own uniform: it reads the renderer's size each time it is drawn, so the game has nothing to call.

/** The ink line's colour. */
export const INK = "#1d1530";
/** The ink line's width in CSS pixels (the island's avatar uses 2.6). */
export const INK_WIDTH = 2.6;

/** The 3-step light ramp. The character owns it and frees it in `dispose`. */
export function makeRamp() {
  const data = new Uint8Array([96, 96, 96, 255, 182, 182, 182, 255, 255, 255, 255, 255]);
  const ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

/** The body's material: white, so the colour of each vertex shows as it is. */
export function toonMaterial(ramp: THREE.Texture) {
  return new THREE.MeshToonMaterial({ color: "#ffffff", gradientMap: ramp, vertexColors: true });
}

const INK_VS = /* glsl */ `
uniform float width;
uniform vec2 res;
uniform vec2 fade;
#include <common>
#include <batching_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
void main() {
  #include <batching_vertex>
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  #include <fog_vertex>
  // defaultnormal_vertex turns the normal round for a back-side material; the hull pushes along the real one.
  #ifdef FLIP_SIDED
    transformedNormal = -transformedNormal;
  #endif
  vec2 d = normalize(transformedNormal).xy;
  float l = length(d);
  d = l > 1e-5 ? d / l : vec2(0.0);
  // Far away the line thins (to a quarter at fade.y metres), so a small far shape does not turn into a dark blob.
  float thin = 1.0 - 0.75 * smoothstep(fade.x, fade.y, -mvPosition.z);
  gl_Position.xy += d * (2.0 * width * thin / res) * gl_Position.w;
}`;

const INK_FS = /* glsl */ `
uniform vec3 color;
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(color, 1.0);
  #include <fog_fragment>
}`;

/** The ink hull's material: `width` in CSS pixels. `res` is the canvas size in CSS pixels (the hull's mesh keeps it). */
export function inkMaterial(width = INK_WIDTH) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      color: { value: new THREE.Color(INK) },
      res: { value: new THREE.Vector2(1024, 1024) },
      // From 8 metres the line starts to thin, to a quarter of its width at 40 metres.
      fade: { value: new THREE.Vector2(8, 40) },
      width: { value: width },
    },
    vertexShader: INK_VS,
    fragmentShader: INK_FS,
    side: THREE.BackSide,
    fog: true,
  });
}

const _viewport = new THREE.Vector4();

/**
 * Makes the hull's mesh copy the renderer's viewport size (CSS pixels: the canvas, or the part of it that the game draws
 * in) into the ink's `res` before each draw, so the line keeps its width in pixels.
 */
export function followCanvas(hull: THREE.Mesh, material: THREE.ShaderMaterial) {
  hull.onBeforeRender = (renderer) => {
    renderer.getViewport(_viewport);
    material.uniforms.res.value.set(Math.max(1, _viewport.z), Math.max(1, _viewport.w));
  };
}
