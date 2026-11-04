// The switches of the "Game" card in /admin, and the words that say what each does. The handler checks a press with `parsePatch`; the panel
// draws the card from `SWITCHES` and `FRIENDS_CHOICES`. A switch changes ONLY these five settings; never a look, a price or an order.
// The "Legal" card's five settings (./legal.ts) go through the same press and the same store: `LEGAL_WORDS` are its words.

import type { LegalPatch, LegalState } from "./legal.js";
import { mergeLegal, parseLegalKey } from "./legalRules.js";
import type { StoredSettings } from "./store.js";

/** Which character the player is: Nanoterra's island character (the one the player has there) or the game's own. */
export type Character = "nanoterra" | "own";
/** How the game signs a Nanoterra player in: the code exchange, a signed ticket (a game with no server), or not at all. */
export type Signin = "exchange" | "ticket" | "none";
/**
 * Which friends list the game shows: Nanoterra's (the nano133 window, "@nano133/nanoterra/friends/panel"), the game's own (its own players and store), or none.
 * A three-way choice, not an On/Off switch.
 */
export type Friends = "nanoterra" | "own" | "off";
/** Whether the game shows Nanoterra's emotes ("@nano133/nanoterra/emotes"): the wheel's Nanoterra emotes and the other players' on their characters. Off leaves the game's own emotes. */
export type Emotes = "on" | "off";
/**
 * Whether the game has free play. "off": a player pays in the game to play (the game asks for the payment; the switch does not). The listing file says it
 * (`"freePlay": false`), and Nanoterra's listing then says "Paid" in place of "Free to play". The game's paid play, its prices and its risk are the creator's.
 */
export type FreePlay = "on" | "off";
/** The game's own words for the switches. `friends`, `emotes` and `freePlay` may be left out: "nanoterra", "on" and "on" then (on by default). */
export type GameSettings = { character: Character; signin: Signin; friends?: Friends; emotes?: Emotes; freePlay?: FreePlay };
/** What a press can set: sign-in is on ("exchange": a game with a server) or off ("none"); and the Legal card's settings (./legal.ts). */
export type GamePatch = { character?: Character; signin?: "exchange" | "none"; friends?: Friends; emotes?: Emotes; freePlay?: FreePlay } & LegalPatch;
/**
 * The settings as they are now, and which of the Game card's /admin has set (the others still have the game's default). `legal` is the Legal card's: the
 * kit's defaults (DEFAULT_LEGAL) until /admin sets them.
 */
export type GameState = {
  character: Character;
  signin: Signin;
  friends: Friends;
  emotes: Emotes;
  freePlay: FreePlay;
  fromAdmin: { character: boolean; signin: boolean; friends: boolean; emotes: boolean; freePlay: boolean };
  legal: LegalState;
};

export const isCharacter = (v: unknown): v is Character => v === "nanoterra" || v === "own";
export const isSigninChoice = (v: unknown): v is "exchange" | "none" => v === "exchange" || v === "none";
export const isSignin = (v: unknown): v is Signin => v === "exchange" || v === "ticket" || v === "none";
export const isFriends = (v: unknown): v is Friends => v === "nanoterra" || v === "own" || v === "off";
export const isEmotes = (v: unknown): v is Emotes => v === "on" || v === "off";
export const isFreePlay = (v: unknown): v is FreePlay => v === "on" || v === "off";
/** The friends list a game shows while neither its own words nor /admin say: Nanoterra's. */
export const DEFAULT_FRIENDS: Friends = "nanoterra";
/** Nanoterra's emotes are on while neither the game's own words nor /admin say. */
export const DEFAULT_EMOTES: Emotes = "on";
/** Free play is on while neither the game's own words nor /admin say. */
export const DEFAULT_FREE_PLAY: FreePlay = "on";
/** The listing file's word for free play (`"freePlay": true` or `false`), from the settings. */
export const freePlayOn = (s: Pick<GameSettings, "freePlay">): boolean => (s.freePlay ?? DEFAULT_FREE_PLAY) === "on";
/** The sign-in switch is on for any way but "none". */
export const signinOn = (s: Signin): boolean => s !== "none";

