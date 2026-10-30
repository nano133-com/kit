// The switches of the "Game" card in /admin, and the words that say what each does. The handler checks a press with `parsePatch`; the panel
// draws the card from `SWITCHES` and `FRIENDS_CHOICES`. A switch changes ONLY these three settings; never a look, a price or an order.

/** Which character the player is: Nanoterra's island character (the one the player has there) or the game's own. */
export type Character = "nanoterra" | "own";
/** How the game signs a Nanoterra player in: the code exchange, a signed ticket (a game with no server), or not at all. */
export type Signin = "exchange" | "ticket" | "none";
/**
 * Which friends list the game shows: Nanoterra's (the nano133 window, "@nano133/nanoterra/friends/panel"), the game's own (its own players and store), or none.
 * A three-way choice, not an On/Off switch.
 */
export type Friends = "nanoterra" | "own" | "off";
/** The game's own words for the switches. `friends` may be left out: it is "nanoterra" then (on by default). */
export type GameSettings = { character: Character; signin: Signin; friends?: Friends };
/** What a press can set: sign-in is on ("exchange": a game with a server) or off ("none"). */
export type GamePatch = { character?: Character; signin?: "exchange" | "none"; friends?: Friends };
/** The settings as they are now, and which ones /admin has set (the others still have the game's default). */
export type GameState = { character: Character; signin: Signin; friends: Friends; fromAdmin: { character: boolean; signin: boolean; friends: boolean } };

export const isCharacter = (v: unknown): v is Character => v === "nanoterra" || v === "own";
export const isSigninChoice = (v: unknown): v is "exchange" | "none" => v === "exchange" || v === "none";
export const isSignin = (v: unknown): v is Signin => v === "exchange" || v === "ticket" || v === "none";
export const isFriends = (v: unknown): v is Friends => v === "nanoterra" || v === "own" || v === "off";
/** The friends list a game shows while neither its own words nor /admin say: Nanoterra's. */
export const DEFAULT_FRIENDS: Friends = "nanoterra";
/** The sign-in switch is on for any way but "none". */
export const signinOn = (s: Signin): boolean => s !== "none";

/** A request body for a press: only the two known words, at least one. Anything else is refused, with the reason in words. */
export function parsePatch(body: unknown): { ok: true; patch: GamePatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: 'Send an object with "character", "signin" or "friends".' };
  const patch: GamePatch = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (key === "character" && isCharacter(value)) patch.character = value;
    else if (key === "signin" && isSigninChoice(value)) patch.signin = value;
    else if (key === "friends" && isFriends(value)) patch.friends = value;
    else if (key === "friends") return { ok: false, error: '"friends" must be "nanoterra", "own" or "off".' };
    else if (key === "character") return { ok: false, error: '"character" must be "nanoterra" or "own".' };
    else if (key === "signin") return { ok: false, error: '"signin" must be "exchange" or "none".' };
    else return { ok: false, error: `"${key}" is not a game switch.` };
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'Send "character", "signin" or "friends".' };
  return { ok: true, patch };
}

/** The settings from what the store kept and the game's defaults. A stored value that is not one of the known words is ignored. */
export function mergeSettings(stored: { character?: unknown; signin?: unknown; friends?: unknown }, defaults: GameSettings): GameState {
  return {
    character: isCharacter(stored.character) ? stored.character : defaults.character,
    signin: isSigninChoice(stored.signin) ? stored.signin : defaults.signin,
    friends: isFriends(stored.friends) ? stored.friends : isFriends(defaults.friends) ? defaults.friends : DEFAULT_FRIENDS,
    fromAdmin: { character: isCharacter(stored.character), signin: isSigninChoice(stored.signin), friends: isFriends(stored.friends) },
  };
}

/** The friends choice of the card: its title, and for each choice its short name (the card's three keys) and one plain sentence. Nanoterra's is the default. */
export const FRIENDS_TITLE = "Friends list";
export const FRIENDS_CHOICES: Record<Friends, { name: string; note: string }> = {
  nanoterra: {
    name: "Nanoterra",
    note: "Nanoterra: a player signed in on nano133 sees their Nanoterra friends in a small nano133 frame in your game, and their friends see that they are playing it. The friends stay on nano133: your game gets none of them.",
  },
  own: {
    name: "The game's own",
    note: "The game's own: a friends list of this game's players, kept in this game's own database. Nanoterra friends do not show.",
  },
  off: { name: "Off", note: "Off: the game shows no friends list." },
};

/** One switch of the card: its title, and one plain sentence for each state. */
export type SwitchId = "character" | "signin";
export const SWITCHES: Record<SwitchId, { title: string; on: string; off: string }> = {
  character: {
    title: "Players can play as their Nanoterra character",
    on: "On: a player who signs in from Nanoterra plays as the character they picked there. Anyone else plays as the island's first character. The game may also let a player switch to its own character.",
    off: "Off: every player plays as this game's own character, with no choice.",
  },
  signin: {
    title: "Players can sign in with Nanoterra",
    on: "On: this game's listing file says players can sign in with Nanoterra, and the game accepts that sign-in.",
    off: "Off: the listing file says no sign-in, and the game refuses it: a link made before still signs nobody in.",
  },
};

/**
 * The character comes through the sign-in: only a player who signs in from Nanoterra brings one. So the character switch is shown with its dependency. With sign-in Off the
 * card says what a player gets: the island's first character, every player, a player who signed in from Nanoterra before included ("Off means Off"). That is the GAME's page
 * to do (the starter's src/client/ui/player.ts draws no Nanoterra character while sign-in is Off); the card only says it.
 */
export const CHARACTER_NEEDS_SIGNIN = "This needs “Players can sign in with Nanoterra” to be On: only a player who signs in from Nanoterra brings a character.";
export const CHARACTER_SIGNIN_OFF = "Sign-in from Nanoterra is Off, so every player starts as the island's first character, a player who signed in from Nanoterra before included. The game may also let a player switch to its own character.";

/** What to tell the creator under the sign-in switch about Nanoterra's review. A game cannot see that review: it says so. */
export const REVIEW_NOTE =
  "Your choice is saved here at once. The sign-in word is part of your listing file, and Nanoterra's review decides what Nanoterra shows for a game that is listed. This page cannot see that review. Check it on Nanoterra's launch page (step 6).";
export const REVIEW_LINK = "https://nano133.com/build/nanoterra/launch";

/** The state of a switch from the settings, and the patch that a press sends (the other state). */
export const stateOf = (id: SwitchId, s: GameSettings): boolean => (id === "character" ? s.character === "nanoterra" : signinOn(s.signin));
export const pressOf = (id: SwitchId, s: GameSettings): GamePatch => (id === "character" ? { character: s.character === "nanoterra" ? "own" : "nanoterra" } : { signin: signinOn(s.signin) ? "none" : "exchange" });
