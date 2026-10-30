// The routes of the game's own friends list, on the Web `Request` and `Response` types (a Worker, Firebase Functions, Node).
//
//   GET  {base}   the player's view: { showOnline, people }
//   POST {base}   one operation, { op, ... }:
//                   request { name }                   (the name through the game's directory)
//                   accept | decline | remove | block | unblock { edge }
//                   invite { edge, where }
//                   pulse { where (text, or null to leave), lease }
//                   visibility { showOnline: boolean }
//
// The player is the game's own signed-in player (`player(request)`); a visitor who is not signed in gets 401. A POST must come from the game's own
// page, and a read must not come from another page. Each player has 30 calls a minute. No answer ever holds a player id: a row names a player by
// the directory's name and an opaque edge.

import { fail, foreignOrigin, json, memoryLimiter, readLimited, sameOrigin } from "../admin/http.js";
import { EDGE_PATTERN } from "./rules.js";
import { FriendsError, type FriendsStore, type PlayerDirectory } from "./types.js";

export type FriendsOp = "request" | "accept" | "decline" | "remove" | "block" | "unblock" | "invite" | "pulse" | "visibility";

export type FriendsHandlerOptions = {
  store: FriendsStore;
  directory: PlayerDirectory;
  /** The game's signed-in player of this request (its own id), or null. */
  player(request: Request): Promise<string | null>;
  /** Where the routes are. Default "/friends". */
  base?: string;
  /** A limiter: false means "too many". Default: a fixed window in memory, 30 calls a minute for each player. */
  limit?: (key: string, limit: number, windowMs: number, now: number) => boolean | Promise<boolean>;
  /** The time now in ms. Default Date.now. */
  now?: () => number;
  /** Told about a fault in the store or the directory. The player gets a plain 500 and never sees it. */
  onError?: (e: unknown) => void;
};

export const FRIENDS_LIMITS = {
  /** Calls of one player (reads and writes together). */
  calls: { limit: 30, windowMs: 60_000 },
  /** The biggest body of a POST. */
  bodyMax: 1024,
  /** The longest name a request may send. */
  nameMax: 64,
} as const;

const sharedLimit = memoryLimiter();
const OPS = new Set<FriendsOp>(["request", "accept", "decline", "remove", "block", "unblock", "invite", "pulse", "visibility"]);

export function createFriendsHandler(options: FriendsHandlerOptions): { base: string; handle(request: Request): Promise<Response | null> } {
  const base = options.base ?? "/friends";
  if (!base.startsWith("/") || base.length < 2 || base.endsWith("/")) throw new Error('base must start with "/" and not end with "/", like "/friends"');
  const now = options.now ?? (() => Date.now());
  const limit = options.limit ?? sharedLimit;
  const report = (e: unknown) => {
    try {
      options.onError?.(e);
    } catch {
      // nothing more can be done
    }
  };

  async function run(req: Request, player: string, at: number): Promise<Response> {
    if (req.method === "GET") return json(await options.store.view(player, options.directory, at));
    const text = await readLimited(req, FRIENDS_LIMITS.bodyMax);
    if (text === null) return fail(413, "That is too much to send.");
    let body: Record<string, unknown>;
    try {
      const v: unknown = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) return fail(400, "Send an object with an op.");
      body = v as Record<string, unknown>;
    } catch {
      return fail(400, "Send JSON.");
    }
    const op = body.op as FriendsOp;
    if (typeof op !== "string" || !OPS.has(op)) return fail(400, "Unknown op.");
    const store = options.store;
    const edge = (): string => {
      if (typeof body.edge !== "string" || !EDGE_PATTERN.test(body.edge)) throw new FriendsError(400, "Choose a player on your list.");
      return body.edge;
    };
    switch (op) {
      case "request": {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > FRIENDS_LIMITS.nameMax) return fail(400, "Enter a player's name.");
        const other = await options.directory.byName(name);
        if (!other) return fail(404, "No player has that name.");
        await store.request(player, other, at);
        break;
      }
      case "accept":
        await store.accept(player, edge(), at);
        break;
      case "decline":
        await store.decline(player, edge());
        break;
      case "remove":
        await store.remove(player, edge());
        break;
      case "block":
        await store.block(player, edge(), at);
        break;
      case "unblock":
        await store.unblock(player, edge(), at);
        break;
      case "invite":
        await store.invite(player, edge(), typeof body.where === "string" ? body.where : "", at);
        break;
      case "pulse":
        await store.pulse(player, body.where === null ? null : typeof body.where === "string" ? body.where : "", typeof body.lease === "string" ? body.lease : "", at);
        // A pulse needs no list back: the panel reads the view on its own clock.
        return json({ ok: true });
      case "visibility":
        if (typeof body.showOnline !== "boolean") return fail(400, "Send showOnline as true or false.");
        await store.setShowOnline(player, body.showOnline);
        break;
    }
    return json(await store.view(player, options.directory, now()));
  }

  async function handle(req: Request): Promise<Response | null> {
    const url = new URL(req.url);
    if (url.pathname !== base) return null;
    try {
      if (req.method !== "GET" && req.method !== "POST") return fail(405, "Not allowed.", {}, { Allow: "GET, POST" });
      if (req.method === "POST" ? !sameOrigin(req) : foreignOrigin(req)) return fail(403, "This call must come from the game's own page.");
      let player: string | null;
      try {
        player = await options.player(req);
      } catch (e) {
        report(e);
        return fail(503, "The game's server could not check your sign-in. Try again.");
      }
      if (typeof player !== "string" || !player) return fail(401, "Sign in to see your friends.");
      const at = now();
      if (!(await limit(`${base}|friends|${player}`, FRIENDS_LIMITS.calls.limit, FRIENDS_LIMITS.calls.windowMs, at))) return fail(429, "Too many calls. Wait a minute.");
      return await run(req, player, at);
    } catch (e) {
      if (e instanceof FriendsError) return fail(e.status, e.message);
      report(e);
      return fail(500, "The game's server could not do that. Try again.");
    }
  }

  return { base, handle };
}
