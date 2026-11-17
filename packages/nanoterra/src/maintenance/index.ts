// "@nano133/nanoterra/maintenance": a game under maintenance. The owner turns it on or off on /admin (the Maintenance card, ../admin/panel); the game's
// site then shows players a short "Back soon" page, and the game's server tells nano133.com at once, so Nanoterra shows "Under maintenance" and turns
// every Play key of the game off.
//
//   maintenanceGate        the game's router asks it first: a page load of a player gets the "Back soon" page (503), everything else goes on
//   backSoonPage           the "Back soon" page itself (the game gives its name and its own stylesheets: its look)
//   nanoterraTeller        tells nano133.com the new state, in a request signed with the game's Nanoterra secret (the admin handler's `maintenance.tell`)
//   maintenanceSignature   the signature itself (nano133.com checks it the same way)
//
// THE SIGNATURE. The game proves who it is with the client secret it already has for Nanoterra connect (NANOTERRA_SECRET): no second key. nano133.com
// keeps only the SHA-256 of that secret (its app/nanoterra/signin/secret.server.ts), so the key of the HMAC is that hash, as lowercase hex text: the
// game makes it from the secret, nano133.com reads it from its record. The secret itself never leaves the game's server. The signed text names what it
// is for (MAINTENANCE_LABEL), the game's client id, the state and the time of the press in ms. nano133.com refuses a time more than five minutes away
// from its own clock, and a time that is not later than the last one it kept for the game: an old request sent again changes nothing, and two presses
// that arrive out of order keep the newer one.
//
// WHAT THE GATE STOPS: only a player's page load (a GET or HEAD that the browser marks as a navigation, or, with no such mark, asks for HTML). The game's
// API, its files, its listing file and its health answers go on, so a round that is under way when the owner presses finishes and keeps its result: a
// paid play is never lost. The admin page and its sign-in always go on (MAINTENANCE_OPEN). A game that has more pages of its own for the owner adds
// them with `open`.

// This file imports nothing: the admin's server part names its types, and the admin never reaches the character's code (test/package.test.ts).

/** nano133.com: the only site a live game tells. */
const NANOTERRA_SITE = "https://nano133.com";

/** The route of nano133.com that hears a game's maintenance state. */
export const MAINTENANCE_PATH = "/api/nanoterra/maintenance";
/** Put in front of what is signed, so a signature made here is good for nothing else. */
export const MAINTENANCE_LABEL = "@nano133/nanoterra maintenance, v1";
/** How far the time of a press may be from nano133.com's clock (either way). */
export const MAINTENANCE_WINDOW_MS = 5 * 60_000;
/** How long the game's server waits for nano133.com before it says "Nanoterra not told yet". */
export const TELL_TIMEOUT_MS = 5000;
/** What a player's browser is asked to wait before it tries again (seconds; the Retry-After of the "Back soon" page). */
export const RETRY_AFTER_S = 300;

/** The words. "Under maintenance" is Nanoterra's word for the game everywhere (the plot, the list, the game's page, /play). */
export const MAINTENANCE_WORDS = {
  label: "Under maintenance",
  title: "Back soon",
  line: (name: string) => `${name} is under maintenance. Please come back in a little while.`,
} as const;

/** The paths that a game under maintenance still serves to everyone: the admin page and the admin's calls and sign-in (the guard of each still holds). */
export const MAINTENANCE_OPEN = ["/admin", "/admin.html", "/api/admin", "/api/admin-signin"] as const;

/** A client id as nano133.com makes it: "ng_" and 20 hex digits. */
const CLIENT_ID = /^ng_[0-9a-f]{20}$/;
/** The secret as nano133.com makes it, with 16 or more different characters after "ns_": the rule of Nanoterra connect's `strongSecret`, kept the same. */
const strongSecret = (s: string) => /^ns_[A-Za-z0-9_-]{43,97}$/.test(s) && new Set(s.slice(3)).size >= 16;
/** nano133.com, or a stand-in on this machine for a test (Nanoterra connect's `siteOf`, kept the same). Null for anything else. */
function siteOf(site: string): string | null {
  if (site === NANOTERRA_SITE) return site;
  try {
    const u = new URL(site);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    return (u.protocol === "http:" || u.protocol === "https:") && local && u.origin === site.replace(/\/+$/, "") ? u.origin : null;
  } catch {
    return null;
  }
}
const text = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** The text that is signed. */
export const maintenanceMessage = (clientId: string, on: boolean, at: number): string => `${MAINTENANCE_LABEL}\n${clientId}\n${on ? "on" : "off"}\n${at}`;

/** The SHA-256 of the secret as lowercase hex: what nano133.com keeps of it, and the key of the signature. */
export async function secretHash(secret: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", text.encode(secret.trim())));
}

/** The HMAC-SHA256 of `maintenanceMessage`, keyed with `key` (the secret's hash as hex text), as lowercase hex. */
export async function signWithHash(key: string, clientId: string, on: boolean, at: number): Promise<string> {
  const k = await crypto.subtle.importKey("raw", text.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, text.encode(maintenanceMessage(clientId, on, at))));
}

/** The signature of a state, made from the game's secret. */
export async function maintenanceSignature(secret: string, clientId: string, on: boolean, at: number): Promise<string> {
  return signWithHash(await secretHash(secret), clientId, on, at);
}

/** What the admin handler's `tell` answers: nano133.com kept the state, or did not (with the reason in words, never a secret). */
export type TellResult = { ok: true } | { ok: false; error: string };
export type Tell = (state: { on: boolean; at: number }) => Promise<TellResult>;

