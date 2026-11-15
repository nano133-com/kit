// The "works once" store on Firestore (the Admin SDK): Nano Arcade's. One document a pending cookie, made with `create`, which fails when it exists: so
// two presses at once, on two servers, make one sign-in. The package has no Firebase dependency: the adapter uses the small interface below, which the
// Admin SDK's `Firestore` fits.
//
//   import { createFirestoreOnce } from "@nano133/nanoterra/connect/firestore";
//   once: createFirestoreOnce(getFirestore())
//
// The data model: nanoterra_once/{id} { use: "confirm" | "cancel", at, deleteAt } (the name can be changed). `deleteAt` is a Date (a Timestamp in
// Firestore), a day after the cookie's deadline: set a TTL policy on it. It holds no address, no name and no cookie.

import type { ConnectOnce } from "../core.js";

export interface ConnectOnceDocRef {
  create(data: Record<string, unknown>): Promise<unknown>;
}
export interface FirestoreOnceLike {
  collection(name: string): { doc(id: string): ConnectOnceDocRef };
}

const DAY = 86_400_000;

/** The error of a `create` whose document exists (gRPC ALREADY_EXISTS, code 6, as the Admin SDK gives it). */
const exists = (e: unknown) => {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 6 || code === "already-exists" || code === "ALREADY_EXISTS";
};

export function createFirestoreOnce(db: FirestoreOnceLike, options: { collection?: string; now?: () => number } = {}): ConnectOnce {
  const name = options.collection ?? "nanoterra_once";
  const now = options.now ?? Date.now;
  return async (id, until, use) => {
    try {
      await db.collection(name).doc(id).create({ use, at: now(), deleteAt: new Date(until + DAY) });
      return true;
    } catch (e) {
      if (exists(e)) return false;
      throw e;
    }
  };
}
