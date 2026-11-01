// Helpers for the shop's tests. No real network and no real money: D1 on SQLite (node:sqlite), Firestore on a fake with real transaction conflicts, a
// mock Nano node on 127.0.0.1, and Nano addresses made from random keys in each run (nobody holds those keys: they are for the checksum only).
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { D1Like, D1StatementLike } from "../src/admin/adapters/d1.js";
import { blake2bShort } from "../src/shop/address.js";
import type { FirestoreShopLike, ShopBatch, ShopDocRef, ShopQuery, ShopQuerySnap, ShopTransaction } from "../src/shop/adapters/firestore.js";

/** The test's looks: a fixture, so no test names a game's own looks. */
export const LOOKS: unknown = JSON.parse(readFileSync(new URL("./fixtures/shop-looks.json", import.meta.url), "utf8"));

// ---- addresses ----

const ALPHABET = "13456789abcdefghijkmnopqrstuwxyz";
const b32 = (n: bigint, chars: number) => Array.from({ length: chars }, (_, i) => ALPHABET[Number((n >> BigInt(5 * (chars - 1 - i))) & 31n)]).join("");

/** A whole Nano address (right checksum) for a random key. Nobody holds the key: never send money to it. */
export function testAddress(): string {
  const key = randomBytes(32);
  const n = key.reduce((a, b) => (a << 8n) | BigInt(b), 0n);
  const check = blake2bShort(key, 5).reverse().reduce((a, b) => (a << 8n) | BigInt(b), 0n);
  return `nano_${b32(n, 52)}${b32(check, 8)}`;
}

export const hash64 = () => randomBytes(32).toString("hex").toUpperCase();

// ---- D1 on SQLite ----

export type Sqlite = import("node:sqlite").DatabaseSync;
let DatabaseSync: typeof import("node:sqlite").DatabaseSync | null = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  DatabaseSync = null;
}
export const noSqlite = DatabaseSync ? false : "node:sqlite is not in this Node";
export const SHOP_SQL = readFileSync(new URL("../src/shop/adapters/d1.sql", import.meta.url), "utf8");

