// The admin handler: the routes of /admin on the Web `Request` and `Response` types, so it fits a Worker, Firebase Functions and Node.
//
//   GET  {base}/summary   the numbers: status, orders, the looks that players own, the plays (sold, used, ready, not used in time) and what to send back
//   GET  {base}/game      the game switches
//   POST {base}/game      a press: { character }, { signin }, { friends }, { emotes } or { freePlay } (only the known words), or one of the Legal card's
//                         { adultsOnly }, { sellLives }, { refundDays }, { refundWords } or { confirmLaws: true } (./legal.ts)
//   POST {base}/check     the payment check, when the game gives one
//
// EVERY request under the base goes through `adminAccess` first, before the route is even looked up: a visitor who is not the owner gets 401 or 403
// for any path, a real one or not, and learns nothing about the routes. The handler sets no CORS header. A POST must come from the game's own page.

import { adminAccess, type AdminAccess, type AdminSession } from "./guard.js";
import { fail, foreignOrigin, json, memoryLimiter, readLimited, sameOrigin } from "./http.js";
import { ADMIN_LOGINS_SHOWN, type AdminLogin, type AdminOrder, type AdminPlayer, type AdminStatus, type AdminStore, type AdminSummary, type StoreSummary } from "./store.js";
import { checkPlays } from "../looks/play.js";
import type { LegalState } from "./legal.js";
import { mergeLegal } from "./legalRules.js";
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
  /** The Status card: what only the game knows. It gets the numbers of the store too, for a warning that depends on them ("2 payments came late"). Default: the owner's address and nothing else. */
  status?: (now: number, summary: StoreSummary) => Promise<AdminStatus> | AdminStatus;
  /** What a look is called, for the orders. Default: its id. */
  lookName?: (id: string) => string | undefined;
  /**
   * The game's plays (plays.json as it was read), or none. They name the play orders, give each play's wait to the summary (`useWithinDays`) and list
   * every play in the summary's `plays`. Checked with `checkPlays`: a bad file throws here.
   */
  plays?: unknown;
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

/** A browser name as the list shows it: words ("Chrome on macOS"). Anything else a store gives (a raw browser text, an address) is shown as "Unknown browser". */
const BROWSER_NAME = /^[A-Za-z][A-Za-z ]{0,39}$/;

/** The limits of the writes. */
export const ADMIN_LIMITS = {
  /** A press on a switch. */
  game: { limit: 30, windowMs: 60_000 },
  /** A payment check. */
  check: { limit: 20, windowMs: 60_000 },
  /** "Sign out everywhere". */
  signOutAll: { limit: 5, windowMs: 60_000 },
  /** The biggest body a press can have (the Legal card's refund words are the longest: 280 characters). */
  gameBodyMax: 2048,
} as const;

/**
 * Whether a request path could be read as under the admin base by anything: in any case, with backslashes for slashes, doubled slashes, and percent codes (decoded again and
 * again, a code at a time, so one bad code does not stop the rest). Used ONLY to decide that a request is the admin's, so that the guard answers it. A path that is still
 * changing after ten decodings is not an honest path: it is the admin's too (the guard refuses it). The route match later is exact on the parsed path.
 */
function readsAsBase(raw: string, base: string): boolean {
  let p = raw;
  for (let i = 0; i < 10; i++) {
    const plain = p.toLowerCase().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    if (plain === base || plain.startsWith(`${base}/`)) return true;
    const decoded = p.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (decoded === p) return false;
    p = decoded;
  }
  return true;
}

/** The default limiter lives at module level: a Worker makes a handler for each request, and a limiter made inside it would forget every press. */
const sharedLimit = memoryLimiter();

