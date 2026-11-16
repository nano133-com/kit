// "@nano133/nanoterra/shop/viewer": the try-on stage of the looks sheet, drawn with Three.js (an optional peer). The sheet (`mountShop`'s `tryOn`)
// loads this path only when it opens, so a game that does not use it never loads it, and a game with no Three.js never names it. VIEWER below is
// the string "@nano133/nanoterra/shop/viewer" (a test reads every import() of a source file, comments too):
//
//   mountShop(el, { ...options, tryOn: () => import(VIEWER) });                          // the kit's character
//   mountShop(el, { ...options, tryOn: async () => (await import(VIEWER)).tryOnViewer({ body: myBody }) });  // the game's
//
// ONE small WebGL renderer while the sheet is open (it is freed when the sheet closes). A drag turns the character all the way round, a pinch, the
// wheel and the zoom keys zoom, a vertical drag moves the view up and down when zoomed in, and the keyboard does the same on the focused stage
// (./inspect.ts: the arrows, + and -, Home). A try-on frames the item WHOLE, as large as the stage's real shape allows, from the item's real box on
// this character (`part(look)`); a pack is seen from the back. The stage turns by itself only until the player touches it, and never with reduced
// motion; with reduced motion every change of view is a cut.

import * as THREE from "three";
import type { PreviewBody } from "../../character/preview.js";
import type { LookRecord } from "../../character/record.js";
import { OUTFIT, wearOf, type Look } from "../../looks/look.js";
import type { TryOnContext, TryOnShow, TryOnStage, TryOnViewer } from "./contract.js";
import { FRONT, IDLE_SPEED, LIFT, clampView, ease, keyStep, panBy, pinchFactor, sameView, sideOf, tryOnView, turnDiff, turnsByItself, wheelFactor, wholeView, yawFor, zoomBy, ZOOM_STEP, type Box, type Frame, type View } from "./inspect.js";

export type { TryOnContext, TryOnShow, TryOnStage, TryOnViewer } from "./contract.js";
export { BACK, FRONT, LIFT, MARGIN, ZOOM_STEP, fitPoints, keyStep, listWords, ringPoints, screenOf, sideOf, tryOnView, wholeView, type Box, type Frame, type View } from "./inspect.js";

/**
 * The game's character for the stage: the same shape as `createLookPreview`'s body (`object`, `dress`, `dispose`), and two optional parts.
 * `dress(look)` puts one look on, in its wear slot (an outfit replaces the outfit; an item replaces the item of its slot); the stage dresses the worn
 * looks first, then the tried ones. It never saves and never sends a look: it only draws.
 */
export type TryOnBody<L = Look> = PreviewBody<L> & {
  /**
   * What the stage frames for a tried look, after `dress`: the item's object (a hat on the head socket, a pack on the back socket) or a box in the
   * character's space, or null for the whole character (a colour). Give the head with a hat ("it is you, wearing it"): a `THREE.Box3` that holds both.
   */
  part?(look: L): THREE.Object3D | THREE.Box3 | null;
  /** One frame (seconds): the idle pose, a cape's sway. */
  update?(dt: number): void;
};

export type TryOnViewerOptions = {
  /** The game's character, made for each stage. Left out: the kit's character (`kitBody(record)`, ./kit.ts: a chunk of its own, loaded only then). */
  body?: () => TryOnBody<Look>;
  /** The player's record for the kit's character (read each time a stage mounts). Left out: the island's first look. */
  record?: LookRecord | (() => LookRecord | null | undefined);
  /** The camera's vertical field of view in degrees. Default 30. */
  fov?: number;
};

// ---- the stage ----

const TAP_PX = 8;
const TAP_MS = 450;
const DRAG_TURN = 0.012;

const boxOf = (b: THREE.Box3): Box => ({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] });

/** The order the stage dresses looks in: the outfit first, then each item, one look a slot (a tried look over the worn one). */
function dressList(v: TryOnShow): Look[] {
  const bySlot = new Map<string, Look>();
  for (const l of v.worn) bySlot.set(wearOf(l), l);
  for (const l of v.tried) bySlot.set(wearOf(l), l);
  const out = [...bySlot.values()];
  return [...out.filter((l) => wearOf(l) === OUTFIT), ...out.filter((l) => wearOf(l) !== OUTFIT)];
}

/** The button of the viewer's own keys (an SVG icon: the sheet's words name it). */
function key(label: string, path: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "n133s-stage-key";
  b.setAttribute("aria-label", label);
  b.title = label;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: "22", height: "22", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  svg.append(p);
  b.append(svg);
  b.addEventListener("click", onClick);
  return b;
}

