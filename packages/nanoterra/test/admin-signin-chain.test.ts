// The kit's two contracts run against the package's own parts, as a game made of them would run them: `adminSigninConformance` (the code that MAKES the
// logins: the player's sign-in and the admin's, side by side) with Berry Wallet, Nautilus and (turned on) NanChat, and `adminConformance` (the whole admin
// chain: the admin cookie, createAdminSignin's session, the guard, the routes) with createAdminHandler. Each on the memory store and on D1 (SQLite).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { ADMIN_SESSION_MS, createAdminHandler } from "../src/admin/index.js";
import { adminConformance, adminSigninConformance, type ConformanceHost, type SigninHost, type Who } from "../src/admin/conformance.js";
import { adminKey, type MemoryAdminSignin } from "../src/admin-signin/index.js";
import { Browser, ORIGIN, OWNER, STRANGER, makeGame, nextIp, noSqlite, type Kind } from "./admin-signin-helpers.js";

const KINDS: Kind[] = noSqlite ? ["memory"] : ["memory", "d1"];
const START = { admin: "/api/admin-signin/start", game: "/api/signin/start" } as const;
const CHECK = { admin: "/api/admin-signin/check", game: "/api/signin/check" } as const;

/** The game's own sign-in chain for the contract: `way` started for the game or for the admin, signed by the owner, finished by a browser. */
function signinHost(kind: Kind, way: "berry" | "nautilus" | "nanchat"): SigninHost {
  const g = makeGame(kind, { admin: { nanchat: way === "nanchat" } });
  type Handle = { browser: Browser; start: Record<string, any>; scope: "game" | "admin" };
  return {
    async start(scope) {
      const browser = new Browser();
      const s = await g.call(browser, START[scope], { way });
      assert.equal(s.status, 200, JSON.stringify(s.body));
      return { browser, start: s.body!, scope } satisfies Handle;
    },
    async sign(h) {
      const out = await g.answer(way, (h as Handle).start);
      // A refusal is a fault of the test, never a pass.
      if (!g.accepted(way, out)) throw new Error(`the wallet's signature was refused: ${out.status} ${JSON.stringify(out.body)}`);
    },
    async finish(h, as, credentials) {
      const { browser, start, scope } = h as Handle;
      const b = new Browser();
      if (credentials !== "other") b.jar = new Map(browser.jar);
      if (credentials === "retyped") {
        // The browser that started it, presenting its starter as the OTHER scope would read it: copied to the other scope's cookie name, and (for an admin
        // request finished as the game) with the admin's hashing prefix in front, the value that the player's plain hashing would turn into the stored admin hash.
        if (scope === "admin" && as === "game") b.jar.set("starter", `admin:${browser.jar.get("starter-admin")}`);
        if (scope === "game" && as === "admin") b.jar.set("starter-admin", browser.jar.get("starter")!);
      }
      await g.call(b, CHECK[as], { id: start.id, way });
      return { admin: b.jar.has("admin"), game: b.jar.has("session") };
    },
    async signOutEverywhere() {
      const admin = await g.adminLogin(way);
      assert.equal((await g.call(admin, "/api/admin/signout-all", {})).status, 200);
    },
    async advance(ms) {
      g.clock.now += ms;
    },
  };
}

for (const kind of KINDS) {
  for (const way of ["berry", "nautilus", "nanchat"] as const) {
    for (const c of adminSigninConformance(signinHost(kind, way), { signOutEverywhere: true, advance: true })) test(`[${kind}, ${way}${way === "nanchat" ? " on" : ""}] ${c.name}`, c.run);
  }
}

/** A passkey's address that the owner linked. */
const LINKED = `nano_3${"pk".repeat(29)}p`;

/**
 * The admin chain for `adminConformance`: every kind of visitor the suite names, made from the package's own sessions. `passkeys`: the game has the owner's
 * passkeys on, and the owner's logins of the suite are a LINKED passkey's (the owner, an expired login, a signed-out one, one older than a day): the
 * whole chain treats them as it treats wallet logins. (A passkey nobody linked gives no session at all, so 401: ./admin-signin-passkey.test.ts.)
 */
