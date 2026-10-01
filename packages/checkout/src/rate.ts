// The XNO/USD rate: the median of the public feeds that answer, so one bad feed can't move it.

type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ json(): Promise<unknown> }>;

const SOURCES: { name: string; url: string; read: (j: any) => unknown }[] = [
  { name: "coingecko", url: "https://api.coingecko.com/api/v3/simple/price?ids=nano&vs_currencies=usd", read: (j) => j?.nano?.usd },
  { name: "kraken", url: "https://api.kraken.com/0/public/Ticker?pair=NANOUSD", read: (j) => (Object.values(j?.result ?? {})[0] as any)?.c?.[0] },
  { name: "kucoin", url: "https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=XNO-USDT", read: (j) => j?.data?.price },
];

/** Outside this range a rate is a feed error, not a market move. */
const SANE = { min: 0.05, max: 100 };

/**
 * Dollars per XNO, or null when no feed gives a believable rate. Cache it
 * yourself (a few minutes), and keep the last good rate for when all feeds fail.
 */
export async function xnoUsdRate(fetchFn: Fetch = globalThis.fetch as unknown as Fetch): Promise<{ usd: number; sources: string[] } | null> {
  const results = await Promise.allSettled(SOURCES.map(async (s) => Number(s.read(await (await fetchFn(s.url, { signal: AbortSignal.timeout(6000) })).json()))));
  const good = results
    .map((r, i) => ({ name: SOURCES[i].name, v: r.status === "fulfilled" ? r.value : NaN }))
    .filter((x) => Number.isFinite(x.v) && x.v >= SANE.min && x.v <= SANE.max)
    .sort((a, b) => a.v - b.v);
  if (!good.length) return null;
  return { usd: good[Math.floor(good.length / 2)].v, sources: good.map((g) => g.name) };
}
