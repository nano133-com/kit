// The friends list of a game's OWN players: the types, the limits and the store contract. The package never sees a Nanoterra account here: a
// player is the game's own id, and a name comes from the game's own directory. (Nanoterra's friends are another thing: the nano133 window, ./panel.)

/** A row of a player's list, as the browser gets it. `edge` is the store's opaque id for the pair (never a player id). */
export type FriendState = "friend" | "incoming" | "outgoing" | "blocked";
export type FriendRow = { edge: string; name: string; state: FriendState; online: boolean; where: string | null; invite: { where: string; at: number } | null };
export type FriendView = { showOnline: boolean; people: FriendRow[] };

/** Live rows a player may have (friends, requests both ways, blocks), as the island. */
export const FRIEND_LIMIT = 100;
/** A pulse counts as online this long. */
export const FRIEND_LIVE_MS = 120_000;
/** An invite shows this long. */
export const FRIEND_INVITE_MS = 600_000;
/** An unanswered request goes after this. */
export const FRIEND_REQUEST_MS = 30 * 86_400_000;
/** The longest `where` a store keeps (after trimming and removing control characters). */
export const FRIEND_WHERE_MAX = 64;

/** The game's players, which only the game knows: its sign-in id for a name, and the names to show. */
export interface PlayerDirectory {
  byName(name: string): Promise<string | null>;
  names(ids: string[]): Promise<Map<string, string>>;
}

/** The game's database for friends. An adapter writes ONLY friend rows, presence rows and the show-online choice. */
export interface FriendsStore {
  view(player: string, directory: PlayerDirectory, now: number): Promise<FriendView>;
  /** A request by the other player's id; an accept when the other already asked. Refuses: self, a full list, a block. */
  request(player: string, other: string, now: number): Promise<void>;
  accept(player: string, edge: string, now: number): Promise<void>;
  decline(player: string, edge: string): Promise<void>;
  remove(player: string, edge: string): Promise<void>;
  block(player: string, edge: string, now: number): Promise<void>;
  unblock(player: string, edge: string, now: number): Promise<void>;
  /** Only between friends; `where` is the game's own text (a room, a level), at most 64 characters. */
  invite(player: string, edge: string, where: string, now: number): Promise<void>;
  /** Presence: here now (`where` or null), kept FRIEND_LIVE_MS; a `lease` per tab, so an old tab cannot clear a new one. */
  pulse(player: string, where: string | null, lease: string, now: number): Promise<void>;
  setShowOnline(player: string, on: boolean): Promise<void>;
  /** A player's "delete my data": every row of theirs; returns how many. */
  forget(player: string): Promise<number>;
}

/**
 * A refusal of a store or the handler: the status to answer and words a player can read. A store throws it for a rule (a block, a full list, an edge
 * that is not theirs); anything else it throws is a fault, and the handler answers a plain 500.
 */
export class FriendsError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    message: string,
  ) {
    super(message);
    this.name = "FriendsError";
  }
}
