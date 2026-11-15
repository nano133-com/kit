// Sign in from Nanoterra on a Cloudflare Worker (the game starter's way): the client id, the secret and (tests only) the stand-in's address from the
// Worker's environment, the "works once" store on D1 (`hits`), and the visitor by CF-Connecting-IP. The game gives the rest (`signIn`, `session`,
// `keep`, `enabled`, its words or screens).
//
//   import { createWorkerConnect } from "@nano133/nanoterra/connect/worker";
//   const connect = createWorkerConnect(env, { signIn, session, keep, enabled });
//   const answer = await connect.handle(request);   // null for any other path

import { createConnect, type Connect, type ConnectOnce, type ConnectOptions } from "./core.js";
import { createD1Once } from "./adapters/d1.js";
import type { D1CounterLike } from "../shop/adapters/d1-limit.js";

/** What the Worker reads from its environment. NANOTERRA_SECRET is a secret (`npx wrangler secret put NANOTERRA_SECRET`); the client id is a setting. */
export type ConnectEnv = {
  NANOTERRA_CLIENT_ID?: string;
  NANOTERRA_SECRET?: string;
  /** Tests and a local dev server only: a stand-in for nano133.com on this computer. */
  NANOTERRA_ORIGIN?: string;
  DB?: D1CounterLike;
};

/**
 * An optional setting or secret (the starter's `setting`): its value without spaces around it, or undefined when it is not set. The "Deploy to
 * Cloudflare" setup page needs a value in every field, so "none", "skip", "off" and "-" (in any case) also mean "not set".
 */
export function setting(v?: string): string | undefined {
  const s = (v ?? "").trim();
  return s && !/^(none|skip|off|-)$/i.test(s) ? s : undefined;
}

export type WorkerConnectOptions = Omit<ConnectOptions, "clientId" | "secret" | "site" | "once"> & {
  /** The "works once" store. Default: D1 on `db` (default `env.DB`), the starter's `hits` table. */
  once?: ConnectOnce;
  db?: D1CounterLike;
};

export function createWorkerConnect(env: ConnectEnv, options: WorkerConnectOptions): Connect {
  const db = options.db ?? env.DB;
  const once = options.once ?? (db ? createD1Once(db) : undefined);
  if (!once) throw new TypeError("connect: give the Worker's D1 database (env.DB or `db`) or a `once` store");
  return createConnect({ ...options, clientId: setting(env.NANOTERRA_CLIENT_ID), secret: setting(env.NANOTERRA_SECRET), site: setting(env.NANOTERRA_ORIGIN), once });
}
