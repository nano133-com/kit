// "@nano133/nanoterra/character/record": the character's record and nothing that draws. The record is two whole numbers (`packRecord`), each an index
// into a closed list (lists.ts), so a game, a server and a Worker can keep, send and check a player's character without Three.js. This entry and
// every file it reaches import no package at all (a test of the package reads the built files and proves it).
export * from "./lists.js";
export * from "./record.js";
export * from "./edit.js";
export * from "./look.js";
