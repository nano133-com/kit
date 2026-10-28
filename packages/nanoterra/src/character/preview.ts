import * as THREE from "three";
import { createCharacter, type Character } from "./create.js";
import type { LookRecord } from "./record.js";

// A picture of a look on the real character, for the Shelf of /admin (or any page): the character is built and dressed once, one frame is
// drawn with ONE shared offscreen WebGL renderer, and the picture (a PNG data URL) is kept by the look's text, so the same look is drawn
// once. Pictures are drawn one at a time. With no WebGL, `render` answers null and the page keeps its flat picture.
//
// The Shelf (`@nano133/nanoterra/admin/panel`) has no Three.js: give it `previewPicture(load)`, where `load` imports your preview file
// dynamically, so this file loads only when the Shelf opens (the game starter's src/client/admin.ts does it).

/** What draws one look: the game's own character dressed in it (its hat, its models), or by default the package's character. */
export type PreviewBody<L> = {
  object: THREE.Object3D;
  /** Puts the look on. A promise waits (a model that loads). */
  dress(look: L): void | Promise<void>;
  /** Frees what the body made. */
  dispose(): void;
};

export type LookPreviewOptions<L> = {
  /** The picture's side in CSS pixels (default 112); it is drawn at twice that for a sharp screen. */
  size?: number;
  /** A body for the next picture. Left out: the package's character in `record` (else the island's first look), its shirt in the look's body colour. */
  body?: () => PreviewBody<L>;
  /** The record of the default body. */
  record?: LookRecord;
  /** The background (default: none, a clear picture). */
  background?: THREE.ColorRepresentation | null;
  /** The key of a look in the cache (default: its JSON text). */
  key?: (look: L) => string;
};

export type LookPreview<L> = {
  /** A PNG data URL of the look on the character, or null when the page has no WebGL or the drawing failed. */
  render(look: L): Promise<string | null>;
  /** How many pictures are kept. */
  readonly cached: number;
  /** Frees the renderer (and its WebGL context) and the cache. `render` answers null after it. */
  dispose(): void;
};

/** The look as the starter's looks.json has it: a body colour that paints the shirt (the body when there is no top). */
type ColourLook = { priceUsd?: number; change?: { body?: string } };

function defaultBody<L>(record: LookRecord | undefined): () => PreviewBody<L> {
  return () => {
    const c: Character = createCharacter({ record, reducedMotion: true });
    return {
      object: c.object,
      dress(look) {
        const body = (look as ColourLook).change?.body;
        if (body && ((look as ColourLook).priceUsd ?? 1) > 0) c.setColors({ shirt: body });
      },
      dispose: () => c.dispose(),
    };
  };
}

/** A picture maker. Make one for a page and keep it: it holds one WebGL context while it lives. */
export function createLookPreview<L>(options: LookPreviewOptions<L> = {}): LookPreview<L> {
  const size = options.size ?? 112;
  const makeBody = options.body ?? defaultBody<L>(options.record);
  const keyOf = options.key ?? ((l: L) => JSON.stringify(l));
  const cache = new Map<string, Promise<string | null>>();
  let renderer: THREE.WebGLRenderer | null = null;
  let failed = false;
  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();

  const scene = new THREE.Scene();
  if (options.background != null) scene.background = new THREE.Color(options.background);
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a8f9e", 1.6));
  const sun = new THREE.DirectionalLight("#ffffff", 1.6);
  sun.position.set(2, 4, 5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);

  function getRenderer(): THREE.WebGLRenderer | null {
    if (renderer || failed) return renderer;
    try {
      // three makes its own canvas (in a page); with no page or no WebGL this throws, and the answer is null.
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(size * 2, size * 2, false);
      renderer.setClearColor(0x000000, 0);
    } catch {
      failed = true;
      renderer = null;
    }
    return renderer;
  }

  async function draw(look: L): Promise<string | null> {
    if (disposed) return null;
    const r = getRenderer();
    if (!r) return null;
    const body = makeBody();
    try {
      await body.dress(look);
      if (disposed) return null;
      scene.add(body.object);
      // Frame the whole character (with what it holds) from the front, a little from its right and above.
      body.object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(body.object);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const dir = new THREE.Vector3(-0.6, 0.15, 1).normalize();
      const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.02;
      camera.position.copy(sphere.center).addScaledVector(dir, dist);
      camera.lookAt(sphere.center);
      camera.near = Math.max(0.01, dist - sphere.radius * 2);
      camera.far = dist + sphere.radius * 2;
      camera.updateProjectionMatrix();
      r.render(scene, camera);
      return r.domElement.toDataURL("image/png");
    } catch {
      return null;
    } finally {
      scene.remove(body.object);
      body.dispose();
    }
  }

  return {
    render(look) {
      if (disposed) return Promise.resolve(null);
      const key = keyOf(look);
      const hit = cache.get(key);
      if (hit) return hit;
      // One at a time: the renderer and the scene are shared.
      const p = queue.then(() => draw(look));
      queue = p.catch(() => null);
      cache.set(key, p);
      return p;
    },
    get cached() {
      return cache.size;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cache.clear();
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = null;
    },
  };
}