/** A D1 over a SQLite database, as the friends tests make it; `log` gets every statement. */
export function d1Over(db: Sqlite, log: { sql: string; args: unknown[] }[] = []): D1Like {
  const stmt = (sql: string, args: unknown[] = []): D1StatementLike & { exec(): unknown } => ({
    bind: (...v) => stmt(sql, v),
    all: async <T>() => (log.push({ sql, args }), { results: db.prepare(sql).all(...(args as never[])) as T[] }),
    first: async <T>() => (log.push({ sql, args }), ((db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null)),
    run: async () => (log.push({ sql, args }), { meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
    exec: () => (log.push({ sql, args }), db.prepare(sql).run(...(args as never[]))),
  });
  return {
    prepare: (sql) => stmt(sql),
    async batch(list) {
      db.exec("BEGIN");
      const results: unknown[] = [];
      try {
        for (const s of list as ReturnType<typeof stmt>[]) results.push({ meta: { changes: Number((s.exec() as { changes?: number | bigint }).changes ?? 0) } });
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return results;
    },
  };
}

/** A new SQLite database with `schema` (default: the package's d1.sql). */
export function sqlite(schema = SHOP_SQL): Sqlite {
  const db = new DatabaseSync!(":memory:");
  db.exec(schema);
  return db;
}

// ---- Firestore, on a fake ----

type Data = Record<string, unknown>;
type Doc = { data: Data; v: number };

/**
 * A fake of the small interface the adapter uses. A transaction records the version of each document it read; at the end it checks them, and runs again
 * when another write came in between (as Firestore does): so two transactions at the same moment cannot both pass a check.
 */
export function fakeFirestore() {
  const cols = new Map<string, Map<string, Doc>>();
  const writes: string[] = [];
  let clock = 0;
  const col = (name: string) => cols.get(name) ?? cols.set(name, new Map()).get(name)!;
  type Ref = ShopDocRef & { __col: string; __id: string };
  const snapOf = (d: Doc | undefined) => ({ exists: d !== undefined, data: () => (d ? structuredClone(d.data) : undefined) });
  const ref = (name: string, id: string): Ref => ({ __col: name, __id: id, get: async () => snapOf(col(name).get(id)) });
  const query = (name: string, filters: [string, string, unknown][] = [], max?: number): ShopQuery & { doc(id: string): Ref } => ({
    where: (f, op, v) => query(name, [...filters, [f, op, v]], max),
    limit: (n) => query(name, filters, n),
    async get(): Promise<ShopQuerySnap> {
      await Promise.resolve();
      let docs = [...col(name)].filter(([, d]) => filters.every(([f, op, v]) => (op === "==" ? d.data[f] === v : typeof d.data[f] === "number" && (d.data[f] as number) < (v as number))));
      if (max) docs = docs.slice(0, max);
      return { docs: docs.map(([id, d]) => ({ id, ref: ref(name, id), data: () => structuredClone(d.data) })) };
    },
    doc: (id) => ref(name, id),
  });
  const write = (r: ShopDocRef, data: Data | null, merge = false) => {
    const { __col, __id } = r as Ref;
    if (data === null) col(__col).delete(__id);
    else col(__col).set(__id, { data: merge ? { ...(col(__col).get(__id)?.data ?? {}), ...structuredClone(data) } : structuredClone(data), v: ++clock });
    writes.push(__col);
  };
  const db: FirestoreShopLike = {
    collection: (name) => query(name),
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 25; attempt++) {
        const reads = new Map<string, number>();
        const pending: (() => void)[] = [];
        const tx: ShopTransaction = {
          async get(r: ShopDocRef) {
            await Promise.resolve();
            const { __col, __id } = r as Ref;
            if (pending.length) throw new Error("a transaction reads before its first write");
            const d = col(__col).get(__id);
            reads.set(`${__col}/${__id}`, d?.v ?? -1);
            return snapOf(d);
          },
          set: (r, data, o) => void pending.push(() => write(r, data, Boolean(o?.merge))),
          delete: (r) => void pending.push(() => write(r, null)),
        };
        const out = await fn(tx);
        const stale = [...reads].some(([k, v]) => {
          const [c, ...id] = k.split("/");
          return (col(c).get(id.join("/"))?.v ?? -1) !== v;
        });
        if (stale) continue;
        for (const p of pending) p();
        return out;
      }
      throw new Error("too much contention");
    },
    batch(): ShopBatch {
      const pending: (() => void)[] = [];
      return {
        set: (r, data, o) => void pending.push(() => write(r, data, Boolean(o?.merge))),
        delete: (r) => void pending.push(() => write(r, null)),
        async commit() {
          if (pending.length > 500) throw new Error("a batch holds at most 500 writes");
          for (const p of pending) p();
        },
      };
    },
  };
  /** Every document as one text. */
  const dump = async () => JSON.stringify([...cols].map(([name, docs]) => [name, [...docs].map(([id, d]) => [id, d.data])]));
  return { db, cols, col, writes, dump };
}

// ---- a mock Nano node (the starter's test helper) ----

export type Send = { hash: string; from: string; to: string; amount: string; seenMs: number; confirmed: boolean; received?: boolean };
export type NodeMode = "ok" | "down" | "http500" | "error" | "slow" | "garbage";

/** A Nano node on 127.0.0.1 that answers receivable, account_history and block_info from a list of sends. */
export class MockNode {
  server: Server;
  url = "";
  mode: NodeMode = "ok";
  sends: Send[] = [];
  calls: { action: string; headers: IncomingMessage["headers"] }[] = [];

  constructor() {
    this.server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const call = JSON.parse(body || "{}");
        this.calls.push({ action: call.action, headers: req.headers });
        if (this.mode === "down") return req.socket.destroy();
        if (this.mode === "slow") return setTimeout(() => res.end("{}"), 3000);
        if (this.mode === "http500") return res.writeHead(500).end("oops");
        if (this.mode === "garbage") return res.writeHead(200).end("<html>");
        res.setHeader("Content-Type", "application/json");
        if (this.mode === "error") return res.end(JSON.stringify({ error: "Internal server error" }));
        res.end(JSON.stringify(this.answer(call)));
      });
    });
  }

  async start() {
    await new Promise<void>((ok) => this.server.listen(0, "127.0.0.1", ok));
    const addr = this.server.address();
    this.url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    return this;
  }

  stop() {
    this.server.closeAllConnections?.();
    return new Promise<void>((ok) => this.server.close(() => ok()));
  }

  answer(call: Record<string, string>): unknown {
    if (call.action === "receivable") {
      const list = this.sends.filter((s) => s.to === call.account && !s.received && BigInt(s.amount) >= BigInt(call.threshold ?? "1"));
      if (!list.length) return { blocks: "" };
      return { blocks: Object.fromEntries(list.map((s) => [s.hash, call.source === "true" ? { amount: s.amount, source: s.from } : s.amount])) };
    }
    if (call.action === "account_history") {
      const list = this.sends.filter((s) => s.to === call.account && s.received);
      if (!list.length) return { error: "Account not found" };
      return { account: call.account, history: list.map((s) => ({ type: "state", subtype: "receive", account: s.from, amount: s.amount, link: s.hash, hash: hash64(), local_timestamp: String(Math.floor(s.seenMs / 1000) + 5), confirmed: "true" })) };
    }
    if (call.action === "block_info") {
      const s = this.sends.find((x) => x.hash === call.hash);
      if (!s) return { error: "Block not found" };
      return { block_account: s.from, amount: s.amount, local_timestamp: String(Math.floor(s.seenMs / 1000)), confirmed: s.confirmed ? "true" : "false", subtype: "send", contents: { type: "state", account: s.from, link_as_account: s.to } };
    }
    return { error: "Unknown command" };
  }
}
