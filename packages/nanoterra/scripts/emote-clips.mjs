// Writes src/emotes/clips.ts from nano133.com's clips.json (app/island/character/emotes/clips.json, made in Blender by
// scripts/blender/emotes/build.py there). Only the ten emotes go in: the teleport's own clips (limp, sink, land) stay on the site.
// The numbers are not changed. Run it from packages/nanoterra after the site builds new clips:
//
//   node scripts/emote-clips.mjs <path to the site's clips.json>
import { readFileSync, writeFileSync } from "node:fs";

const EMOTE_CLIPS = ["cheer", "clap", "dance", "bow", "shrug", "laugh", "point", "sit", "facepalm", "spin"];
const from = process.argv[2];
if (!from) throw new Error("usage: node scripts/emote-clips.mjs <clips.json>");
const raw = JSON.parse(readFileSync(from, "utf8"));
if (raw.v !== 1 || raw.fps !== 30) throw new Error(`clips.json is v${raw.v} at ${raw.fps} fps; this script reads v1 at 30`);
const clips = {};
for (const id of EMOTE_CLIPS) {
  if (!raw.clips[id]) throw new Error(`clips.json has no clip "${id}"`);
  clips[id] = raw.clips[id];
}
const data = JSON.stringify({ v: raw.v, fps: raw.fps, bones: raw.bones, clips });
const out = new URL("../src/emotes/clips.ts", import.meta.url);
writeFileSync(
  out,
  `// The ten emote clips, made in Blender on the character's own skeleton (nano133.com: scripts/blender/emotes/build.py, which reads the skeleton
// from this package). Written by scripts/emote-clips.mjs from the site's clips.json: do not edit by hand. This module is loaded only by a dynamic
// import() (./clip.ts loadEmotes), so a bundler puts it in a chunk of its own, out of the game's first load.
import type { RawClips } from "./clip.js";

const CLIPS: RawClips = ${data};
export default CLIPS;
`,
);
console.log(`wrote ${out.pathname}: ${Object.keys(clips).length} clips, ${data.length} bytes of data`);
