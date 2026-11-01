// The game's passkey SCHEME: the texts that turn a passkey's secret (its PRF output) into the player's Nano account. It is the game's own, and it is
// FROZEN: a player's looks belong to the address these exact texts give.
//
//   PRF input = UTF-8 scheme.input
//   seed      = HKDF-SHA-256(ikm = the PRF output, salt = UTF-8 scheme.salt, info = UTF-8 scheme.info, 32 bytes)
//   account   = the seed as 64 hex characters, account 0
//
// Write it one time, in one file of the game, and test it with fixed vectors (`schemeVector`): a PRF output, its seed, its address. A change of one
// character gives every player another account (and so no looks). A new scheme is a new `versionByte` with new texts, never an edit. The kit offers
// no default on purpose: a default in a library could change under the game.

import { seedFromPrf, type PasskeyScheme } from "@nano133/signin/passkey";
import { purseAddress } from "@nano133/signin/purse";
import { checkScheme } from "./scheme-check.js";

export type { PasskeyScheme };
export { checkScheme };

const bytesOf = (prfHex: string) => {
  if (!/^[0-9a-fA-F]{64}$/.test(prfHex)) throw new Error("a PRF output is 64 hex characters (32 bytes)");
  return Uint8Array.from(prfHex.match(/../g)!.map((b) => parseInt(b, 16)));
};

/**
 * One fixed vector of a scheme: the seed and the address that a PRF output gives. For the game's own test, which must never change:
 *
 *   assert.deepEqual(await schemeVector(SCHEME, "0102…1f20"), { seed: "A3D5…", address: "nano_14kj…" });
 */
export async function schemeVector(scheme: PasskeyScheme, prfHex: string): Promise<{ seed: string; address: string }> {
  const seed = await seedFromPrf(bytesOf(prfHex), checkScheme(scheme));
  return { seed, address: purseAddress(seed) };
}
