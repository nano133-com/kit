// The try-on demo: the kit's looks sheet with the try-on stage, and no game. The character is made of boxes and spheres in code (the game's own
// body: `tryOnViewer({ body })`), with a hat, a scarf and a pack; `?body=kit` uses the kit's own character instead (no hook). The shop's handler
// runs in this page on the memory store with no payee: TEST MODE, nothing can be paid. `?theme=dark` and `?theme=light` set the sheet's theme.
import * as THREE from "three";
import { mountShop } from "../../src/shop/panel/index.js";
import { createMemoryShop, createShopHandler } from "../../src/shop/index.js";
import { wearOf, type Look } from "../../src/looks/look.js";
import type { TryOnBody } from "../../src/shop/viewer/index.js";

const params = new URLSearchParams(location.search);

const LOOKS: Look[] = [
  { id: "classic", name: "Classic", priceUsd: 0, change: { body: "#4aa8ff" } },
  { id: "sunset", name: "Sunset", priceUsd: 0.25, change: { body: "#ff8a3d" } },
  { id: "mint-cap", name: "Mint Cap", priceUsd: 0.25, change: { body: "#3ddc97", hat: "cap", hatColor: "#1c6e4f" } },
  { id: "royal", name: "Royal", priceUsd: 1, change: { body: "#7b5cff", hat: "crown", hatColor: "#ffd23f" } },
  { id: "top-hat", name: "Top Hat", priceUsd: 1, change: { body: "#e9e4d8", hat: "tophat", hatColor: "#22242e" } },
  { id: "straw-hat", name: "Straw Sun Hat", priceUsd: 0.1, wear: "hat", slots: { shape: "brim", color: "#e8c46a" } },
  { id: "tall-hat", name: "Tall Wizard Hat", priceUsd: 0.2, wear: "hat", slots: { shape: "cone", color: "#5b3fd0" } },
  { id: "red-scarf", name: "Red Scarf", priceUsd: 0.05, wear: "scarf", slots: { color: "#d6223b" } },
  { id: "explorer-pack", name: "Explorer Pack", priceUsd: 0.25, wear: "pack", slots: { color: "#8a5a2b" } },
];

