// Helpers for the admin sign-in's tests: a game made of the package's parts (the player's sign-in, the admin's sign-in and the admin handler) on one
// store kind, a browser that keeps its cookies, and the three wallet apps answering with keys made in the test. No network, no money.
import { readFileSync } from "node:fs";
import { createAdminHandler, createMemoryStore, type AdminHandler, type AdminStore } from "../src/admin/index.js";
import { createD1Store } from "../src/admin/adapters/d1.js";
import { createAdminSignin, createMemoryAdminSignin, type AdminSignin, type AdminSigninOptions, type AdminSigninStore } from "../src/admin-signin/index.js";
import { createD1AdminSignin } from "../src/admin-signin/adapters/d1.js";
import { createMemoryPlayerSignin, createPlayerSignin, type PlayerSignin, type PlayerSigninStore } from "../src/player-signin/index.js";
import { createD1PlayerSignin } from "../src/player-signin/adapters/d1.js";
import { account, sha256, signBytes, signText } from "./player-signin-keys.js";
import { d1Over, noSqlite, sqlite, type Sqlite } from "./shop-helpers.js";

export { noSqlite };
export const ORIGIN = "http://game.test";
export const HOST = "game.test";
export const OWNER = account("the owner");
export const STRANGER = account("a stranger");
export type Account = { address: string; privateKey: string };

export const PLAYER_SQL = readFileSync(new URL("../src/player-signin/adapters/d1.sql", import.meta.url), "utf8");
export const ADMIN_SQL = readFileSync(new URL("../src/admin-signin/adapters/d1.sql", import.meta.url), "utf8");

// The game starter's tables as its migrations 0001 to 0006 make them (with `orders` for the admin store's summary): what a starter that moves onto the
// package has today.
export const STARTER = `
CREATE TABLE orders (id TEXT PRIMARY KEY, player TEXT NOT NULL, look_id TEXT NOT NULL, usd TEXT NOT NULL, rate REAL NOT NULL, amount TEXT NOT NULL, amount_lock TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, hold_until INTEGER NOT NULL, hash TEXT UNIQUE, payer TEXT, paid_at INTEGER, visitor TEXT);
CREATE TABLE owned (player TEXT NOT NULL, look_id TEXT NOT NULL, order_id TEXT NOT NULL, granted_at INTEGER NOT NULL, PRIMARY KEY (player, look_id));
CREATE TABLE signin_requests (id TEXT PRIMARY KEY, starter TEXT NOT NULL, status TEXT NOT NULL, expires_at INTEGER NOT NULL, nonce TEXT, issued_at INTEGER, account TEXT, delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, address TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_by_expiry ON sessions (expires_at);
CREATE TABLE hits (key TEXT NOT NULL, win INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (key, win));
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);
ALTER TABLE signin_requests ADD COLUMN way TEXT NOT NULL DEFAULT 'berry';
ALTER TABLE signin_requests ADD COLUMN rid TEXT;
ALTER TABLE signin_requests ADD COLUMN label TEXT;
UPDATE signin_requests SET rid = id WHERE rid IS NULL;
CREATE INDEX signin_requests_by_rid ON signin_requests (rid);
ALTER TABLE sessions ADD COLUMN via TEXT NOT NULL DEFAULT 'wallet';
ALTER TABLE sessions ADD COLUMN scope TEXT NOT NULL DEFAULT 'play';
UPDATE sessions SET scope = 'admin' WHERE expires_at - created_at = 86400000;
CREATE TABLE admin_logins (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, country TEXT, browser TEXT NOT NULL);
CREATE INDEX admin_logins_by_time ON admin_logins (at);
ALTER TABLE signin_requests ADD COLUMN scope TEXT NOT NULL DEFAULT 'play';
`;

let ips = 0;
/** A new IP address for each call: the per-address limits kept in memory are never what refuses a call in these tests. */
export const nextIp = () => `198.51.${(++ips >> 8) % 250}.${ips % 250}`;

/** A browser of the game's page: it keeps its cookies and sends the game's Origin. */
export class Browser {
  jar = new Map<string, string>();
  constructor(
    readonly origin = ORIGIN,
    readonly headers: Record<string, string> = {},
  ) {}
  keep(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = decodeURIComponent(pair.slice(i + 1).trim());
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim())) || !value) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  request(path: string, body?: unknown, method?: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json", Origin: this.origin, "CF-Connecting-IP": nextIp(), ...this.headers };
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
    const m = method ?? (body === undefined ? "GET" : "POST");
    return new Request(`${this.origin}${path}`, { method: m, headers, body: m === "GET" || m === "HEAD" ? undefined : JSON.stringify(body ?? {}) });
  }
}

export type Kind = "memory" | "d1";

