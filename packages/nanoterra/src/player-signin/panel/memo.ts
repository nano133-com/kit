// What this browser remembers of the player's sign-in, in localStorage (no secret, no address): the ids of the passkeys it made or used (so the device
// refuses a second passkey here, and "Use my passkey" is the main key on the next visit), the ids made here and never opened (their first open is a
// NEW account: the spare key shows then), and the way chosen last. A browser that refuses storage remembers nothing, and nothing depends on it.

import type { Way } from "../types.js";

export type SigninMemo = { ids: string[]; unopened: string[]; last: Way | "passkey" | null };

const KEY = (rpId: string) => `n133.player-signin.v1:${rpId}`;
const isId = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{8,700}$/.test(x);
const LAST = new Set(["passkey", "berry", "nanchat", "nautilus"]);

export function readMemo(rpId: string): SigninMemo {
  try {
    const m = JSON.parse(globalThis.localStorage?.getItem(KEY(rpId)) ?? "null") as Partial<SigninMemo> | null;
    const ids = Array.isArray(m?.ids) ? m.ids.filter(isId).slice(-8) : [];
    const unopened = Array.isArray(m?.unopened) ? m.unopened.filter((x) => isId(x) && ids.includes(x)) : [];
    const last = typeof m?.last === "string" && LAST.has(m.last) ? (m.last as SigninMemo["last"]) : null;
    return { ids, unopened, last };
  } catch {
    return { ids: [], unopened: [], last: null };
  }
}

function write(rpId: string, m: SigninMemo): void {
  try {
    globalThis.localStorage?.setItem(KEY(rpId), JSON.stringify(m));
  } catch {
    // Storage refused (a private window): nothing is remembered.
  }
}

/** A passkey was just MADE and not used yet: remember it at once (a closed sheet or a reload between the two steps must not forget it). */
export function rememberMade(rpId: string, id: string): void {
  const m = readMemo(rpId);
  write(rpId, { ...m, ids: [...m.ids.filter((x) => x !== id), id].slice(-8), unopened: [...m.unopened.filter((x) => x !== id), id] });
}

/** A passkey signed the player in. Returns true when it was made here and never opened before: a new account. */
export function rememberOpened(rpId: string, id: string): boolean {
  const m = readMemo(rpId);
  const fresh = m.unopened.includes(id);
  write(rpId, { ids: [...m.ids.filter((x) => x !== id), id].slice(-8), unopened: m.unopened.filter((x) => x !== id), last: "passkey" });
  return fresh;
}

export function rememberLast(rpId: string, last: Way | "passkey"): void {
  write(rpId, { ...readMemo(rpId), last });
}
