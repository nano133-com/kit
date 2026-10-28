// The admin handler: the routes of /admin on the Web `Request` and `Response` types, so it fits a Worker, Firebase Functions and Node.
//
//   GET  {base}/summary   the numbers: status, orders, the looks that players own
//   GET  {base}/game      the two switches
//   POST {base}/game      a press: { character } or { signin } (only the two known words)
//   POST {base}/check     the payment check, when the game gives one
//
// EVERY request under the base goes through `adminAccess` first, before the route is even looked up: a visitor who is not the owner gets 401 or 403
// for any path, a real one or not, and learns nothing about the routes. The handler sets no CORS header. A POST must come from the game's own page.

import { adminAccess, type AdminAccess, type AdminSession } from "./guard.js";
import { fail, json, memoryLimiter, readLimited, sameOrigin } from "./http.js";
import type { AdminOrder, AdminPlayer, AdminStatus, AdminStore, AdminSummary } from "./store.js";
import { mergeSettings, parsePatch, type GameSettings, type GameState } from "./switches.js";

export type AdminRoute = { method: "GET" | "POST"; path: string };

export type AdminHandlerOptions = {
  /** The game's database. */
  store: AdminStore;
  /** What a switch is while /admin has not set it: the game's own words (game.config.json in the starter). */
  defaults: GameSettings;
  /** The game's own address ("nano_...", lowercase, its checksum already checked by the host), or null when none is set. */
  owner: string | null;
  /** The admin login of this request, or null. It reads the ADMIN cookie only (a login made for the game's players is not one). */
  session: (req: Request, now: number) => Promise<AdminSession | null>;
  /** The Status card: what only the game knows. Default: the owner's address and nothing else. */
  status?: (now: number) => Promise<AdminStatus> | AdminStatus;
  /** What a look is called, for the orders. Default: its id. */
  lookName?: (id: string) => string | undefined;
  /** The payment check (POST check). Its answer is sent as `scan`. With none given, the route does not exist. */
  check?: (now: number) => Promise<unknown>;
  /** Where the routes are. Default "/api/admin". */
  basePath?: string;
  /** How old an admin login may be, in ms: one day at most (a bigger number is cut to one day). */
  maxAgeMs?: number;
  /** A limiter for the writes: false means "too many". Default: a fixed window in memory, one bucket for the whole admin (only the owner gets this far). */
  limit?: (key: string, limit: number, windowMs: number, now: number) => boolean | Promise<boolean>;
  /** The time now in ms. Default Date.now. */
  now?: () => number;
  /** Told about a fault in the store or in a callback. The visitor gets a plain 500 and never sees the fault. */
  onError?: (e: unknown) => void;
};

export type AdminHandler = {
  /** Every route, so that a test can walk them (see "@nano133/nanoterra/admin/conformance"). */
  routes: readonly AdminRoute[];
  basePath: string;
  /** The answer for a request under the base path, or null when the request is not for the admin (the game goes on with its own routes). */
  handle(req: Request): Promise<Response | null>;
};

/** The limits of the writes. */
export const ADMIN_LIMITS = {
  /** A press on a switch. */
  game: { limit: 30, windowMs: 60_000 },
  /** A payment check. */
  check: { limit: 20, windowMs: 60_000 },
  /** The biggest body a press can have. */
  gameBodyMax: 512,
} as const;

/** The path as a person or a browser might write it: percent-decoded, lowercase, one slash at a time. Used only to decide that a request is for the admin. */
function normal(path: string): string {
  let p = path;
  for (let i = 0; i < 3; i++) {
    try {
      const d = decodeURIComponent(p);
      if (d === p) break;
      p = d;
    } catch {
      break;
    }
  }
  return p.toLowerCase().replace(/\/{2,}/g, "/").replace(/\\/g, "/");
}

/** The default limiter lives at module level: a Worker makes a handler for each request, and a limiter made inside it would forget every press. */
const sharedLimit = memoryLimiter();