/** A game: the player's sign-in, the admin's sign-in and the admin handler, on one store kind, with one clock that a test moves. */
export function makeGame(kind: Kind, o: { owner?: string | null; admin?: Partial<AdminSigninOptions>; schema?: string } = {}) {
  const clock = { now: 1_790_000_000_000 };
  let db: Sqlite | null = null;
  let playerStore: PlayerSigninStore;
  let adminStore: AdminSigninStore;
  let store: AdminStore;
  if (kind === "d1") {
    db = sqlite(o.schema ?? `${PLAYER_SQL}\n${ADMIN_SQL}\nCREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);\nCREATE TABLE orders (id TEXT PRIMARY KEY, player TEXT NOT NULL, look_id TEXT NOT NULL, usd TEXT NOT NULL, amount TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, paid_at INTEGER, payer TEXT, hash TEXT);\nCREATE TABLE owned (player TEXT NOT NULL, look_id TEXT NOT NULL, order_id TEXT NOT NULL, granted_at INTEGER NOT NULL);`);
    const d1 = d1Over(db);
    playerStore = createD1PlayerSignin(d1);
    adminStore = createD1AdminSignin(d1);
    // The admin store's own "Sign out everywhere" and sign-in list: the same tables.
    store = createD1Store(d1, { logins: true });
  } else {
    playerStore = createMemoryPlayerSignin();
    adminStore = createMemoryAdminSignin();
    store = createMemoryStore();
  }
  const owner = o.owner === undefined ? OWNER.address : o.owner;
  const now = () => clock.now;
  const allow = () => true;
  const player: PlayerSignin = createPlayerSignin({ store: playerStore, siteAddress: owner, now, limit: allow });
  const admin: AdminSignin = createAdminSignin({ store: adminStore, owner, now, limit: allow, ...o.admin });
  if (kind === "memory") {
    // A memory admin store has no sign-in list of its own: the sign-in's.
    store.recentLogins = (n) => admin.recentLogins(n);
    store.signOutEverywhere = () => admin.signOutEverywhere();
  }
  const handler: AdminHandler = createAdminHandler({ store, defaults: { character: "nanoterra", signin: "exchange" }, owner, session: (req, at) => admin.session(req, at), now, limit: allow });
  /** The game's router: the two sign-ins, then the admin. */
  const route = async (req: Request): Promise<Response> => (await player.handle(req)) ?? (await admin.handle(req)) ?? (await handler.handle(req)) ?? new Response("not found", { status: 404 });
  /** A browser's call; it keeps the cookies. */
  const call = async (b: Browser, path: string, body?: unknown, method?: string) => {
    const res = await route(b.request(path, body, method));
    b.keep(res);
    const text = await res.text();
    let json: Record<string, any> | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: json, res };
  };
  /** A wallet app's call: no cookie, no Origin. */
  const wallet = async (url: string, body?: unknown) => {
    const res = await route(new Request(url, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": nextIp() }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  /** Plays wallet app `way` for a request a browser started (`start`, the answer of a start): reads it, signs it as `who`, posts the answer. */
  const answer = async (way: string, start: Record<string, any>, who: Account = OWNER, tamper?: (body: Record<string, any>) => Record<string, any>) => {
    let body: Record<string, any>;
    let url: string;
    if (way === "nautilus") {
      const item = nanoauthItem(start.link);
      url = item.method.url;
      const formatted = `${Math.floor(clock.now / 1000)}:${item.label}:${item.account}`;
      const bytes = new TextEncoder().encode(formatted);
      body = { account: who.address, signature: signBytes(who.privateKey, bytes), signed: Buffer.from(bytes).toString("hex"), formatted, label: item.label };
    } else if (way === "nanchat") {
      const m = /message=([^&]+)&url=(.+)$/.exec(start.link)!;
      const message = decodeURIComponent(m[1]);
      url = decodeURIComponent(m[2]);
      body = { account: who.address, signature: signText(who.privateKey, `Signed Message: ${message}`), message };
    } else {
      url = decodeURIComponent(/request_uri=(.+)$/.exec(start.link)![1]);
      const read = await wallet(url);
      if (read.status !== 200) return read;
      const { nanoSigninMessage } = await import("@nano133/signin");
      const message = nanoSigninMessage(read.body, who.address);
      body = { protocol: "nano-signin-v1", requestId: start.id, address: who.address, signatureType: "nano-ed25519-blake2b-sha256", message, signature: signBytes(who.privateKey, sha256(message)) };
    }
    return wallet(url, tamper ? tamper(body) : body);
  };
  /** True when a wallet's answer was accepted (Berry: 204; Nautilus: status 0; NanChat: ok). */
  const accepted = (way: string, r: { status: number; body: any }) => (way === "berry" ? r.status === 204 : way === "nautilus" ? r.status === 200 && r.body?.status === 0 : r.status === 200 && r.body?.ok === true);
  /** A new browser signed in to /admin as `who` with `way`. */
  const adminLogin = async (way = "berry", who: Account = OWNER, b = new Browser()) => {
    const s = await call(b, "/api/admin-signin/start", { way });
    if (s.status !== 200) throw new Error(`start: ${s.status} ${JSON.stringify(s.body)}`);
    const a = await answer(way, s.body!, who);
    if (!accepted(way, a)) throw new Error(`answer: ${JSON.stringify(a)}`);
    const c = await call(b, "/api/admin-signin/check", { id: s.body!.id, way });
    if (c.body?.status !== "signedin") throw new Error(`check: ${JSON.stringify(c.body)}`);
    return b;
  };
  return { clock, db, player, admin, handler, store, playerStore, adminStore, route, call, wallet, answer, accepted, adminLogin };
}

/** The JSON of a nanoauth: link. */
export const nanoauthItem = (link: string): { label: string; message: string; account: string; method: { url: string } } => JSON.parse(Buffer.from(link.slice("nanoauth:".length), "base64url").toString("utf8"));
