// The camera's distance (@nano133/nanoterra/input `createZoom`): nano133.com's island feel, one curve for the wheel, the trackpad and the pinch.
// Echo Island's wheel dropped most of a quick spin (a dead zone and a speed limit) and needed about five times the spins (Wes, 2026-11-01): here
// every bit of a scroll counts, the last notch in goes to the eyes, and the first notch out goes past the switch.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createZoom, listenZoom, pinchedTo, wheelNotches, zoomedBy, type ZoomRange } from "../src/input/index.js";

const R: ZoomRange = { max: 10, start: 5.2, first: 0.6 };
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("a notch is nano133.com's island's: a mouse click of 100 px, a line of 16 px, a page of 400 px, a trackpad pinch five times a scroll", () => {
  near(wheelNotches({ deltaY: -100 }), -0.6);
  near(wheelNotches({ deltaY: 3, deltaMode: 1 }), 48 * 0.006);
  near(wheelNotches({ deltaY: 1, deltaMode: 2 }), 400 * 0.006);
  near(wheelNotches({ deltaY: 10, ctrlKey: true }), 0.3);
  // the island's own step (app/island/zoom.ts zoomBy) for one click in from its start
  near(zoomedBy(R, 5.2, -0.6), 5.2 - 0.6 * (0.35 + 5.2 * 0.14));
});

test("every bit of a scroll counts: five quick clicks bring the default well in, and many small trackpad steps add up to the same", () => {
  let clicks = R.start;
  for (let i = 0; i < 5; i++) clicks = zoomedBy(R, clicks, wheelNotches({ deltaY: -100 }));
  assert.ok(R.start - clicks > 2.5, `five clicks moved ${R.start - clicks} m`);
  let pad = R.start;
  for (let i = 0; i < 100; i++) pad = zoomedBy(R, pad, wheelNotches({ deltaY: -5 }));
  // the same within a few centimetres (small steps compound a little more)
  near(pad, clicks, 0.15);
});

test("the camera never rests half inside the head, and stays in its range", () => {
  assert.equal(zoomedBy(R, 0.9, -1), 0);
  assert.equal(zoomedBy(R, 0, 0.1), R.first + 1);
  assert.equal(zoomedBy(R, 9.9, 5), R.max);
  assert.equal(zoomedBy(R, 0, -5), 0);
});

test("the pinch follows the same curve: twice the spread divides (distance + 2.5) by 2^1.3 wherever it starts, apart brings it in", () => {
  for (const from of [6, 8, 10]) near(pinchedTo(R, from, 100, 200) + 2.5, (from + 2.5) / 2 ** 1.3);
  assert.ok(pinchedTo(R, 6, 100, 50) > 6);
  assert.equal(pinchedTo(R, 6, 100, 100), 6);
  assert.equal(pinchedTo(R, 2, 100, 600), 0);
  assert.equal(pinchedTo(R, 0, 100, 95), R.first + 1);
  assert.equal(pinchedTo(R, 6, 0, 100), 6);
});

test("createZoom reads the kept distance only when asked, writes each change, tells the listeners and eases", () => {
  let reads = 0;
  const written: number[] = [];
  const z = createZoom(R, { read: () => (reads++, 8), write: (d) => written.push(d) });
  assert.equal(reads, 0);
  assert.equal(z.want(), 8);
  assert.equal(z.now(), 8);
  let told = 0;
  const stop = z.subscribe(() => told++);
  z.by(-1);
  assert.equal(told, 1);
  assert.deepEqual(written, [z.want()]);
  const a = z.step(1 / 60, false);
  assert.ok(a < 8 && a > z.want(), "it eases");
  assert.equal(z.step(1 / 60, true), z.want(), "reduced motion: at once");
  stop();
  z.set(99);
  assert.equal(told, 1);
  assert.equal(z.want(), R.max);
  z.set(0);
  z.step(0, true);
  assert.equal(z.eyes(), true);
  // a pinch moves from where it started
  z.set(6);
  z.pinchStart(100);
  z.pinch(200);
  near(z.want(), pinchedTo(R, 6, 100, 200));
  z.pinchEnd();
  z.pinch(50);
  near(z.want(), pinchedTo(R, 6, 100, 200));
  // no kept distance, or a bad one: the default
  assert.equal(createZoom(R, { read: () => null }).want(), R.start);
  assert.equal(createZoom(R, { read: () => NaN }).want(), R.start);
});

test("listenZoom: the wheel over the canvas (the page does not scroll), + and − on the window, not the browser's zoom, a field or a skipped event", () => {
  const el = new EventTarget();
  const win = new EventTarget();
  const z = createZoom(R);
  let skip = false;
  const off = listenZoom(z, el, { skip: () => skip }, win);
  const wheel = Object.assign(new Event("wheel", { cancelable: true }), { deltaY: -100, deltaMode: 0, ctrlKey: false });
  el.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, true);
  near(z.want(), zoomedBy(R, R.start, -0.6));
  const key = (code: string, more: Record<string, unknown> = {}, target?: unknown) => {
    const before = z.want();
    const e = Object.assign(new Event("keydown"), { code, metaKey: false, altKey: false, ctrlKey: false, ...more });
    if (target) Object.defineProperty(e, "target", { value: target });
    win.dispatchEvent(e);
    return z.want() - before;
  };
  assert.ok(key("Equal") < 0);
  assert.ok(key("NumpadSubtract") > 0);
  assert.equal(key("Equal", { ctrlKey: true }), 0);
  assert.equal(key("Minus", { metaKey: true }), 0);
  assert.equal(key("Equal", {}, { tagName: "INPUT", isContentEditable: false }), 0);
  skip = true;
  assert.equal(key("Equal"), 0);
  skip = false;
  off();
  assert.equal(key("Equal"), 0);
});
