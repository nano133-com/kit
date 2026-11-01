// What a multiplayer game sends when its player plays an emote, and what it does with another player's. The kit has no network: the game carries the
// message on its own connection. One message is enough: `{ emote: id }`. A move, a jump or the water ends an emote on every screen by itself (the other
// players see the character move), so there is no "stop" to send unless the game stops an emote with no move. A loop (Dance, Sit) plays until a move:
// the local player's `onEmote` fires again every LOOP_AGAIN_MS while it plays, so a player who comes later sees it; a screen that already shows that
// loop goes on with it (a repeat does not start it again).
//
// nano133.com's island, one example (not a rule): the room server takes `{ t: "react", k: "dance" }` from a player and sends the others
// `{ t: "react", id: <player>, k: "dance" }`; each page then plays it on that player's character. Its server keeps a list of the ids it relays
// (room-server/server.mjs ISLAND_EMOTES) and drops any other.

/** How often a loop is sent again while it plays (ms), as the island does. */
export const LOOP_AGAIN_MS = 10_000;

/** The local player played an emote: which, whether it loops, and when (performance.now()). `again`: a loop sent again for the players who came later. */
export type EmoteEvent = { id: string; loop: boolean; at: number; again: boolean };
/** The local player's emote ended: it played to its end, a move or the water stopped it, or the game called `stop`. */
export type EmoteStop = { id: string; at: number; why: "end" | "move" | "stop" };

/** What to send to the other players: the emote's id, nothing else. */
export type EmoteMessage = { emote: string };
export const emoteMessage = (e: Pick<EmoteEvent, "id">): EmoteMessage => ({ emote: e.id });

/** The id in a message from another player, or null when it is not a message of this shape. The game still checks the id against its own list. */
export function readEmoteMessage(m: unknown): string | null {
  if (typeof m !== "object" || m === null) return null;
  const id = (m as { emote?: unknown }).emote;
  return typeof id === "string" && id.length > 0 && id.length <= 40 ? id : null;
}
