import type { Firestore } from "firebase-admin/firestore";

/** A transaction double. It enforces read-before-write and discards one callback pass before commit. */
export function fakeFirestore() {
  type Ref = { path: string };
  let documents = new Map<string, unknown>();
  let tail: Promise<unknown> = Promise.resolve();
  let attempts = 0;
  const db = {
    collection(name: string) {
      return { doc(id: string) { if (!id || id.includes("/")) throw new Error("invalid document id"); return { path: `${name}/${id}` }; } };
    },
    runTransaction<T>(body: (tx: unknown) => Promise<T>): Promise<T> {
      const run = tail.then(async () => {
        let result!: T;
        for (let pass = 0; pass < 2; pass++) {
          const pending = structuredClone(documents);
          let wrote = false;
          const set = (ref: Ref, data: unknown) => {
            wrote = true;
            // Firestore rejects undefined values by default. JSON round-tripping also checks our records.
            JSON.stringify(data, (_key, value) => { if (value === undefined) throw new Error("undefined field"); return value; });
            pending.set(ref.path, structuredClone(data));
          };
          attempts++;
          result = await body({
            async get(ref: Ref) {
              if (wrote) throw new Error("Firestore reads must precede writes");
              const data = pending.get(ref.path);
              return { exists: data !== undefined, data: () => structuredClone(data) };
            },
            set,
            create(ref: Ref, data: unknown) { if (pending.has(ref.path)) throw new Error("document exists"); set(ref, data); },
          });
          if (pass === 1) documents = pending;
        }
        return result;
      });
      tail = run.catch(() => {});
      return run;
    },
  };
  return { db: db as unknown as Firestore, attempts: () => attempts };
}
