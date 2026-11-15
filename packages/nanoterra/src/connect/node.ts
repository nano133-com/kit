// Sign in from Nanoterra on Node (Nano Arcade's way: Express and React Router, any database). The core is the same as the Worker's: it reads a Web
// `Request` and answers a Web `Response` (Node 20 or later has both, and `crypto.subtle`). What differs on Node:
//
// - The server sits behind a proxy and may not see its own https address, so the game names its public origins (`origins`): the press of Continue
//   must come from one of them. The cookies' `__Host-` names follow the request's address (only plain http on localhost goes without).
// - There is no CF-Connecting-IP: the game gives its own limits (`limit`) or the visitor's address as its proxy gives it (`visitor`).
// - The "works once" store is the game's: `createFirestoreOnce` ("@nano133/nanoterra/connect/firestore"), or its own `ConnectOnce`.
//
// React Router (a resource route gets the Web Request as it is):
//   export const loader = ({ request }) => connect.start(request);          // routes/nanoterra.start.ts, and the same for callback
//   export const action = ({ request }) => connect.confirm(request);       // routes/nanoterra.confirm.ts, and the same for cancel
// Express:
//   app.use(connectMiddleware(connect, "https://game.example"));           // before any body parser on these paths, or after: both work
//
// A game's own rules (Arcade's: a session with no key, a sign-in with no key that never ends one with a key, its limit for each account, the owner's
// notice) go in the hooks: `arrived` (before any screen), `same` (the same account), `signIn` (may answer a page instead of a session).

import { CONNECT_PATHS, createConnect, type Connect, type ConnectOptions } from "./core.js";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for a public origin a game may name: https, or plain http on this computer (a dev server). */
function goodOrigin(o: string): boolean {
  try {
    const u = new URL(o);
    return u.origin === o && (u.protocol === "https:" || (u.protocol === "http:" && LOCAL.has(u.hostname)));
  } catch {
    return false;
  }
}

export type NodeConnectOptions = ConnectOptions & { origins: readonly string[] };

/** The core with Node's checks: `origins` must be named (each https, or http on localhost), and `limit` or `visitor` must be given. */
export function createNodeConnect(options: NodeConnectOptions): Connect {
  if (!options.origins?.length || !options.origins.every(goodOrigin)) throw new TypeError("connect: name the game's public origins, like [\"https://game.example\"] (http only on localhost)");
  if (!options.limit && !options.visitor) throw new TypeError("connect: on Node give `limit` (the game's own limits) or `visitor` (the visitor's address as the proxy gives it)");
  return createConnect(options);
}

/** The parts of Node's `IncomingMessage` (and Express's `Request`) that the bridge reads. */
export type NodeRequestLike = {
  method?: string;
  url?: string;
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  /** Express's parsed body, when a body parser ran first. */
  body?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
};
/** The parts of Node's `ServerResponse` that the bridge writes. */
export type NodeResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string | string[]): unknown;
  end(chunk?: Uint8Array): unknown;
};

/** The press's form is tiny: a body is read up to this many bytes and no further (the core reads 1,024 at most). */
const BODY_MAX = 2048;
/** And for at most this long (ms): a body that comes one byte at a time does not hold the request open past it (F12 of the review). */
export const BODY_MS = 10_000;

async function bodyOf(req: NodeRequestLike, bodyMs: number): Promise<Uint8Array | string | null> {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") return req.body;
    if (req.body instanceof Uint8Array) return req.body;
    if (typeof req.body === "object") return new URLSearchParams(Object.entries(req.body as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")).toString();
    return null;
  }
  const iterate = req[Symbol.asyncIterator];
  if (!iterate) return null;
  const parts: Uint8Array[] = [];
  let size = 0;
  const it = iterate.call(req);
  const end = Date.now() + bodyMs;
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((done) => (timer = setTimeout(() => done("late"), Math.max(0, end - Date.now()))));
    const step = await Promise.race([it.next(), late]).finally(() => clearTimeout(timer));
    if (step === "late") {
      void Promise.resolve(it.return?.()).catch(() => undefined);
      return null;
    }
    const { done, value } = step;
    if (done) break;
    const chunk = typeof value === "string" ? new TextEncoder().encode(value) : (value as Uint8Array);
    size += chunk.byteLength;
    if (size > BODY_MAX) {
      await it.return?.();
      return null;
    }
    parts.push(chunk);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return all;
}

/**
 * A Web Request from a Node request, at the game's PUBLIC origin `origin` (never the Host header: a proxy may change it). A POST's body is read with a
 * bound of 2,048 bytes and `bodyMs` (default 10 seconds), or taken from Express's body parser. Use it only for the four paths of this flow.
 */
export async function webRequest(req: NodeRequestLike, origin: string, bodyMs = BODY_MS): Promise<Request> {
  if (!goodOrigin(origin)) throw new TypeError("connect: the origin must be https (http only on localhost)");
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || k.startsWith(":")) continue;
    for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
  }
  const method = (req.method ?? "GET").toUpperCase();
  const url = new URL(req.originalUrl ?? req.url ?? "/", origin);
  if (url.origin !== origin) throw new TypeError("connect: the request's path is not a path");
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  const body = await bodyOf(req, bodyMs);
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return new Request(url, { method, headers, body: typeof body === "string" || body === null ? (body ?? "") : new TextDecoder().decode(body) });
}

/** Writes a Web Response to a Node response: the status, every header (each Set-Cookie on its own), and the body. */
export async function sendResponse(res: NodeResponseLike, answer: Response): Promise<void> {
  res.statusCode = answer.status;
  answer.headers.forEach((value, name) => {
    if (name !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = answer.headers.getSetCookie();
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.end(answer.body ? new Uint8Array(await answer.arrayBuffer()) : undefined);
}

/** An Express middleware for the four routes: it answers them and passes every other path on (`next`), and passes a fault to Express (`next(e)`). */
export function connectMiddleware(connect: Connect, origin: string) {
  if (!goodOrigin(origin)) throw new TypeError("connect: the origin must be https (http only on localhost)");
  const paths = new Set<string>(Object.values(CONNECT_PATHS));
  return async (req: NodeRequestLike, res: NodeResponseLike, next: (e?: unknown) => void): Promise<void> => {
    try {
      const path = new URL(req.originalUrl ?? req.url ?? "/", origin).pathname;
      if (!paths.has(path)) return next();
      const answer = await connect.handle(await webRequest(req, origin));
      if (!answer) return next();
      await sendResponse(res, answer);
    } catch (e) {
      next(e);
    }
  };
}
