import { defineRules } from "./rules.js";
import type { StoreOptions } from "./types.js";

export function storeConfig(options: StoreOptions) {
  const versions = new Map(options.rules.map((r) => [r.version, defineRules(r)]));
  if (versions.size !== options.rules.length) throw new Error("rules versions must be unique");
  return { rules: (version: string) => versions.get(version), now: options.now ?? Date.now };
}

export function serverTime(now: number): number {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000) throw new Error("invalid server time");
  return now;
}
