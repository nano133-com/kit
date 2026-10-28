// The admin guard: who may open a game's /admin. ONE pure function: no cookie, no database, no clock of its own. The game reads its own admin
// session and passes it in; the answer is "yes" or a refusal with a status and a reason.
//
// DO NOT LOOSEN THIS. It is the game starter's `adminGuard` (src/worker/admin.ts), with the same five checks in the same order, and it may only
// refuse MORE than the starter does, never less (a test runs both over a grid of inputs and proves it). Deny by default: anything this function
// does not understand is a refusal, and a fault inside it is a refusal too.

/** An admin login a game has found for this request: the address that signed, when the login was made (ms), and how it was made. */
export type AdminSession = {
  address: string;
  createdAt: number;
  /** "wallet" is a signature made with the address's key. Anything else (a sign-in from Nanoterra names an address but proves no key) never opens /admin. */
  via: string;
};

export type AdminAccessInput = {
  /** The game's own address, in the form "nano_" and 60 characters, lowercase. A host passes null when none is set (or the example address is). */
  owner: string | null | undefined;
  /** The admin login of this request, or null when there is none. It must be the ADMIN login: a login made for the game's players is not one. */
  session: AdminSession | null | undefined;
  /** The time now, in ms. */
  now: number;
  /** How old an admin login may be, in ms. At most one day: a bigger number is cut to one day, never allowed. */
  maxAgeMs?: number;
};

/** Why a visitor was refused: the status to send and a word a page can act on. */
export type AdminRefusal = {
  ok: false;
  status: 401 | 403;
  error: string;
  /** "no_address": the game has no real owner address yet. "nanoterra": a Nanoterra sign-in names an address but proves no key. "other_address": a wallet that is not the owner's. "misconfigured": the host passed a value the guard cannot trust. */
  reason?: "no_address" | "nanoterra" | "other_address" | "misconfigured";
  /** For "other_address": the address that is signed in (the page says "you are signed in as ..."). */
  signedInAs?: string;
};
export type AdminAccess = { ok: true } | AdminRefusal;

/** An admin login counts for one day; then the owner signs in again. */
export const ADMIN_SESSION_MS = 24 * 60 * 60_000;
/** A login made in the future by this much or more is not believed (clocks of two servers differ by seconds, not by minutes). */
export const CLOCK_SKEW_MS = 5 * 60_000;

/** A Nano address as a page writes it: "nano_", then 60 characters of the Nano alphabet, the first one a 1 or a 3. The guard checks the shape; the host checks the checksum when it reads its setting. */
export const OWNER_PATTERN = /^nano_[13][13-9a-km-uw-z]{59}$/;

const refuse = (status: 401 | 403, error: string, extra: Partial<AdminRefusal> = {}): AdminRefusal => ({ ok: false, status, error, ...extra });
const misconfigured = (): AdminRefusal => refuse(403, "The admin page is not set up correctly. Nobody can open it until it is.", { reason: "misconfigured" });

/** `ok: true` only when the request may read and change the admin data. */
export function adminAccess(input: AdminAccessInput): AdminAccess {
  try {
    return decide(input);
  } catch {
    // A getter that throws, a Proxy, anything odd: no.
    return misconfigured();
  }
}

function decide(input: AdminAccessInput): AdminAccess {
  const { owner, session, now, maxAgeMs } = input;
  if (typeof now !== "number" || !Number.isFinite(now)) return misconfigured();
  let max = ADMIN_SESSION_MS;
  if (maxAgeMs !== undefined) {
    // A limit the host set must be a real, positive number. A wrong one is a refusal, not the default: the host meant something shorter.
    if (typeof maxAgeMs !== "number" || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return misconfigured();
    max = Math.min(maxAgeMs, ADMIN_SESSION_MS);
  }

  // 1. The game has a real owner address.
  if (typeof owner !== "string" || !OWNER_PATTERN.test(owner)) {
    return refuse(403, "Set the game's own Nano address first. Only that address can open this page.", { reason: "no_address" });
  }
  // 2. There is an admin login.
  if (!session || typeof session !== "object") return refuse(401, "Sign in with your Nano address.");
  const { address, createdAt, via } = session;
  if (typeof address !== "string" || typeof via !== "string" || typeof createdAt !== "number") return refuse(401, "Sign in with your Nano address.");
  // 3. It was made with a wallet signature. A sign-in from Nanoterra names an address but proves no key.
  if (via !== "wallet") return refuse(403, "Sign in with your Nano wallet to open this page.", { reason: "nanoterra" });
  // 4. It is the owner's address (the same text, no other form).
  if (address !== owner) return refuse(403, "Only the game's own address can open this page.", { reason: "other_address", signedInAs: address });
  // 5. It is not older than the limit (one day at most), and not from the future.
  const age = now - createdAt;
  if (!(age >= -CLOCK_SKEW_MS && age <= max)) return refuse(401, "Sign in again: an admin sign-in counts for one day.");
  return { ok: true };
}
