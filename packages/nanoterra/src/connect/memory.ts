// A "works once" store in memory, for tests and a local dev server. It forgets on a restart and is not shared between copies of the server: a live game
// uses `createD1Once` ("@nano133/nanoterra/connect/d1") or `createFirestoreOnce` ("@nano133/nanoterra/connect/firestore").

import type { ConnectOnce } from "./core.js";

export type MemoryOnce = ConnectOnce & { size(): number };

export function createMemoryOnce(now: () => number = Date.now): MemoryOnce {
  const used = new Map<string, number>();
  const once: ConnectOnce = async (id, until) => {
    const t = now();
    if (used.size > 5000) for (const [k, v] of used) if (v < t) used.delete(k);
    if (used.has(id)) return false;
    used.set(id, until);
    return true;
  };
  return Object.assign(once, { size: () => used.size });
}
