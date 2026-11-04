// The kept price of XNO as the game's meta table holds it: its own small file, so the shop's D1 store reads it without the admin's summary code.

import type { StoreSummary } from "./store.js";

/** The `rate` row of the meta table: JSON { usd, sources } kept with the time. Anything that is not that is no rate. */
export function parseRate(value: unknown, at: unknown): StoreSummary["rate"] {
  if (typeof value !== "string" || typeof at !== "number") return null;
  try {
    const v: unknown = JSON.parse(value);
    if (!v || typeof v !== "object") return null;
    const { usd, sources } = v as { usd?: unknown; sources?: unknown };
    if (typeof usd !== "number" || !Number.isFinite(usd) || !Array.isArray(sources) || !sources.every((s) => typeof s === "string")) return null;
    return { usd, sources: sources as string[], at };
  } catch {
    return null;
  }
}
