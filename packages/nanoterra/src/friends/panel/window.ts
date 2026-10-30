// The nano133 friends window: the contract between the kit and nano133's page /embed/friends (contract v1, accepted by the site on 2026-10-30).
// The window holds the player's Nanoterra friends and their live connection; the game gets none of them. It says only its height, two counts for
// the badge, that it needs a tap (Storage Access), and a friend's https address to join (the kit asks the player first). No message carries an
// address, a pass or a player id.

/** The `source` of every message, both ways. A message with another `source` is not for this contract. */
export const WINDOW_SOURCE = "nanoterra-friends";
/** The version of the messages. A message with another `v` is ignored. */
export const WINDOW_V = 1;

type Head = { source: "nanoterra-friends"; v: 1 };

/** Messages from the game's page to the window (sent with the window's origin as the target). */
export type ToWindow = Head & ({ type: "open" } | { type: "closed" } | { type: "where"; where: string | null });

/** Messages from the window that the kit acts on. Anything else is ignored. */
export type FromWindow = Head &
  ({ type: "ready" } | { type: "size"; height: number } | { type: "badge"; online: number; requests: number } | { type: "join"; url: string } | { type: "signin" });

/** The window's address for a game. */
export function windowUrl(origin: string, game: string): string {
  return `${origin}/embed/friends?game=${encodeURIComponent(game)}&v=${WINDOW_V}`;
}

/** A message to the window. */
export function toWindow(m: { type: "open" } | { type: "closed" } | { type: "where"; where: string | null }): ToWindow {
  return { source: WINDOW_SOURCE, v: WINDOW_V, ...m };
}

/**
 * The game's `where` as the kit sends it: plain text, control characters removed, trimmed, at most 64 characters (the site does the same again and
 * shows it as text only). Null when nothing is left.
 */
export function whereText(where: unknown): string | null {
  if (typeof where !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const plain = where.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim();
  const cut = Array.from(plain).slice(0, 64).join("").trim();
  return cut || null;
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(99, Math.floor(v)) : null);

/** A message from the window, checked: its source, its version, its type and each field. Null for anything else (a bad field too). */
export function readWindowMessage(data: unknown): FromWindow | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  if (m.source !== WINDOW_SOURCE || m.v !== WINDOW_V || typeof m.type !== "string") return null;
  const head: Head = { source: WINDOW_SOURCE, v: WINDOW_V };
  switch (m.type) {
    case "ready":
    case "signin":
      return { ...head, type: m.type };
    case "size": {
      if (typeof m.height !== "number" || !Number.isFinite(m.height) || m.height < 0) return null;
      return { ...head, type: "size", height: Math.min(10_000, Math.ceil(m.height)) };
    }
    case "badge": {
      const online = count(m.online);
      const requests = count(m.requests);
      if (online === null || requests === null) return null;
      return { ...head, type: "badge", online, requests };
    }
    case "join": {
      if (typeof m.url !== "string" || m.url.length > 2048) return null;
      let url: URL;
      try {
        url = new URL(m.url);
      } catch {
        return null;
      }
      // https only: an island friend's room on nano133, or a friend's game at its listed address. No name or password in it.
      if (url.protocol !== "https:" || url.username || url.password) return null;
      return { ...head, type: "join", url: url.href };
    }
    default:
      return null;
  }
}
