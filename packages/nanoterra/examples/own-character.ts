// A game with its OWN character in the kit's looks sheet (README "The try-on stage"): the try-on stage draws the game's character, not the kit's.
// This is the shape Sunk Cost uses (its `makeShop`), whole: the game's character code is below, so the file stands alone. The package's tests
// type-check it against the package's own types, so it follows every change of the API.
import "@nano133/nanoterra/shop/style.css";
import "@nano133/nanoterra/shop/tryon.css"; // the stage's rules: only a game with tryOn loads them
import * as THREE from "three";
import { isOutfit, wearOf, type Look } from "@nano133/nanoterra/looks";
import { mountShop, type MountedShop } from "@nano133/nanoterra/shop/panel";

// ---- the game's own character (in a game: its own files, e.g. game/character.ts and game/world.ts) ----

/** The game's toon light ramp: three steps. */
export function toonRamp(): THREE.DataTexture {
  const ramp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

export type Motion = { speed: number; airborne: boolean; verticalSpeed: number };

/** The game's character: a group with feet at y = 0, facing +Z; one outfit colour and one hat item at a time. */
export function makeAvatar(ramp: THREE.Texture) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshToonMaterial({ color: "#4aa8ff", gradientMap: ramp });
  const skin = new THREE.MeshToonMaterial({ color: "#f1c9a5", gradientMap: ramp });
  const geometries = [new THREE.BoxGeometry(0.7, 0.8, 0.4), new THREE.SphereGeometry(0.32, 24, 16)];
  const torso = new THREE.Mesh(geometries[0], shirt);
  torso.position.y = 1.05;
  const head = new THREE.Mesh(geometries[1], skin);
  head.position.y = 1.72;
  group.add(torso, head);
  /** The hat's mount on the head: what the stage frames for a hat (`part`). */
  const hatMount = new THREE.Group();
  hatMount.position.y = 1.72;
  group.add(hatMount);
  let t = 0;
  let loading: Promise<void> = Promise.resolve();
  return {
    group,
    wear(look: Look) {
      if (isOutfit(look)) shirt.color.set(look.change.body);
      else if (wearOf(look) === "hat") {
        hatMount.clear();
        // a model that loads: ready() waits for it
        loading = Promise.resolve().then(() => {
          const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.03, 32), new THREE.MeshToonMaterial({ color: look.slots?.color ?? "#e8c46a", gradientMap: ramp }));
          brim.position.y = 0.22;
          // the head under the hat, for the framing only (never drawn): "it is you, wearing it"; the stage measures hidden meshes too
          const probe = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8));
          probe.visible = false;
          hatMount.add(brim, probe);
        });
      }
    },
    ready: () => loading,
    /** The hat's group, with the head under it. Null: no hat on. */
    hatOf: (): THREE.Object3D | null => (hatMount.children.length ? hatMount : null),
    animate(dt: number, motion: Motion) {
      t += dt;
      head.rotation.y = motion.airborne ? 0 : Math.sin(t * 2) * 0.05; // the idle pose
    },
    release() {
      hatMount.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      for (const g of geometries) g.dispose();
      shirt.dispose();
      skin.dispose();
    },
  };
}

/** The game's free look, worn when a tried item is not an outfit (Sunk Cost dresses the outfit only). */
export const FREE_LOOK: Look = { id: "classic", name: "Classic", priceUsd: 0, change: { body: "#4aa8ff" } };

// ---- the game's shop: the kit's sheet with the try-on stage of the game's own character ----

export function makeShop(el: HTMLElement, looks: Look[], me: { owned: string[]; address: string | null; worn: Map<string, string> }): MountedShop {
  return mountShop(el, {
    looks,
    owned: () => me.owned,
    signedIn: () => !!me.address,
    worn: (l) => me.worn.get(wearOf(l)) === l.id,
    wear: (l) => void me.worn.set(wearOf(l), l.id),
    // the reader's 15 lines (Sunk Cost), whole: the viewer and the game's character load when the sheet first opens
    tryOn: async () => {
      const { tryOnViewer } = await import("@nano133/nanoterra/shop/viewer");
      const ramp = toonRamp();
      return tryOnViewer({
        body: () => {
          const avatar = makeAvatar(ramp);
          return {
            object: avatar.group,
            async dress(look) {
              avatar.wear(isOutfit(look) || wearOf(look) === "hat" ? look : FREE_LOOK);
              await avatar.ready();
            },
            part: (look) => (wearOf(look) === "hat" ? avatar.hatOf() : null), // optional: frame a hat up close; null frames the whole character
            update: (dt) => avatar.animate(dt, { speed: 0, airborne: false, verticalSpeed: 0 }),
            dispose: () => avatar.release(),
          };
        },
      });
    },
  });
}
