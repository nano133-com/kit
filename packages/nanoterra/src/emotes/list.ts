// Nanoterra's emotes, as nano133.com's Nano Island has them (app/island/character/emotes/list.ts there): the Wave, which is the character's own
// code (createCharacter's `wave`), and ten clips made in Blender (./clips.ts, played by ./clip.ts). This list is all a wheel and a network need: it
// loads no clip. The order is the panel's, and the order of the pictures in icons.webp.

/** How an emote plays: the character's own wave; a clip of the whole body (a move, a jump or the water stops it); or a clip of the spine, the arms and the head (it plays over the walk). */
export type EmoteKind = "wave" | "full" | "upper";

export const EMOTES = [
  { id: "wave", label: "Wave", kind: "wave", loop: false },
  { id: "cheer", label: "Cheer", kind: "full", loop: false },
  { id: "clap", label: "Clap", kind: "upper", loop: false },
  { id: "dance", label: "Dance", kind: "full", loop: true },
  { id: "bow", label: "Bow", kind: "full", loop: false },
  { id: "shrug", label: "Shrug", kind: "upper", loop: false },
  { id: "laugh", label: "Laugh", kind: "full", loop: false },
  { id: "point", label: "Point", kind: "upper", loop: false },
  { id: "sit", label: "Sit", kind: "full", loop: true },
  { id: "facepalm", label: "Facepalm", kind: "upper", loop: false },
  { id: "spin", label: "Spin", kind: "full", loop: false },
] as const satisfies readonly { id: string; label: string; kind: EmoteKind; loop: boolean }[];

/** One of Nanoterra's emotes. */
export type EmoteId = (typeof EMOTES)[number]["id"];
/** A clip's id: every Nanoterra emote but the Wave. */
export type ClipId = Exclude<EmoteId, "wave">;

const IDS = new Set<string>(EMOTES.map((e) => e.id));
export const isEmote = (v: unknown): v is EmoteId => typeof v === "string" && IDS.has(v);
export const isClip = (v: unknown): v is ClipId => isEmote(v) && v !== "wave";
/** A Nanoterra emote by its id, or undefined. */
export const emoteOf = (id: string) => EMOTES.find((e) => e.id === id);
/** True for the emotes that play until a move stops them (Dance; Sit, whose sitting down plays once, then its seated part loops). */
export const isLoop = (id: string): boolean => emoteOf(id)?.loop === true;