/** A request body for a press: only the known words, at least one. Anything else is refused, with the reason in words. */
export function parsePatch(body: unknown): { ok: true; patch: GamePatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: 'Send an object with "character", "signin", "friends", "emotes", "freePlay" or a Legal setting.' };
  const patch: GamePatch = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const legal = parseLegalKey(key, value);
    if (legal && "error" in legal) return { ok: false, error: legal.error };
    if (legal) Object.assign(patch, legal.patch);
    else if (key === "character" && isCharacter(value)) patch.character = value;
    else if (key === "signin" && isSigninChoice(value)) patch.signin = value;
    else if (key === "friends" && isFriends(value)) patch.friends = value;
    else if (key === "emotes" && isEmotes(value)) patch.emotes = value;
    else if (key === "freePlay" && isFreePlay(value)) patch.freePlay = value;
    else if (key === "friends") return { ok: false, error: '"friends" must be "nanoterra", "own" or "off".' };
    else if (key === "emotes") return { ok: false, error: '"emotes" must be "on" or "off".' };
    else if (key === "freePlay") return { ok: false, error: '"freePlay" must be "on" or "off".' };
    else if (key === "character") return { ok: false, error: '"character" must be "nanoterra" or "own".' };
    else if (key === "signin") return { ok: false, error: '"signin" must be "exchange" or "none".' };
    else return { ok: false, error: `"${key}" is not a game switch.` };
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'Send "character", "signin", "friends", "emotes", "freePlay" or a Legal setting.' };
  return { ok: true, patch };
}

/** The settings from what the store kept and the game's defaults. A stored value that is not one of the known words is ignored. */
export function mergeSettings(stored: StoredSettings, defaults: GameSettings): GameState {
  return {
    character: isCharacter(stored.character) ? stored.character : defaults.character,
    signin: isSigninChoice(stored.signin) ? stored.signin : defaults.signin,
    friends: isFriends(stored.friends) ? stored.friends : isFriends(defaults.friends) ? defaults.friends : DEFAULT_FRIENDS,
    emotes: isEmotes(stored.emotes) ? stored.emotes : isEmotes(defaults.emotes) ? defaults.emotes : DEFAULT_EMOTES,
    freePlay: isFreePlay(stored.freePlay) ? stored.freePlay : isFreePlay(defaults.freePlay) ? defaults.freePlay : DEFAULT_FREE_PLAY,
    fromAdmin: { character: isCharacter(stored.character), signin: isSigninChoice(stored.signin), friends: isFriends(stored.friends), emotes: isEmotes(stored.emotes), freePlay: isFreePlay(stored.freePlay) },
    legal: mergeLegal(stored),
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
export type SwitchId = "character" | "signin" | "emotes" | "freePlay";
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
  emotes: {
    title: "Allow Nanoterra emotes",
    on: "On: players can play Nanoterra's emotes (Wave, Dance, Sit and more) from the Emotes wheel, and see the other players' emotes.",
    off: "Off: the game shows no Nanoterra emote. The game's own emotes, if it has any, stay on the wheel.",
  },
  freePlay: {
    title: "Free play",
    on: "On: players can play without paying. Nanoterra's listing says “Free to play”.",
    off: "Off: there is no free play. A player must pay in your game to play, and Nanoterra's listing says “Paid”. Your game asks for the payment: this switch only says so. Your paid game, its prices and its risk are yours.",
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
/** Under the free play switch: the word is part of the listing file, as the sign-in word is, so Nanoterra's review decides what Nanoterra shows. */
export const FREE_PLAY_NOTE = "Your choice is saved here at once. Free play is part of your listing file too, and Nanoterra's review decides what Nanoterra's listing says for a game that is listed.";

/** The state of a switch from the settings, and the patch that a press sends (the other state). */
export const stateOf = (id: SwitchId, s: GameSettings): boolean =>
  id === "character" ? s.character === "nanoterra" : id === "emotes" ? (s.emotes ?? DEFAULT_EMOTES) === "on" : id === "freePlay" ? freePlayOn(s) : signinOn(s.signin);
export function pressOf(id: SwitchId, s: GameSettings): GamePatch {
  if (id === "character") return { character: s.character === "nanoterra" ? "own" : "nanoterra" };
  if (id === "emotes") return { emotes: stateOf("emotes", s) ? "off" : "on" };
  if (id === "freePlay") return { freePlay: freePlayOn(s) ? "off" : "on" };
  return { signin: signinOn(s.signin) ? "none" : "exchange" };
}