const ICONS = {
  zoomIn: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM20 20l-4.8-4.8M10.5 7.5v6M7.5 10.5h6",
  zoomOut: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM20 20l-4.8-4.8M7.5 10.5h6",
  whole: "M12 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 9.5h12M12 9.5v5M12 14.5l-3 6M12 14.5l3 6",
  turn: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4",
};

/** The state a test or a browser check reads (`box.dataset` holds the same in words): the yaw, the view, the canvas size. */
export type StageProbe = {
  yaw: number;
  view: View;
  whole: boolean;
  touched: boolean;
  focus: string | null;
  camera: THREE.PerspectiveCamera;
  /** The framed item's points in the scene now (at this turn): its meshes' vertices, or its box's corners. Empty: the whole character is framed. */
  partPoints(): THREE.Vector3[];
};

/**
 * A viewer with the game's character (`body`), or the kit's (with `record`). The kit's character is a chunk of its own (./kit.ts, with the
 * character's builder): it loads only for a viewer with no `body`, so a game that draws its own character never loads it.
 */
export function tryOnViewer(options: TryOnViewerOptions = {}): TryOnViewer {
  return {
    async mount(box, context) {
      if (options.body) return mountStage(box, context, options.body, options.fov);
      const { kitBody } = await import("./kit.js");
      const record = typeof options.record === "function" ? options.record() : options.record;
      return mountStage(box, context, () => kitBody(record ?? null), options.fov);
    },
  };
}

/** The kit's character, with no hook: `tryOn: () => import(VIEWER)`. */
export const mount: TryOnViewer["mount"] = (box, context) => tryOnViewer().mount(box, context);

/** The kit's character as a try-on body (a chunk of its own): for a game's own `body` that starts from it. */
export const loadKitBody = async () => (await import("./kit.js")).kitBody;

