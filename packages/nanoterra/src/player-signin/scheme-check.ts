// The check of a passkey scheme's shape, with no package: the browser sheet and the server both use it (./scheme.ts says what a scheme is).

import type { PasskeyScheme } from "@nano133/signin/passkey";

/** Throws with plain words when a scheme cannot be one: three texts of 1 to 200 characters, and a version byte from 1 to 255. */
export function checkScheme(scheme: PasskeyScheme): PasskeyScheme {
  if (!scheme || typeof scheme !== "object") throw new Error("pass the game's frozen passkey scheme: { input, salt, info, versionByte }");
  for (const k of ["input", "salt", "info"] as const) {
    const v = scheme[k];
    if (typeof v !== "string" || !v.trim() || v.length > 200) throw new Error(`the scheme's ${k} must be a text of 1 to 200 characters`);
  }
  if (!Number.isInteger(scheme.versionByte) || scheme.versionByte < 1 || scheme.versionByte > 255) throw new Error("the scheme's versionByte must be a whole number from 1 to 255");
  return scheme;
}
