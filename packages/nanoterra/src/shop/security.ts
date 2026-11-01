// The shop's needs in a game's Content Security Policy, as LISTS that a game merges into its own policy. Never a whole file: the game keeps every
// source it has (its own frames, its own scripts), and adds these.
//
//   import { SHOP_CSP, mergeCsp } from "@nano133/nanoterra/shop";
//   const policy = mergeCsp(MY_CSP, SHOP_CSP);
//
// The pay sheet draws its QR code on a canvas (no picture from another site), and the wallet key is a plain "nano:" link (a CSP does not limit links).
// Only Turnstile (the person check, when the game turns it on) needs another origin: its script and its frame.

/** Turnstile (Cloudflare's free check that a visitor is a person) loads from here. */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** The sources the shop adds, by directive. */
export const SHOP_CSP: Readonly<Record<string, readonly string[]>> = {
  "script-src": [TURNSTILE_ORIGIN],
  "frame-src": [TURNSTILE_ORIGIN],
  "connect-src": ["'self'"],
};

/**
 * A policy with more sources: `policy` is a CSP text ("default-src 'none'; script-src 'self'") or a map of directives to sources, and each of `more` adds
 * its sources to the same directive (a directive that is not there yet is added). A source is never written twice. The order of the policy is kept.
 * A directive that has 'none' and gets a source loses the 'none' (the two cannot stand together).
 */
export function mergeCsp(policy: string | Readonly<Record<string, readonly string[]>>, ...more: Readonly<Record<string, readonly string[]>>[]): string {
  const map = new Map<string, string[]>();
  const add = (directive: string, sources: readonly string[]) => {
    const name = directive.trim().toLowerCase();
    if (!/^[a-z-]+$/.test(name)) throw new Error(`not a CSP directive: ${directive}`);
    const list = map.get(name) ?? [];
    for (const s of sources) {
      if (!s || /[;,\s]/.test(s)) throw new Error(`not a CSP source: ${s}`);
      if (!list.includes(s)) list.push(s);
    }
    map.set(name, list);
  };
  if (typeof policy === "string") {
    for (const part of policy.split(";")) {
      const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
      if (name) add(name, sources);
    }
  } else for (const [k, v] of Object.entries(policy)) add(k, v);
  for (const m of more) for (const [k, v] of Object.entries(m)) add(k, v);
  return [...map]
    .map(([name, sources]) => {
      const list = sources.length > 1 ? sources.filter((s) => s !== "'none'") : sources;
      return list.length ? `${name} ${list.join(" ")}` : name;
    })
    .join("; ");
}
