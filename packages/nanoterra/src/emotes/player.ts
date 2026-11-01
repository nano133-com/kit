// "@nano133/nanoterra/emotes/player": Nanoterra's emotes on the kit's character (createCharacter of "@nano133/nanoterra/character"). Three.js, as the
// character is. A clip plays as a layer over the character's pose (../character/layer.ts), so the game calls nothing new each frame: its usual
// `character.update(dt, motion)` plays the emote too, after the walk and before the tail, the wings and the long hair.
//
//   const emotes = createEmotes(hero, { onEmote: (e) => send(emoteMessage(e)) }); // the local player
//   emotes.play("dance");                                                          // from the wheel's onPlay
//   playRemote(other, { id: msg.emote });                                          // another player's emote, from your network
//
// The Wave is the character's own `wave()`; the ten others are clips, which load on the first emote (`loadEmotes`, one chunk of their own).

import type { Character } from "../character/create.js";
import { setPoseLayer } from "../character/layer.js";
import { newRun, startClip, stepClip, stopClip, type ClipRun } from "./clip.js";
import { LOOP_AGAIN_MS, type EmoteEvent, type EmoteStop } from "./events.js";
import { emoteOf, isEmote } from "./list.js";
import { readEmoteOptions, type EmoteOptionsStore } from "./options.js";

export { emoteClip, emotesLoaded, loadEmotes, FADE_END, FADE_IN, FADE_STOP } from "./clip.js";

/** How fast a character must go before a full clip stops (m/s, the pose's eased speed): the island's. */
const MOVING = 0.4;

/** What a character keeps for its emotes: its clip run, the last play it was given (by `at`), and the local player's events. */
type State = {
  run: ClipRun;
  seen: number;
  /** The age of the run when its loop was last sent. */
  sent: number;
  local: EmotesOptions | null;
};
const states = new WeakMap<Character, State>();

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** The character's state, and its layer, made on its first emote. */
function stateOf(character: Character): State {
  let st = states.get(character);
  if (st) return st;
  const s: State = { run: newRun(), seen: Number.NaN, sent: 0, local: null };
  setPoseLayer(character, (bones, f) => {
    const was = s.run.id;
    stepClip(s.run, bones, { dt: f.dt, moving: f.speed > MOVING, air: f.airborne, swim: false, calm: f.reducedMotion });
    if (!s.local) return;
    if (was && !s.run.id && s.run.ended) s.local.onStop?.({ id: was, at: now(), why: s.run.ended });
    else if (s.run.id && emoteOf(s.run.id)?.loop && s.run.stopAge < 0 && s.run.age - s.sent >= LOOP_AGAIN_MS / 1000) {
      // A loop is sent again while it plays, so a player who comes later sees it.
      s.sent = s.run.age;
      s.local.onEmote?.({ id: s.run.id, loop: true, at: now(), again: true });
    }
  });
  states.set(character, s);
  st = s;
  return st;
}

/** Plays a Nanoterra emote on a character: the Wave is its own `wave()`, the others start a clip. False for an id that is not one. */
function start(character: Character, id: unknown, age = 0): id is string {
  if (!isEmote(id)) return false;
  if (id === "wave") {
    character.wave();
    return true;
  }
  const st = stateOf(character);
  startClip(st.run, id, age);
  return true;
}

export type EmotesOptions = {
  /** The player played an emote (and again every 10 s while a loop plays): send `emoteMessage(e)` to the other players. */
  onEmote?: (e: EmoteEvent) => void;
  /** The player's clip ended: its end, a move, the water or `stop`. Nothing to send for a move (the others see it); see the README for `stop`. */
  onStop?: (e: EmoteStop) => void;
};

export type LocalEmotes = {
  /** Plays a Nanoterra emote on the player's character (the wheel's onPlay). False, and nothing happens, for an id that is not one. */
  play(id: string): boolean;
  /** Stops the player's clip, with its fade. A game with water calls it when the character goes in. */
  stop(): void;
  /** The clip on show, or null (the Wave is not a clip: it is never here). */
  readonly playing: string | null;
  /** Stops listening (`onEmote`, `onStop`). The character keeps playing what it plays. */
  destroy(): void;
};

/** The local player's emotes on their character, with the events a multiplayer game sends on. */
export function createEmotes(character: Character, options: EmotesOptions = {}): LocalEmotes {
  const st = stateOf(character);
  st.local = options;
  return {
    play(id) {
      if (!start(character, id)) return false;
      st.sent = 0;
      options.onEmote?.({ id, loop: emoteOf(id)?.loop === true, at: now(), again: false });
      return true;
    },
    stop() {
      stopClip(st.run);
    },
    get playing() {
      return st.run.id;
    },
    destroy() {
      if (st.local === options) st.local = null;
    },
  };
}

/** Another player's emote: its id, and when it came (performance.now(); left out: now). */
export type RemotePlay = { id: unknown; at?: number };

/**
 * Plays another player's emote on their character (from the game's network). An id that is not a Nanoterra emote is ignored (false). The same play
 * given again (the same `at`) is ignored, so a game may pass the last one every frame; a loop that is on show goes on through a repeat. With an
 * options store whose `emotes.others` is off, nothing plays.
 */
export function playRemote(character: Character, play: RemotePlay, opts: { options?: EmoteOptionsStore | null } = {}): boolean {
  if (!play || typeof play !== "object" || !isEmote(play.id)) return false;
  if (!readEmoteOptions(opts.options).others) return false;
  const at = typeof play.at === "number" && Number.isFinite(play.at) ? play.at : now();
  const st = stateOf(character);
  if (st.seen === at) return false;
  st.seen = at;
  return start(character, play.id, (now() - at) / 1000);
}

/** Stops a character's clip with its fade (a remote player's, when the game hears a stop, or any character that goes into water). */
export function stopEmote(character: Character): void {
  const st = states.get(character);
  if (st) stopClip(st.run);
}
