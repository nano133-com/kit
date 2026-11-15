// The D1 counter of fixed windows (`d1Limit`): the game starter's, on its table `hits` (one row a key and window). Moved out of ./d1.ts unchanged so
// that a part with no shop (the connect's "works once" store) reaches no shop code; ./d1.ts imports it back and exports it as before.

/** The one call of D1 that the counter makes (D1's own types fit it). */
export interface D1CounterLike {
  prepare(sql: string): { bind(...values: unknown[]): { first<T = unknown>(): Promise<T | null> } };
}

/** A table name is plain: letters, digits and _ (it is written into the SQL). */
export const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const tableName = (v: string | undefined, fallback: string): string => {
  const name = v ?? fallback;
  if (!NAME.test(name)) throw new Error(`the table name "${name}" must be plain (letters, digits and _)`);
  return name;
};

/**
 * True while `key` has made at most `limit` calls in this fixed window, counted in D1 (the table `hits`: one count for the whole game, every location).
 * The game starter's `d1Limit`. Old windows stay until the game deletes them (the starter's cron deletes those older than a day).
 */
export async function d1Limit(db: D1CounterLike, key: string, limit: number, windowMs: number, now = Date.now(), tables: { hits?: string } = {}): Promise<boolean> {
  const hits = tableName(tables.hits, "hits");
  const win = Math.floor(now / windowMs);
  const row = await db.prepare(`INSERT INTO ${hits} (key, win, count) VALUES (?, ?, 1) ON CONFLICT (key, win) DO UPDATE SET count = count + 1 RETURNING count`).bind(key, win).first<{ count: number }>();
  return Number(row?.count ?? 1) <= limit;
}