export function createAdminHandler(options: AdminHandlerOptions): AdminHandler {
  const base = (options.basePath ?? "/api/admin").toLowerCase();
  if (!base.startsWith("/") || base.length < 2 || base.endsWith("/")) throw new Error('basePath must start with "/" and not end with "/", like "/api/admin"');
  const now = options.now ?? (() => Date.now());
  const limit = options.limit ?? sharedLimit;
  const routes: AdminRoute[] = [
    { method: "GET", path: `${base}/summary` },
    { method: "GET", path: `${base}/game` },
    { method: "POST", path: `${base}/game` },
    ...(options.check ? [{ method: "POST" as const, path: `${base}/check` }] : []),
  ];

  const settings = async (): Promise<GameState> => mergeSettings(await options.store.readSettings(), options.defaults);

  async function summary(at: number): Promise<AdminSummary> {
    const [status, s] = await Promise.all([Promise.resolve(options.status ? options.status(at) : { address: options.owner, testMode: false, warnings: [] as string[] }), options.store.summary(at)]);
    const name = (id: string) => options.lookName?.(id) ?? id;
    const orders: AdminOrder[] = s.orders.map((o) => ({ ...o, look: name(o.lookId) }));
    const players: AdminPlayer[] = s.players.map((p) => ({ player: p.player, looks: p.looks.map((l) => ({ id: l.id, name: name(l.id), at: l.at })) }));
    return { ...status, counts: s.counts, totals: s.totals, rate: s.rate, orders, players };
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    const path = normal(url.pathname);
    if (path !== base && !path.startsWith(`${base}/`)) return null;
    const at = now();
    try {
      // 1. The guard, before anything else.
      let session: AdminSession | null;
      try {
        session = await options.session(req, at);
      } catch (e) {
        options.onError?.(e);
        // The game could not read its sessions: nobody is let in.
        return fail(503, "The game's server could not check your sign-in. Try again.");
      }
      const access: AdminAccess = adminAccess({ owner: options.owner, session, now: at, maxAgeMs: options.maxAgeMs });
      if (!access.ok) {
        const { status, error, reason, signedInAs } = access;
        return fail(status, error, { ...(reason ? { reason } : {}), ...(signedInAs ? { signedInAs } : {}) });
      }
      // 2. The route: an exact path (as the handler lists it), else 404 or 405.
      const exact = url.pathname;
      const known = routes.filter((r) => r.path === exact);
      if (!known.length) return fail(404, "No such admin page.");
      const route = known.find((r) => r.method === req.method);
      if (!route) return fail(405, "Not allowed.", {}, { Allow: known.map((r) => r.method).join(", ") });
      // 3. A write must come from the game's own page.
      if (route.method === "POST" && !sameOrigin(req)) return fail(403, "This call must come from the game's own page.");

      if (route.method === "GET" && route.path === `${base}/summary`) return json(await summary(at));
      if (route.method === "GET") return json(await settings());
      if (route.path === `${base}/game`) {
        if (!(await limit("admin-game", ADMIN_LIMITS.game.limit, ADMIN_LIMITS.game.windowMs, at))) return fail(429, "Too many presses. Wait a minute.");
        const text = await readLimited(req, ADMIN_LIMITS.gameBodyMax);
        if (text === null) return fail(413, "That is too much to send.");
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return fail(400, "Send JSON.");
        }
        const parsed = parsePatch(body);
        if (!parsed.ok) return fail(400, parsed.error);
        await options.store.saveSettings(parsed.patch, at);
        return json(await settings());
      }
      // POST check
      if (!(await limit("admin-check", ADMIN_LIMITS.check.limit, ADMIN_LIMITS.check.windowMs, at))) return fail(429, "Too many checks. Wait a minute.");
      const scan = await options.check!(at);
      return json({ scan, summary: await summary(now()) });
    } catch (e) {
      options.onError?.(e);
      return fail(500, "The game's server could not do that. Nothing was changed that you can see here.");
    }
  }

  return { routes, basePath: options.basePath ?? "/api/admin", handle };
}

/** The settings as the game's own routes need them (the listing file, the character): the stored words, or the game's defaults. A fault in the store gives the defaults. */
export async function loadGameSettings(store: Pick<AdminStore, "readSettings">, defaults: GameSettings): Promise<GameState> {
  try {
    return mergeSettings(await store.readSettings(), defaults);
  } catch {
    return mergeSettings({}, defaults);
  }
}
