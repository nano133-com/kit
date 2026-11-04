// The admin store for a game on Firestore (the Admin SDK). The package has no Firebase dependency: the adapter uses the small interface below, which the
// Admin SDK's `Firestore` fits. It writes ONLY the ten settings (SETTING_KEYS); everything else it does is a read.
//
// The data model (the names a game must have; only the three collection names can be changed):
//   meta/{key}          { value: string, at: number }          keys "setting:character", "setting:signin", "setting:friends", "setting:emotes", "setting:freePlay", the Legal card's
//                                                              "setting:adultsOnly", "setting:sellLives", "setting:refundDays", "setting:refundWords", "setting:lawsConfirmedAt", and "rate" (value is JSON { usd, sources })
//   orders/{id}         { player, lookId, usd, amount, status, createdAt, expiresAt, paidAt, payer, hash }   `amount` is the raw amount as text
//   owned/{player__lookId}  { player, lookId, orderId, grantedAt }
//
// The summary reads the newest 5000 orders (the counts and the totals are over those) and every owned look: for a small game. A big game should keep running totals.

import { parseRate, summarize, type OrderRow } from "../summary.js";
import { SETTING_KEYS, settingRows, type AdminStore, type SettingName, type StoredSettings, type StoreSummary } from "../store.js";
import type { GamePatch } from "../switches.js";

export interface FirestoreDocLike {
  get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
}
export interface FirestoreQueryLike {
  orderBy(field: string, direction?: "asc" | "desc"): FirestoreQueryLike;
  limit(n: number): FirestoreQueryLike;
  get(): Promise<{ docs: { id: string; data(): Record<string, unknown> }[] }>;
}
export interface FirestoreCollectionLike extends FirestoreQueryLike {
  doc(id: string): FirestoreDocLike;
}
export interface FirestoreBatchLike {
  set(doc: FirestoreDocLike, data: Record<string, unknown>, options?: { merge?: boolean }): unknown;
  commit(): Promise<unknown>;
}
export interface FirestoreLike {
  collection(name: string): FirestoreCollectionLike;
  batch(): FirestoreBatchLike;
}

export const FIRESTORE_SCAN_LIMIT = 5000;
/** The meta documents of the settings (the Game card's five and the Legal card's five). */
export const FIRESTORE_KEYS = SETTING_KEYS;

const text = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const orNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function createFirestoreStore(db: FirestoreLike, collections: { meta?: string; orders?: string; owned?: string } = {}): AdminStore {
  const meta = collections.meta ?? "meta";
  const orders = collections.orders ?? "orders";
  const owned = collections.owned ?? "owned";
  const valueOf = async (key: string) => {
    const snap = await db.collection(meta).doc(key).get();
    return snap.exists ? snap.data() : undefined;
  };
  return {
    async readSettings() {
      const names = Object.keys(FIRESTORE_KEYS) as SettingName[];
      const docs = await Promise.all(names.map((name) => valueOf(FIRESTORE_KEYS[name])));
      const out: StoredSettings = {};
      names.forEach((name, i) => {
        if (docs[i] !== undefined) out[name] = docs[i]?.value;
      });
      return out;
    },

    async saveSettings(patch: GamePatch, now: number) {
      const rows = settingRows(patch, now);
      if (!rows.length) return;
      const batch = db.batch();
      for (const [name, value] of rows) batch.set(db.collection(meta).doc(FIRESTORE_KEYS[name]), { value, at: now });
      await batch.commit();
    },

    async summary(now: number): Promise<StoreSummary> {
      const [orderDocs, ownedDocs, rate] = await Promise.all([
        db.collection(orders).orderBy("createdAt", "desc").limit(FIRESTORE_SCAN_LIMIT).get(),
        db.collection(owned).get(),
        valueOf("rate"),
      ]);
      const rows: OrderRow[] = orderDocs.docs.map((d) => {
        const o = d.data();
        return { id: d.id, player: text(o.player), lookId: text(o.lookId), usd: text(o.usd, "0"), amountRaw: text(o.amount, "0"), status: text(o.status, "open"), createdAt: num(o.createdAt), expiresAt: num(o.expiresAt), paidAt: typeof o.paidAt === "number" ? o.paidAt : null, payer: orNull(o.payer), hash: orNull(o.hash) };
      });
      const list = ownedDocs.docs.map((d) => ({ player: text(d.data().player), lookId: text(d.data().lookId), at: num(d.data().grantedAt) }));
      return summarize(rows, list, parseRate(rate?.value, rate?.at), now);
    },
  };
}