export type TellerOptions = {
  /** NANOTERRA_CLIENT_ID. */
  clientId: string | undefined;
  /** NANOTERRA_SECRET: a secret. Never print, log or commit it. */
  secret: string | undefined;
  /** nano133.com, or a local stand-in on 127.0.0.1 or localhost for a test (`siteOf` of Nanoterra connect). */
  site?: string;
  fetch?: typeof fetch;
};

/** Words for the owner, by what nano133.com answered. */
const REFUSED: Record<number, string> = {
  400: "Nanoterra could not read the request. Update @nano133/nanoterra.",
  401: "Nanoterra did not accept this game's signature. Check NANOTERRA_CLIENT_ID and NANOTERRA_SECRET, and that the game is listed.",
  409: "Nanoterra already has a newer press. Press again.",
  422: "Nanoterra says this server's clock is wrong by more than five minutes.",
  429: "Nanoterra asks to wait a minute. Press again then.",
};

/**
 * The `tell` of the admin handler: one POST to nano133.com with the client id, the state, the time and the signature. Null while the game has no
 * client id or no secret of the shape nano133.com makes (the switch still works on the game's own site; the card says Nanoterra is not told).
 */
export function nanoterraTeller(options: TellerOptions): Tell | null {
  const clientId = (options.clientId ?? "").trim();
  const secret = (options.secret ?? "").trim();
  const site = siteOf(options.site ?? NANOTERRA_SITE);
  if (!CLIENT_ID.test(clientId) || !strongSecret(secret) || !site) return null;
  const send = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return async ({ on, at }) => {
    try {
      const sig = await maintenanceSignature(secret, clientId, on, at);
      const res = await send(`${site}${MAINTENANCE_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: clientId, on, at, sig }),
        redirect: "manual",
        signal: AbortSignal.timeout(TELL_TIMEOUT_MS),
      });
      await res.body?.cancel().catch(() => undefined);
      if (res.status === 200) return { ok: true };
      return { ok: false, error: REFUSED[res.status] ?? `Nanoterra answered ${res.status}.` };
    } catch {
      return { ok: false, error: "Nanoterra did not answer." };
    }
  };
}

/** Whether a request is a page load of a browser: a GET or HEAD that the browser marks as a navigation (Sec-Fetch-Mode), or, with no such header, one that asks for HTML. */
export function isPageLoad(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const mode = req.headers.get("Sec-Fetch-Mode");
  if (mode !== null) return mode === "navigate";
  return (req.headers.get("Accept") ?? "").toLowerCase().includes("text/html");
}

/** Whether a path is one that a game under maintenance still serves (MAINTENANCE_OPEN, and what is under each). */
export const openPath = (path: string): boolean => MAINTENANCE_OPEN.some((p) => path === p || path.startsWith(`${p}/`));

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export type BackSoonOptions = {
  /** The game's name. */
  name: string;
  /** The game's own stylesheets, on its own site ("/back-soon.css"): its look. None: the kit's classes with no style. */
  stylesheets?: readonly string[];
  /** The page's language. Default "en". */
  lang?: string;
};

/**
 * The "Back soon" page: the game's name, "Back soon" and one line, with no script and no inline style (it fits a strict CSP: `style-src 'self'`).
 * The classes are `n133-back-soon` (the body), `n133-back-soon-card`, `n133-back-soon-name`, `n133-back-soon-title` and `n133-back-soon-line`;
 * "@nano133/nanoterra/maintenance/style.css" is a calm default look on the `--n133-*` tokens.
 */
export function backSoonPage(options: BackSoonOptions): string {
  const name = escapeHtml(options.name);
  const links = (options.stylesheets ?? []).map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("");
  return `<!doctype html><html lang="${escapeHtml(options.lang ?? "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${MAINTENANCE_WORDS.title}: ${name}</title>${links}</head><body class="n133-back-soon"><main class="n133-back-soon-card"><p class="n133-back-soon-name">${name}</p><h1 class="n133-back-soon-title">${MAINTENANCE_WORDS.title}</h1><p class="n133-back-soon-line">${escapeHtml(MAINTENANCE_WORDS.line(options.name))}</p></main></body></html>`;
}

export type GateOptions = {
  /** The "Back soon" page (backSoonPage) or a Response of the game's own. */
  page: () => string | Response | Promise<string | Response>;
  /** More paths of the game's own that stay open (a page for the owner). The admin's are always open. */
  open?: (path: string) => boolean;
};

/**
 * The game's router asks this FIRST, with the maintenance state (`loadMaintenance`): null means "go on as usual". With maintenance on, a player's page
 * load gets the "Back soon" page: 503, Retry-After, never kept by a cache. Every other request goes on (see the head of this file).
 */
export async function maintenanceGate(req: Request, on: boolean, options: GateOptions): Promise<Response | null> {
  if (!on || !isPageLoad(req)) return null;
  const path = new URL(req.url).pathname;
  if (openPath(path) || options.open?.(path)) return null;
  const page = await options.page();
  const res = typeof page === "string" ? new Response(req.method === "HEAD" ? null : page, { headers: { "Content-Type": "text/html; charset=utf-8" } }) : page;
  const out = new Response(res.body, { status: 503, headers: res.headers });
  out.headers.set("Retry-After", String(RETRY_AFTER_S));
  out.headers.set("Cache-Control", "no-store");
  return out;
}
