// Small helpers for the handler. Web APIs only (they run in Workers, Firebase Functions and Node).

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers },
  });
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response => json({ error, ...extra }, status, headers);

/**
 * True when the browser says the request comes from this game's own pages. A call that changes something must pass this, so another site
 * cannot make the owner's browser do it. The browser sets Origin on a POST; a request with no Origin must say Sec-Fetch-Site: same-origin.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (origin !== null) return origin === new URL(req.url).origin;
  return req.headers.get("Sec-Fetch-Site") === "same-origin";
}

/**
 * True when the browser says a request did NOT come from this game's own pages: an Origin that is not the game's (any value, "null" too), or Sec-Fetch-Site "cross-site" or
 * "same-site" (a sibling subdomain is same-site and has the game's cookies). A request with neither header (a command-line tool; a browser's own address bar says "none") is not foreign.
 * The admin API is called only by its own page, so a read that is foreign is refused too: whatever CORS headers the game's router might add, the answer is not for another page.
 */
export function foreignOrigin(req: Request): boolean {
  const origin = req.headers.get("Origin");
  if (origin !== null && origin !== new URL(req.url).origin) return true;
  const site = req.headers.get("Sec-Fetch-Site");
  return site === "cross-site" || site === "same-site";
}

/** The text of a body of at most `max` bytes, or null when it is bigger. It stops reading at the limit: a body with no length cannot fill the memory. */
export async function readLimited(req: Request, max: number): Promise<string | null> {
  const declared = req.headers.get("Content-Length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** A fixed-window limiter in memory. True while `key` has made at most `limit` calls in this window. Each copy of a server counts for itself. */
export function memoryLimiter(): (key: string, limit: number, windowMs: number, now: number) => boolean {
  const hits = new Map<string, { count: number; until: number }>();
  return (key, limit, windowMs, now) => {
    const hit = hits.get(key);
    if (!hit || hit.until <= now) {
      if (hits.size > 1000) for (const [k, v] of hits) if (v.until <= now) hits.delete(k);
      hits.set(key, { count: 1, until: now + windowMs });
      return true;
    }
    hit.count += 1;
    return hit.count <= limit;
  };
}
