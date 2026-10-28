// Calls to the game's own server. Cookies stay on this site; nothing goes to another server.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type Api = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
};

/** The calls of the admin: `base` is where the routes are ("/api/admin"), `send` is `fetch` (a test gives its own). */
export function createApi(base: string, send: typeof fetch = (...a) => fetch(...a)): Api {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await send(`${base}${path}`, { credentials: "same-origin", ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      const v: unknown = text ? JSON.parse(text) : {};
      if (v && typeof v === "object") body = v as Record<string, unknown>;
    } catch {
      body = {};
    }
    if (!res.ok) throw new ApiError(res.status, typeof body.error === "string" ? body.error : `The server answered ${res.status}. Try again.`, body);
    return body as T;
  }
  return {
    get: (path) => call(path),
    post: (path, body = {}) => call(path, { method: "POST", body: JSON.stringify(body) }),
  };
}