export function createAdminHandler(options: AdminHandlerOptions): AdminHandler {
  const base = (options.basePath ?? "/api/admin").toLowerCase();
  if (!base.startsWith("/") || base.length < 2 || base.endsWith("/")) throw new Error('basePath must start with "/" and not end with "/", like "/api/admin"');
  const now = options.now ?? (() => Date.now());
  const limit = options.limit ?? sharedLimit;
  /** The key of a limit: the base path and the owner come first, so two games in one process never share a count. */
  const lkey = (name: string) => `${base}|${options.owner ?? ""}|${name}`;
  const routes: AdminRoute[] = [
    { method: "GET", path: `${base}/summary` },
    { method: "GET", path: `${base}/game` },
    { method: "POST", path: `${base}/game` },
    ...(options.check ? [{ method: "POST" as const, path: `${base}/check` }] : []),
    ...(options.store.signOutEverywhere ? [{ method: "POST" as const, path: `${base}/signout-all` }] : []),
  ];

  const settings = async (): Promise<GameState> => mergeSettings(await options.store.readSettings(), options.defaults);
  const plays = options.plays === undefined || options.plays === null ? [] : checkPlays(options.plays);
  const playOf = (id: string) => plays.find((p) => p.id === id);

  async function summary(at: number): Promise<AdminSummary> {
    // A credit of a play that left plays.json cannot be used: the summary lists it to send back. (No plays given: the store does not judge.)
    const s = await options.store.summary(at, options.plays === undefined || options.plays === null ? {} : { isPlay: (id) => Boolean(playOf(id)) });
    const status = options.status ? await options.status(at, s) : { address: options.owner, testMode: false, warnings: [] as string[] };
    const name = (id: string) => options.lookName?.(id) ?? id;
    const playName = (id: string) => playOf(id)?.name ?? id;
    const orders: AdminOrder[] = s.orders.map((o) => ({ ...o, look: o.kind === "play" ? playName(o.lookId) : name(o.lookId) }));
    const players: AdminPlayer[] = s.players.map((p) => ({
      player: p.player,
      looks: p.looks.map((l) => ({ id: l.id, name: name(l.id), at: l.at })),
      ...(p.ready?.length ? { ready: p.ready.map((r) => ({ id: r.id, name: playName(r.id), ready: r.ready })) } : {}),
    }));
    // Every play of plays.json (with nothing sold: zeros), then any play that sold and is no longer in it.
    const stats = s.plays ?? [];
    const zero = (playId: string) => ({ playId, sold: 0, used: 0, ready: 0, late: 0, notUsedInTime: 0 });
    const playRows = [...plays.map((p) => stats.find((x) => x.playId === p.id) ?? zero(p.id)), ...stats.filter((x) => !playOf(x.playId))].map((x) => ({ ...x, name: playName(x.playId) }));
    const sendBack = (s.sendBack ?? []).map((x) => ({ ...x, name: playName(x.playId) }));
    const totals = { paid: s.totals.paid, paidLate: s.totals.paidLate, sendBack: s.totals.sendBack ?? s.totals.paidLate };
    const out: AdminSummary = { ...status, counts: s.counts, totals, rate: s.rate, orders, players, plays: playRows, sendBack, canCheck: Boolean(options.check) };
    if (options.store.recentLogins) {
      // Only the three things of a sign-in go out, whatever the store gave (a store that returns an address or a browser text by mistake does not show it).
      const rows = await options.store.recentLogins(ADMIN_LOGINS_SHOWN);
      out.logins = rows.slice(0, ADMIN_LOGINS_SHOWN).map((l): AdminLogin => ({ at: Number(l.at), country: typeof l.country === "string" && /^[A-Z]{2}$/.test(l.country) ? l.country : null, browser: typeof l.browser === "string" && BROWSER_NAME.test(l.browser) ? l.browser : "Unknown browser" }));
    }
    if (options.store.signOutEverywhere) out.canSignOutEverywhere = true;
    return out;
  }

  /** Tells the game about a fault. A fault in the game's own `onError` is not the visitor's business: it is swallowed. */
  const report = (e: unknown): void => {
    try {
      options.onError?.(e);
    } catch {
      // nothing more can be done
    }
  };

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (!readsAsBase(url.pathname, base)) return null;
    try {
      const at = now();
      // 1. The guard, before anything else.
      let session: AdminSession | null;
      try {
        session = await options.session(req, at);
      } catch (e) {
        report(e);
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
      // 3. The call must come from the game's own page: a write must say so (Origin, or Sec-Fetch-Site same-origin); a read must not say it comes from another page.
      if (route.method === "POST" ? !sameOrigin(req) : foreignOrigin(req)) return fail(403, "This call must come from the game's own page.");

      if (route.method === "GET" && route.path === `${base}/summary`) return json(await summary(at));
      if (route.method === "GET") return json(await settings());
      if (route.path === `${base}/game`) {
        if (!(await limit(lkey("admin-game"), ADMIN_LIMITS.game.limit, ADMIN_LIMITS.game.windowMs, at))) return fail(429, "Too many presses. Wait a minute.");
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
        const patch = parsed.patch;
        // The owner's confirmation is kept once: its time is the first press.
        if (patch.confirmLaws && (await settings()).legal.lawsConfirmedAt !== null) delete patch.confirmLaws;
        if (Object.keys(patch).length) await options.store.saveSettings(patch, at);
        return json(await settings());
      }
      if (route.path === `${base}/signout-all`) {
        if (!(await limit(lkey("admin-signout-all"), ADMIN_LIMITS.signOutAll.limit, ADMIN_LIMITS.signOutAll.windowMs, at))) return fail(429, "Too many tries. Wait a minute.");
        const n = await options.store.signOutEverywhere!();
        return json({ ok: true, signedOut: n });
      }
      // POST check
      if (!(await limit(lkey("admin-check"), ADMIN_LIMITS.check.limit, ADMIN_LIMITS.check.windowMs, at))) return fail(429, "Too many checks. Wait a minute.");
      const scan = await options.check!(at);
      return json({ scan, summary: await summary(now()) });
    } catch (e) {
      report(e);
      return fail(500, "The game's server could not do that. Nothing was changed that you can see here.");
    }
  }

  return { routes, basePath: options.basePath ?? "/api/admin", handle };
}

/** The settings as the game's own routes need them (the listing file, the character, the friends list, the emotes, free play, the Legal card): the stored words, or the game's defaults. A fault in the store gives the defaults. */
export async function loadGameSettings(store: Pick<AdminStore, "readSettings">, defaults: GameSettings): Promise<GameState> {
  try {
    return mergeSettings(await store.readSettings(), defaults);
  } catch {
    return mergeSettings({}, defaults);
  }
}

/**
 * The Legal card's settings, for the shop (`createShopHandler({ legal: () => loadLegal(adminStore) })`): the stored words, or the kit's defaults
 * (DEFAULT_LEGAL). A fault in the store gives the defaults, which are the careful ones: 18 and up, no life or continue on sale, no owner's confirmation
 * (so no play order outside test mode).
 */
export async function loadLegal(store: Pick<AdminStore, "readSettings">): Promise<LegalState> {
  try {
    return mergeLegal(await store.readSettings());
  } catch {
    return mergeLegal({});
  }
}
