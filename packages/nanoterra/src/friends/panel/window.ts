// The nano133 friends window: the contract between the kit and nano133's page /embed/friends (contract v1, agreed with the site on 2026-10-30).
// The window holds the player's Nanoterra friends and their live connection; the game gets none of them. It says only a count for the badge, a
// request to close, and a friend's https address to join (the kit asks the player first).

/** The version of the messages. A message with another `v` is ignored. */
export const WINDOW_V = 1;
/** The prefix of every message type. */
export const WINDOW_PREFIX = "n133-friends:";

/** Messages from the game's page to the window (sent with the window's origin as the target). */
export type ToWindow =
  | { type: "n133-friends:hello"; v: 1; game: string; where: string | null; open: boolean }
  | { type: "n133-friends:where"; v: 1; where: string | null }
  | { type: "n133-friends:open"; v: 1 }
  | { type: "n133-friends:closed"; v: 1 };

/** Messages from the window that the kit acts on. Anything else is ignored. */
export type FromWindow =
  | { type: "n133-friends:ready"; v: 1 }
  | { type: "n133-friends:badge"; v: 1; count: number }
  | { type: "n133-friends:close"; v: 1 }
  | { type: "n133-friends:join"; v: 1; url: string; name: string };

/** The window's address for a game. */
export function windowUrl(origin: string, game: string): string {
  return `${origin}/embed/friends?game=${encodeURIComponent(game)}`;
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

/** A message from the window, checked: its type, its version and each field. Null for anything else. */
export function readWindowMessage(data: unknown): FromWindow | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const m = data as Record<string, unknown>;
  if (m.v !== WINDOW_V || typeof m.type !== "string") return null;
  switch (m.type) {
    case "n133-friends:ready":
    case "n133-friends:close":
      return { type: m.type, v: 1 };
    case "n133-friends:badge": {
      const n = typeof m.count === "number" && Number.isFinite(m.count) ? Math.max(0, Math.min(99, Math.floor(m.count))) : 0;
      return { type: m.type, v: 1, count: n };
    }
    case "n133-friends:join": {
      if (typeof m.url !== "string" || m.url.length > 2048) return null;
      let url: URL;
      try {
        url = new URL(m.url);
      } catch {
        return null;
      }
      // https only: an island friend's room on nano133, or a friend's game at its listed address.
      if (url.protocol !== "https:" || url.username || url.password) return null;
      const name = whereText(m.name) ?? "your friend";
      return { type: m.type, v: 1, url: url.href, name: Array.from(name).slice(0, 40).join("") };
    }
    default:
      return null;
  }
}