function mountStage(box: HTMLElement, ctx: TryOnContext, makeBody: () => TryOnBody<Look>, fov = 30): TryOnStage {
  // The renderer first: no WebGL throws here, and the sheet shows the still picture.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.className = "n133s-stage-canvas";
  canvas.setAttribute("aria-hidden", "true");

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#8a8f9e", 1.7));
  const sun = new THREE.DirectionalLight("#ffffff", 1.5);
  sun.position.set(2.5, 5, 4);
  scene.add(sun);
  const turner = new THREE.Group();
  scene.add(turner);
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.02, 100);

  let body: TryOnBody<Look> = makeBody();
  turner.add(body.object);

  // ---- the state ----
  let aspect = 1;
  let frame: Frame = { body: { min: [-0.6, 0, -0.6], max: [0.6, 2.3, 0.6] }, fov };
  let target: View = wholeView(frame, aspect);
  let cur: View = target;
  /** The view a try-on fitted: a resize fits again while the player has not moved the view since. */
  let fitted: { view: View; item: Box | null; yaw: number } | null = null;
  let yaw = FRONT;
  let yawTo = FRONT;
  let touched = false;
  let held = false;
  let dressed: Look[] = [];
  let ask = 0;
  let disposed = false;
  /** What the stage framed: the game's object (its meshes) or a box at yaw 0. */
  let partSource: THREE.Object3D | THREE.Box3 | null = null;
  let focusId: string | null = null;

  /** Boxes in the turner's space at yaw 0 (the body's own place and scale count). */
  function measure(fn: () => THREE.Box3 | null): THREE.Box3 | null {
    const was = turner.rotation.y;
    turner.rotation.y = 0;
    scene.updateMatrixWorld(true);
    turner.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.SkinnedMesh).skeleton.update());
    const out = fn();
    turner.rotation.y = was;
    scene.updateMatrixWorld(true);
    return out && !out.isEmpty() ? out : null;
  }
  const isWhole = () => sameView(target, wholeView(frame, aspect));

  // ---- the keys of the stage ----
  const zoomIn = key(ctx.words.zoomIn, ICONS.zoomIn, () => go(zoomBy(target, ZOOM_STEP, frame, aspect)));
  const zoomOut = key(ctx.words.zoomOut, ICONS.zoomOut, () => go(zoomBy(target, 1 / ZOOM_STEP, frame, aspect)));
  const wholeKey = key(ctx.words.whole, ICONS.whole, () => go(wholeView(frame, aspect)));
  const turnKey = key(ctx.words.turn, ICONS.turn, () => {
    touch();
    yawTo += turnDiff(yawTo, Math.cos(yawTo - FRONT) < 0 ? FRONT : FRONT + Math.PI);
  });
  const keys = document.createElement("div");
  keys.className = "n133s-stage-keys";
  keys.append(zoomIn, zoomOut, wholeKey, turnKey);
  box.append(canvas, keys);

  /** The keys at a limit say so (aria-disabled, never disabled: a key that loses the focus drops it to the page, where a game's walk keys act). */
  function drawKeys() {
    const whole = isWhole();
    const l = clampView({ ...target, d: 0 }, frame, aspect).d;
    zoomIn.setAttribute("aria-disabled", String(target.d <= l + 1e-6));
    zoomOut.setAttribute("aria-disabled", String(target.d >= clampView({ ...target, d: Infinity }, frame, aspect).d - 1e-6));
    wholeKey.setAttribute("aria-disabled", String(whole));
    box.dataset.whole = String(whole);
    box.dataset.view = `${target.x.toFixed(3)},${target.y.toFixed(3)},${target.d.toFixed(3)}`;
  }

  function touch() {
    touched = true;
  }
  /** A view the player asked for (a key, the wheel, a pinch, a pan). */
  function go(v: View) {
    touch();
    target = v;
    fitted = null;
    drawKeys();
  }

  // ---- the size ----
  function resize() {
    const w = Math.max(1, box.clientWidth);
    const h = Math.max(1, box.clientHeight);
    renderer.setSize(w, h, false);
    const next = w / h;
    if (Math.abs(next - aspect) < 1e-4) return;
    aspect = next;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    // A try-on's view is fitted again for the new shape (while the player has not moved it); another view stays inside the limits.
    if (fitted) target = fitted.view = tryOnView(fitted.item, frame, aspect, fitted.yaw);
    else if (!touched) target = wholeView(frame, aspect);
    else target = clampView(target, frame, aspect);
    cur = target;
    drawKeys();
  }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null;
  observer?.observe(box);
  resize();

  // ---- dressing and framing ----
  async function show(v: TryOnShow) {
    const n = ++ask;
    const list = dressList(v);
    // A slot that was dressed and is no longer (a try-on taken off with nothing worn there): a new body, dressed again from the start.
    const gone = dressed.some((d) => !list.some((l) => wearOf(l) === wearOf(d)));
    const changed = gone ? list : list.filter((l) => !dressed.some((d) => d.id === l.id));
    if (gone) {
      turner.remove(body.object);
      body.dispose();
      body = makeBody();
      turner.add(body.object);
    }
    dressed = list;
    try {
      for (const l of changed) await body.dress(l);
    } catch {
      // a look that did not dress (a model that did not load): the stage shows the rest
    }
    if (n !== ask || disposed) return;
    body.update?.(0);
    const whole = measure(() => new THREE.Box3().setFromObject(body.object, true));
    if (whole) frame = { body: boxOf(whole), fov };
    let part: THREE.Box3 | null = null;
    if (v.focus) {
      const focus = v.focus;
      let source: THREE.Object3D | THREE.Box3 | null = null;
      part = measure(() => {
        const p = body.part?.(focus) ?? null;
        source = p instanceof THREE.Box3 ? p.clone() : p;
        return p instanceof THREE.Box3 ? p.clone() : p ? new THREE.Box3().setFromObject(p, true) : null;
      });
      partSource = part ? source : null;
    } else partSource = null;
    focusId = v.focus?.id ?? null;
    const item = part ? boxOf(part) : null;
    if (v.focus) {
      touch();
      yawTo = yawFor(sideOf(item), yawTo);
      target = tryOnView(item, frame, aspect, yawTo);
      fitted = { view: target, item, yaw: yawTo };
    } else if (!touched) target = wholeView(frame, aspect);
    else target = clampView(target, frame, aspect);
    drawKeys();
    box.dataset.focus = focusId ?? "";
    box.dataset.ready = String(n);
  }

  // ---- the pointer: one turns (and moves up and down when zoomed in, where the stage owns the vertical drag), two pinch ----
  const pts = new Map<number, { x: number; y: number }>();
  let press: { x: number; y: number; at: number; moved: boolean } | null = null;
  let span = 0;
  const spread = () => {
    const [a, b] = [...pts.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  /** Where the stage sits in a list that scrolls (`touch-action: pan-y`), a vertical drag scrolls the list and the wheel scrolls it too. */
  const ownsVertical = () => !getComputedStyle(box).touchAction.includes("pan-y");
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture?.(e.pointerId);
    if (pts.size === 1) press = { x: e.clientX, y: e.clientY, at: performance.now(), moved: false };
    else {
      span = spread();
      if (press) press.moved = true;
    }
    held = true;
    touch();
  };
  const move = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_PX) press.moved = true;
    if (pts.size >= 2) {
      const now = spread();
      if (span > 0 && now > 0) go(zoomBy(target, pinchFactor(span, now), frame, aspect));
      span = now;
      return;
    }
    yawTo += dx * DRAG_TURN;
    if (dy && ownsVertical() && !isWhole()) go(panBy(target, dy / Math.max(1, box.clientHeight), frame, aspect));
  };
  const up = (e: PointerEvent) => {
    if (!pts.delete(e.pointerId)) return;
    span = spread();
    if (pts.size) return;
    held = false;
    const p = press;
    press = null;
    if (e.type === "pointerup" && p && !p.moved && performance.now() - p.at < TAP_MS) ctx.onTap();
  };
  const wheel = (e: WheelEvent) => {
    // A trackpad's pinch comes as a wheel with ctrl: it always zooms. A plain wheel zooms only where the stage does not sit in a scrolling list.
    if (!e.ctrlKey && !ownsVertical()) return;
    e.preventDefault();
    go(zoomBy(target, e.ctrlKey ? Math.exp(-e.deltaY / 100) : wheelFactor(e.deltaY, e.deltaMode), frame, aspect));
  };
  const keydown = (e: KeyboardEvent) => {
    if (e.target !== box || e.altKey || e.metaKey || e.ctrlKey) return;
    const step = keyStep(e.key, e.shiftKey);
    if (!step) return;
    e.preventDefault();
    if ("turn" in step) {
      touch();
      yawTo += step.turn;
    } else if ("zoom" in step) go(zoomBy(target, step.zoom, frame, aspect));
    else if ("pan" in step) go(panBy(target, step.pan, frame, aspect));
    else go(wholeView(frame, aspect));
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  box.addEventListener("wheel", wheel, { passive: false });
  box.addEventListener("keydown", keydown);
  const lost = (e: Event) => e.preventDefault();
  canvas.addEventListener("webglcontextlost", lost);

  // ---- the frame ----
  let last = performance.now();
  let raf = 0;
  const loop = (now: number) => {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    // A stage out of the page (the pay sheet over it) or with no size draws nothing.
    if (!box.isConnected || box.clientWidth === 0 || box.clientHeight === 0) return;
    const calm = ctx.calm();
    if (turnsByItself(touched, calm, isWhole())) yawTo += dt * IDLE_SPEED;
    yaw = held ? ease(yaw, yawTo, dt, 20, calm) : ease(yaw, yawTo, dt, 9, calm);
    turner.rotation.y = yaw;
    cur = { x: ease(cur.x, target.x, dt, 9, calm), y: ease(cur.y, target.y, dt, 9, calm), d: ease(cur.d, target.d, dt, 9, calm) };
    camera.position.set(cur.x, cur.y + cur.d * LIFT, cur.d);
    camera.lookAt(cur.x, cur.y, 0);
    camera.near = Math.max(0.01, cur.d / 50);
    camera.far = cur.d * 20 + 10;
    camera.updateProjectionMatrix();
    body.update?.(calm ? 0 : dt);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  // The probe for a check (a test, a browser check): the camera, the object and the framed box as the stage has them now.
  const partPoints = (): THREE.Vector3[] => {
    const src = partSource;
    scene.updateMatrixWorld(true);
    if (!src) return [];
    if (src instanceof THREE.Box3) {
      const out: THREE.Vector3[] = [];
      for (const x of [src.min.x, src.max.x]) for (const y of [src.min.y, src.max.y]) for (const z of [src.min.z, src.max.z]) out.push(new THREE.Vector3(x, y, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), turner.rotation.y));
      return out;
    }
    const out: THREE.Vector3[] = [];
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      const pos = m.isMesh ? m.geometry.getAttribute("position") : null;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) out.push(m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld));
    });
    return out;
  };
  (box as HTMLElement & { n133Stage?: () => StageProbe }).n133Stage = () => ({ yaw, view: { ...cur }, whole: isWhole(), touched, focus: focusId, camera, partPoints });

  return {
    show: (v) => void show(v),
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      box.removeEventListener("wheel", wheel);
      box.removeEventListener("keydown", keydown);
      delete (box as HTMLElement & { n133Stage?: unknown }).n133Stage;
      turner.remove(body.object);
      body.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      keys.remove();
    },
  };
}