function adminHost(kind: Kind, passkeys = false): ConformanceHost {
  const g = makeGame(kind, { admin: { passkeys } });
  const ownerVia = passkeys ? "passkey" : "wallet";
  const ownerAddress = passkeys ? LINKED : OWNER.address;
  if (passkeys) void g.adminStore.linkPasskey!(OWNER.address, LINKED, g.clock.now);
  const noOwner = createAdminHandler({ store: g.store, defaults: { character: "nanoterra", signin: "exchange" }, owner: null, session: (req, at) => g.admin.session(req, at), now: () => g.clock.now, limit: () => true });
  /** An admin session written as the sign-in writes one (the hash of "admin:" and the token), with the times and the word the suite needs. */
  async function adminSession(address: string, createdAt: number, expiresAt: number, via: string): Promise<string> {
    const token = randomBytes(32).toString("hex");
    const idHash = await adminKey(token);
    if (g.db) g.db.prepare("INSERT INTO sessions (id_hash, address, created_at, expires_at, via, scope) VALUES (?, ?, ?, ?, ?, 'admin')").run(idHash, address, createdAt, expiresAt, via);
    else (g.adminStore as MemoryAdminSignin).sessionRows.set(idHash, { idHash, address, createdAt, expiresAt, via });
    return token;
  }
  const signOut = async (cookie: string) => {
    const res = await g.route(new Request(`${ORIGIN}/api/admin-signin/signout`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie, "CF-Connecting-IP": nextIp() } }));
    assert.equal(res.status, 200);
  };
  async function make(who: Who): Promise<string | null> {
    const now = g.clock.now;
    switch (who) {
      case "signed_out":
        return null;
      case "game_login":
      case "game_token_as_admin": {
        // A login made for the game's PLAYERS (the owner's own address): the player sign-in's session.
        const header = await g.player.signIn(new Request(`${ORIGIN}/`), OWNER.address, "wallet");
        const token = /session=([0-9a-f]{64})/.exec(header)![1];
        return who === "game_login" ? `session=${token}` : `admin=${token}`;
      }
      case "nanoterra_login":
        return `admin=${await adminSession(OWNER.address, now, now + ADMIN_SESSION_MS, "nanoterra")}`;
      case "unknown_via_login":
        return `admin=${await adminSession(OWNER.address, now, now + ADMIN_SESSION_MS, "ticket")}`;
      case "other_wallet":
        return `admin=${await adminSession(STRANGER.address, now, now + ADMIN_SESSION_MS, "wallet")}`;
      case "expired_login":
        return `admin=${await adminSession(ownerAddress, now - 3_600_000, now - 1000, ownerVia)}`;
      case "old_valid_row":
        return `admin=${await adminSession(ownerAddress, now - ADMIN_SESSION_MS - 60_000, now + ADMIN_SESSION_MS, ownerVia)}`;
      case "signed_out_login": {
        const cookie = `admin=${await adminSession(ownerAddress, now, now + ADMIN_SESSION_MS, ownerVia)}`;
        await signOut(cookie);
        return cookie;
      }
      case "no_address":
      case "owner":
        return `admin=${await adminSession(ownerAddress, now, now + ADMIN_SESSION_MS, ownerVia)}`;
    }
  }
  const last = new Map<Who, string>();
  return {
    routes: g.handler.routes,
    basePath: g.handler.basePath,
    origin: ORIGIN,
    async endLogin(who) {
      const cookie = last.get(who);
      if (cookie) await signOut(cookie);
    },
    async request(who, req) {
      let cookie: string | null;
      if (req.again && last.has(who)) cookie = last.get(who)!;
      else {
        cookie = await make(who);
        if (cookie) last.set(who, cookie);
      }
      const headers = new Headers({ "CF-Connecting-IP": nextIp(), ...req.headers });
      let path = req.path;
      if (cookie && req.tokenAt && (who === "game_login" || who === "game_token_as_admin")) {
        const token = cookie.slice(cookie.indexOf("=") + 1);
        if (req.tokenAt === "bearer") headers.set("Authorization", `Bearer ${token}`);
        else if (req.tokenAt === "header") headers.set("X-Auth-Token", token);
        else path += `${path.includes("?") ? "&" : "?"}token=${token}&t=${token}&access_token=${token}`;
      } else if (cookie) headers.set("Cookie", cookie);
      const request = new Request(`${ORIGIN}${path}`, { method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body });
      if (who === "no_address") return (await noOwner.handle(request)) ?? new Response("not found", { status: 404 });
      return g.route(request);
    },
  };
}

for (const kind of KINDS) {
  const cases = adminConformance(adminHost(kind));
  for (const c of cases) test(`[${kind}] admin conformance with createAdminSignin's session: ${c.name}`, { timeout: c.timeoutMs }, c.run);
  // The same contract with the owner's passkeys on, and the owner's logins made by a linked passkey: it holds unchanged.
  const withPasskeys = adminConformance(adminHost(kind, true));
  for (const c of withPasskeys) test(`[${kind}, passkeys] admin conformance with a linked passkey's sessions: ${c.name}`, { timeout: c.timeoutMs }, c.run);
}
