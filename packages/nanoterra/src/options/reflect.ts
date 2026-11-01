// Settings the page's CSS needs too: `reflectOptions(store, ["reducedMotion"])` keeps `data-n133-opt-reduced-motion="true" | "false"` on the page's <html>,
// so a stylesheet can calm every animation of the game's own HUD:
//
//   html[data-n133-opt-reduced-motion="true"] .my-hud * { animation: none !important; transition: none !important; }
//
// Echo Island set a class on its root for its "Less motion" (2026-11-01); this is the kit's one way. The attribute's name is "data-n133-opt-" and the key in
// kebab case ("emotes.show" gives data-n133-opt-emotes-show); its value is the setting's value as text.

import type { OptionsStore } from "./core.js";

/** The attribute that holds a key's value: "reducedMotion" gives "data-n133-opt-reduced-motion". */
export const optionAttribute = (key: string): string => `data-n133-opt-${key.replace(/\./g, "-").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Keeps each key's value on `target` (default: the page's <html>) as it changes. Returns the call that stops and takes the attributes off. */
export function reflectOptions(store: OptionsStore, keys: readonly string[], target: Element | null = globalThis.document?.documentElement ?? null): () => void {
  if (!target) return () => {};
  for (const k of keys) {
    store.get(k); // an unknown key throws here, at once
    target.setAttribute(optionAttribute(k), String(store.get(k)));
  }
  const off = store.subscribe((k, v) => {
    if (keys.includes(k)) target.setAttribute(optionAttribute(k), String(v));
  });
  return () => {
    off();
    for (const k of keys) target.removeAttribute(optionAttribute(k));
  };
}