/** The character of boxes and spheres: a body, a head, arms and legs; a hat, a scarf and a pack, each in its own group (what `part` gives). */
function primitiveBody(): TryOnBody<Look> {
  const root = new THREE.Group();
  const made: THREE.Material[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const mat = (c: string) => {
    const m = new THREE.MeshLambertMaterial({ color: c });
    made.push(m);
    return m;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    geos.push(g);
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    parent.add(o);
    return o;
  };
  const shirt = mat("#4aa8ff");
  const skin = mat("#f1c9a5");
  const dark = mat("#2b3140");
  mesh(new THREE.BoxGeometry(0.7, 0.8, 0.4), shirt, 0, 1.05, 0);
  mesh(new THREE.SphereGeometry(0.32, 24, 16), skin, 0, 1.72, 0);
  for (const x of [-0.12, 0.12]) mesh(new THREE.SphereGeometry(0.045, 10, 8), dark, x, 1.76, 0.29);
  for (const x of [-0.47, 0.47]) mesh(new THREE.BoxGeometry(0.2, 0.7, 0.22), shirt, x, 1.05, 0);
  for (const x of [-0.17, 0.17]) mesh(new THREE.BoxGeometry(0.25, 0.65, 0.28), dark, x, 0.33, 0);
  // the stage's round floor (part of the body: the whole character stands on it)
  mesh(new THREE.CylinderGeometry(0.75, 0.78, 0.06, 40), mat("#c9d6e3"), 0, -0.03, 0);

  // an outfit's own hat (looks.json's `change.hat`) and the three item slots; a hat item covers the outfit's hat
  const slot: Record<string, THREE.Group | null> = { outfitHat: null, hat: null, scarf: null, pack: null };
  const showHats = () => {
    if (slot.outfitHat) slot.outfitHat.visible = !slot.hat;
  };
  const clear = (s: string) => {
    const g = slot[s];
    if (!g) return;
    root.remove(g);
    g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    slot[s] = null;
  };
  // The head under a hat or over a scarf, for the framing only (never drawn): "it is you, wearing it". The stage measures hidden meshes too.
  const headProbe = () => {
    const probe = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8));
    geos.push(probe.geometry);
    probe.position.set(0, 1.72, 0);
    probe.visible = false;
    return probe;
  };
  const hatOf = (shape: string, colour: string) => {
    const g = new THREE.Group();
    g.add(headProbe());
    const m = mat(colour);
    if (shape === "cone") {
      mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 28), m, 0, 1.95, 0, g);
      mesh(new THREE.ConeGeometry(0.3, 0.9, 24), m, 0, 2.4, 0, g);
    } else {
      // a wide straw brim, wider than the shoulders
      mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.03, 36), m, 0, 1.94, 0, g);
      mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.24, 28), m, 0, 2.06, 0, g);
    }
    return g;
  };
  const kitHat = (look: Look) => {
    const c = look.change!;
    const g = new THREE.Group();
    g.add(headProbe());
    const m = mat(c.hatColor ?? "#333333");
    if (c.hat === "cap") {
      mesh(new THREE.SphereGeometry(0.33, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 1.85, 0, g);
      mesh(new THREE.BoxGeometry(0.34, 0.03, 0.26), m, 0, 1.86, 0.36, g);
    } else if (c.hat === "crown") {
      mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.16, 12), m, 0, 2.08, 0, g);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        mesh(new THREE.ConeGeometry(0.05, 0.15, 6), m, Math.sin(a) * 0.21, 2.22, Math.cos(a) * 0.21, g);
      }
    } else if (c.hat === "tophat") {
      mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 28), m, 0, 1.98, 0, g);
      mesh(new THREE.CylinderGeometry(0.25, 0.26, 0.48, 24), m, 0, 2.23, 0, g);
    } else mesh(new THREE.SphereGeometry(0.34, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 1.8, 0, g);
    return g;
  };

  return {
    object: root,
    dress(look) {
      const s = wearOf(look);
      if (s === "outfit") {
        shirt.color.set(look.change?.body ?? "#4aa8ff");
        clear("outfitHat");
        if (look.change?.hat) root.add((slot.outfitHat = kitHat(look)));
        showHats();
        return;
      }
      clear(s);
      const colour = look.slots?.color ?? "#888888";
      let g: THREE.Group;
      if (s === "hat") g = hatOf(look.slots?.shape ?? "brim", colour);
      else if (s === "scarf") {
        g = new THREE.Group();
        g.add(headProbe());
        const knit = mat(colour);
        const ring = mesh(new THREE.TorusGeometry(0.27, 0.08, 10, 28), knit, 0, 1.46, 0, g);
        ring.rotation.x = Math.PI / 2;
        mesh(new THREE.BoxGeometry(0.14, 0.42, 0.06), knit, 0.12, 1.22, 0.24, g).rotation.z = 0.12;
      } else {
        g = new THREE.Group();
        const canvas = mat(colour);
        mesh(new THREE.BoxGeometry(0.56, 0.62, 0.3), canvas, 0, 1.08, -0.37, g);
        mesh(new THREE.BoxGeometry(0.44, 0.22, 0.14), mat("#5e3c1c"), 0, 0.92, -0.58, g);
      }
      root.add((slot[s] = g));
      showHats();
    },
    part(look) {
      const s = wearOf(look);
      if (s === "outfit") return look.change?.hat && slot.outfitHat?.visible ? slot.outfitHat : null;
      return slot[s] ?? null;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of made) m.dispose();
    },
  };
}

// ---- the shop, in this page: no payee, so TEST MODE ----
const handler = createShopHandler({
  store: createMemoryShop(),
  catalogue: LOOKS,
  payee: null,
  player: async () => "demo-player",
  rate: { feeds: [{ name: "Demo feed", url: "https://feed.invalid/", read: (j) => (j as { usd: number }).usd }], fetch: async () => new Response(JSON.stringify({ usd: 1 })) },
  nodes: [],
});
const requests: string[] = [];
const localFetch = (async (input: string, init?: RequestInit) => {
  requests.push(`${init?.method ?? "GET"} ${input}`);
  const res = await handler.handle(new Request(`${location.origin}${input}`, { ...init, headers: { ...(init?.headers as Record<string, string>), Origin: location.origin } }));
  return res ?? new Response(JSON.stringify({ error: "No such route." }), { status: 404 });
}) as typeof fetch;

const worn = new Map<string, string>([["outfit", "classic"]]);
const owned: string[] = [];
const wears: string[] = [];
const useKit = params.get("body") === "kit";
const theme = (params.get("theme") as "light" | "dark" | null) ?? "device";

const shop = mountShop(document.getElementById("shop")!, {
  looks: LOOKS,
  fetch: localFetch,
  key: true,
  theme,
  owned: () => owned,
  signedIn: () => true,
  worn: (l) => worn.get(wearOf(l)) === l.id,
  wear: (l) => {
    wears.push(l.id);
    worn.set(wearOf(l), l.id);
  },
  takeOff: (s) => void worn.delete(s),
  slots: { hat: { tab: "Hats", plain: "No hat" }, scarf: { tab: "Scarves", plain: "No scarf" }, pack: { tab: "Packs", plain: "No pack" } },
  tryOn: useKit ? () => import("../../src/shop/viewer/index.js") : async () => (await import("../../src/shop/viewer/index.js")).tryOnViewer({ body: primitiveBody }),
});

// For the browser check: what the page sent and what the game was asked to wear (a try-on must add nothing to either).
Object.assign(window, { demo: { shop, requests, wears, storage: () => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }) } });
