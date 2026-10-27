import * as THREE from "three";

// The few shapes and helpers the kit builds with: the island's art kit's `mtx` and shared unit shapes (app/island/art/kit.ts, the same
// numbers, so a part built the same way has the same vertices), and a rounded box. This folder imports three and nothing else.

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
/** A matrix from a place, a turn (radians, in the order Y, X, Z) and a scale (one number scales all three). */
export function mtx(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** Shared shapes (unit size: scale them with mtx). */
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  sph: new THREE.SphereGeometry(1, 12, 8),
  cone8: new THREE.ConeGeometry(1, 1, 8),
  /** A smooth sphere, for bodies and heads. */
  ball: new THREE.SphereGeometry(1, 16, 12),
  ball6: new THREE.SphereGeometry(1, 8, 6),
};

/** A box with rounded edges: `segments` rings on each corner, `radius` of the rounding. (The idea of three's RoundedBoxGeometry, without its UVs.) */
export function roundedBox(width: number, height: number, depth: number, segments = 2, radius = 0.1) {
  const n = segments * 2 + 1;
  const r = Math.min(width / 2, height / 2, depth / 2, radius);
  const g = new THREE.BoxGeometry(1, 1, 1, n, n, n).toNonIndexed();
  g.deleteAttribute("uv");
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const half = new THREE.Vector3(width, height, depth).divideScalar(2).subScalar(r);
  const step = 0.5 / n;
  const v = new THREE.Vector3();
  const sign = (x: number) => (x < 0 ? -1 : x > 0 ? 1 : 0);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.x -= sign(v.x) * step;
    v.y -= sign(v.y) * step;
    v.z -= sign(v.z) * step;
    v.normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
    pos.setXYZ(i, half.x * sign(pos.getX(i)) + v.x * r, half.y * sign(pos.getY(i)) + v.y * r, half.z * sign(pos.getZ(i)) + v.z * r);
  }
  return g;
}
