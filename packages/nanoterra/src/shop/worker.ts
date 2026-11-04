// The shop for a Cloudflare Worker with D1, set up from the game starter's own settings (wrangler.jsonc "vars" and secrets). One call gives the routes,
// the cron's payment scan, what the page and the admin need to know, and the store:
//
//   import { createShop } from "@nano133/nanoterra/shop/worker";
//   import looks from "../../looks.json";
//   import plays from "../../plays.json";                 // optional: rounds, levels, lives or continues a player buys and uses once
//   const shop = createShop(env, { catalogue: looks, plays, legal: () => loadLegal(createD1Store(env.DB)), player: async (req) => (await sessionOf(env.DB, req))?.address ?? null });
//                                                         // legal: the admin's Legal card ("@nano133/nanoterra/admin" and "/admin/d1")
//   const answer = await shop.handle(request);            // null when it is not a shop route
//   ...
//   async scheduled(_e, env, ctx) { ctx.waitUntil(createShop(env, opts).scan()); }   // the */10 cron
//
// The settings (the starter's names): RECEIVE_ADDRESS (the creator's address; the example or a wrong checksum keeps test mode), TEST_MODE ("on" keeps
// test mode with a real address), NODE_API_KEY (secret, optional: Nanswap Nodes first), NANO_NODES (optional: the game's own nodes), TURNSTILE_SITE_KEY
// and the secret TURNSTILE_SECRET (both, or no person check). "none", "skip", "off" and "-" mean "not set". The store is D1 on the starter's tables
// (`env.DB`; the migration is "@nano133/nanoterra/shop/d1.sql"; a game with plays applies "@nano133/nanoterra/shop/d1-plays.sql" too, before it
// deploys). The player's sign-in is the game's own (`player`).

import type { D1Like } from "../admin/adapters/d1.js";
import { createD1Shop, d1Limit, visitorKey, type ShopTables } from "./adapters/d1.js";
import { createShopHandler, SHOP_LIMITS, type ShopHandler, type ShopHandlerOptions } from "./handler.js";
import { nodesFor, settingValue, type Fetch } from "./nodes.js";
import type { ShopStore } from "./store.js";

/** The settings the shop reads. Every one is optional except the database. */
export type ShopEnv = {
  DB: D1Like;
  RECEIVE_ADDRESS?: string;
  TEST_MODE?: string;
  NODE_API_KEY?: string;
  NANO_NODES?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
};

export type ShopOptions = Pick<ShopHandlerOptions, "catalogue" | "plays" | "legal" | "player" | "base" | "playsBase" | "now" | "onError" | "rate" | "rpc"> & {
  /** The D1 table names (default: the starter's). */
  tables?: ShopTables;
  /** The `fetch` for Turnstile's check (a test gives its own). */
  fetch?: Fetch;
};

const VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** "on", "true", "1" or "yes" (any case). */
const isOn = (v?: string) => /^(on|true|1|yes)$/i.test((v ?? "").trim());

/** Whether Turnstile is on: the site key AND the secret are both set. */
export const turnstileOn = (env: Pick<ShopEnv, "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET">): boolean => Boolean(settingValue(env.TURNSTILE_SECRET) && settingValue(env.TURNSTILE_SITE_KEY));

/** True when the person check passes, or when Turnstile is off (the starter's turnstile.ts). The secret is sent to Cloudflare only. */
export async function turnstileCheck(env: Pick<ShopEnv, "TURNSTILE_SITE_KEY" | "TURNSTILE_SECRET">, token: unknown, ip: string | null, fetchFn: Fetch = (i, init) => fetch(i, init)): Promise<boolean> {
  if (!turnstileOn(env)) return true;
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  const form = new FormData();
  form.append("secret", settingValue(env.TURNSTILE_SECRET)!);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetchFn(VERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

export type Shop = ShopHandler & {
  store: ShopStore;
  /** What the game's page needs (the starter's GET /api/config gives these two): whether pay screens are in test mode, and Turnstile's site key or null. */
  config(): { testMode: boolean; turnstileSiteKey: string | null };
  /** For the admin's Status card: the address, test mode, Turnstile, the nodes' names and plain sentences about what is still off. */
  status(): { address: string | null; testMode: boolean; turnstile: boolean; nodes: string[]; warnings: string[] };
};

export function createShop(env: ShopEnv, options: ShopOptions): Shop {
  // A game that gives plays has the plays' migration. One that gives none may have it too (it sold plays before): the store reads the schema, never
  // plays.json, so a play order paid after the plays left the file is still a play (a credit, never a look).
  const store = createD1Shop(env.DB, { tables: options.tables, ...(Array.isArray(options.plays) && options.plays.length > 0 ? { plays: true } : {}) });
  const nodes = nodesFor(env);
  const turnstile = turnstileOn(env);
  const handler = createShopHandler({
    ...options,
    store,
    payee: env.RECEIVE_ADDRESS ?? null,
    testMode: isOn(env.TEST_MODE),
    nodes,
    visitor: (req) => visitorKey(env.DB, req, { meta: options.tables?.meta }),
    // Two layers, as the starter: the game's router counts every call in memory; this one counts new orders for the whole game, in D1 (`hits`).
    limit: (key, limit, windowMs, at) => d1Limit(env.DB, key, limit, windowMs, at),
    personCheck: turnstile ? (token, req) => turnstileCheck(env, token, req.headers.get("CF-Connecting-IP"), options.fetch) : undefined,
  });
  return {
    ...handler,
    store,
    config: () => ({ testMode: handler.testMode, turnstileSiteKey: turnstile ? settingValue(env.TURNSTILE_SITE_KEY)! : null }),
    status() {
      const warnings: string[] = [];
      if (handler.testMode) warnings.push(handler.payee ? "Test mode is on (TEST_MODE). Pay screens say TEST MODE: DO NOT PAY." : "Test mode: no receive address is set.");
      if (!turnstile)
        warnings.push(
          settingValue(env.TURNSTILE_SECRET) || settingValue(env.TURNSTILE_SITE_KEY)
            ? "Turnstile is OFF: set both TURNSTILE_SITE_KEY and the secret TURNSTILE_SECRET."
            : "Turnstile is OFF: sign-in and orders are not checked for bots. Add a free Turnstile widget (see README).",
        );
      if (!settingValue(env.NODE_API_KEY)) warnings.push("No NODE_API_KEY: payments are checked on public Nano nodes only, which promise no uptime.");
      return { address: handler.payee, testMode: handler.testMode, turnstile, nodes: nodes.map((n) => n.name), warnings };
    },
  };
}

export { SHOP_LIMITS };
