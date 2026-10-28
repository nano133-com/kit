import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_SESSION_MS, CLOCK_SKEW_MS, adminAccess, type AdminAccessInput, type AdminSession } from "../src/admin/index.js";

const OWNER = `nano_1${"a".repeat(59)}`;
const OTHER = `nano_3${"b".repeat(59)}`;
const NOW = 1_800_000_000_000;
const wallet = (over: Partial<AdminSession> = {}): AdminSession => ({ address: OWNER, createdAt: NOW - 1000, via: "wallet", ...over });
const input = (over: Partial<AdminAccessInput> = {}): AdminAccessInput => ({ owner: OWNER, session: wallet(), now: NOW, ...over });

test("the owner's wallet login, made a moment ago, may open the admin", () => {
  assert.deepEqual(adminAccess(input()), { ok: true });
});

test("the five checks, in the starter's order, with the starter's statuses and reasons", () => {
  const r = (i: Partial<AdminAccessInput>) => adminAccess(input(i));
  // 1. no owner address
  for (const owner of [null, undefined, "", "nano_short", OWNER.toUpperCase(), OWNER.replace("nano_", "xrb_"), ` ${OWNER}`, OWNER + "x"]) {
    const got = r({ owner });
    assert.equal(got.ok, false);
    assert.deepEqual(got.ok ? null : [got.status, got.reason], [403, "no_address"], String(owner));
  }
  // The owner check comes before the session check: with no owner and no session the answer is no_address, as in the starter.
  assert.deepEqual(r({ owner: null, session: null }).ok === false && (r({ owner: null, session: null }) as { reason?: string }).reason, "no_address");
  // 2. no session
  for (const session of [null, undefined]) {
    const got = r({ session });
    assert.deepEqual(got.ok ? null : [got.status, got.reason], [401, undefined]);
  }
  // 3. not a wallet login
  for (const via of ["nanoterra", "play", "", "Wallet", "wallet "]) {
    const got = r({ session: wallet({ via }) });
    assert.deepEqual(got.ok ? null : [got.status, got.reason], [403, "nanoterra"], via);
  }
  // 4. another address (the same text only), and it says who is signed in
  for (const address of [OTHER, OWNER.toUpperCase(), ` ${OWNER}`, OWNER.replace("nano_", "xrb_")]) {
    const got = r({ session: wallet({ address }) });
    assert.deepEqual(got.ok ? null : [got.status, got.reason, got.signedInAs], [403, "other_address", address]);
  }
  // 5. too old
  const old = r({ session: wallet({ createdAt: NOW - ADMIN_SESSION_MS - 1 }) });
  assert.deepEqual(old.ok ? null : [old.status, old.reason], [401, undefined]);
  // Order: a Nanoterra login for another address is refused as a Nanoterra login (3 before 4), and a wrong wallet that is also old is refused as the wrong wallet (4 before 5).
  const a = r({ session: wallet({ via: "nanoterra", address: OTHER }) });
  assert.equal(a.ok ? null : a.reason, "nanoterra");
  const b = r({ session: wallet({ address: OTHER, createdAt: NOW - 2 * ADMIN_SESSION_MS }) });
  assert.equal(b.ok ? null : b.reason, "other_address");
});

test("the age limit: one day to the millisecond, a shorter one when the host sets it, never a longer one", () => {
  const at = (age: number, maxAgeMs?: number) => adminAccess(input({ session: wallet({ createdAt: NOW - age }), maxAgeMs })).ok;
  assert.equal(at(ADMIN_SESSION_MS), true);
  assert.equal(at(ADMIN_SESSION_MS + 1), false);
  assert.equal(at(3_600_000, 3_600_000), true);
  assert.equal(at(3_600_001, 3_600_000), false);
  // A longer limit is cut to one day.
  assert.equal(at(ADMIN_SESSION_MS + 1, 7 * ADMIN_SESSION_MS), false);
  assert.equal(at(ADMIN_SESSION_MS, 7 * ADMIN_SESSION_MS), true);
  // A limit that is not a real positive number is a refusal (the host meant something shorter), not the default.
  for (const bad of [Number.NaN, 0, -1, Infinity, "3600000" as unknown as number, null as unknown as number]) {
    const got = adminAccess(input({ maxAgeMs: bad }));
    assert.deepEqual(got.ok ? null : [got.status, got.reason], [403, "misconfigured"], String(bad));
  }
});

test("a login from the future is not believed beyond a small clock difference", () => {
  const at = (createdAt: number) => adminAccess(input({ session: wallet({ createdAt }) })).ok;
  assert.equal(at(NOW + 1000), true);
  assert.equal(at(NOW + CLOCK_SKEW_MS), true);
  assert.equal(at(NOW + CLOCK_SKEW_MS + 1), false);
  assert.equal(at(NOW + 365 * ADMIN_SESSION_MS), false);
});

test("a value that is not what it should be is a refusal, never an allow, and the guard never throws", () => {
  const junk: unknown[] = [Number.NaN, Infinity, -Infinity, undefined, null, "1", "", {}, [], () => 1, Symbol("x"), 10n, true];
  for (const now of junk) {
    const got = adminAccess(input({ now: now as number }));
    assert.equal(got.ok, false, `now=${String(now)}`);
  }
  for (const createdAt of junk) assert.equal(adminAccess(input({ session: wallet({ createdAt: createdAt as number }) })).ok, false, `createdAt=${String(createdAt)}`);
  for (const address of junk) assert.equal(adminAccess(input({ session: wallet({ address: address as string }) })).ok, false, `address=${String(address)}`);
  for (const via of junk) assert.equal(adminAccess(input({ session: wallet({ via: via as string }) })).ok, false, `via=${String(via)}`);
  for (const session of [1, "wallet", true, [], () => 1] as unknown[]) assert.equal(adminAccess(input({ session: session as AdminSession })).ok, false);
  // Objects that throw when read.
  const boom = new Proxy({}, { get() { throw new Error("boom"); } });
  assert.equal(adminAccess(input({ session: boom as unknown as AdminSession })).ok, false);
  assert.equal(adminAccess(boom as unknown as AdminAccessInput).ok, false);
  assert.equal(adminAccess(null as unknown as AdminAccessInput).ok, false);
  assert.equal(adminAccess(undefined as unknown as AdminAccessInput).ok, false);
  // A getter that returns the owner's address the first time and another one later (a check-then-use trick) cannot get in: the guard reads each field once.
  let reads = 0;
  const sly = { get address() { return reads++ === 0 ? OWNER : OTHER; }, createdAt: NOW, via: "wallet" };
  adminAccess(input({ session: sly }));
  assert.ok(reads <= 2);
});

// The starter's adminGuard, as it was (src/worker/admin.ts, with its session already read), for the proof that the package guard refuses everything the
// starter refuses. It is copied here byte for byte in meaning, and `owner` is what the starter's `receiveAddress` gives.
function starterAllows(owner: string | null, session: { address: string; createdAt: number; via: string } | null, now: number): boolean {
  if (!owner) return false;
  if (!session) return false;
  if (session.via !== "wallet") return false;
  if (session.address !== owner) return false;
  if (now - session.createdAt > ADMIN_SESSION_MS) return false;
  return true;
}

test("the package guard allows nothing that the starter's guard refuses (a grid of 10,000+ inputs)", () => {
  const owners = [OWNER, OTHER, null, "", "nano_short", OWNER.toUpperCase(), OWNER.replace("nano_", "xrb_"), `nano_0${"a".repeat(59)}`, `nano_1${"l".repeat(59)}`, `nano_1${"v".repeat(59)}`, `nano_2${"a".repeat(59)}`];
  const addresses = [OWNER, OTHER, OWNER.toUpperCase(), "", "x", ` ${OWNER}`];
  const vias = ["wallet", "nanoterra", "play", "", "WALLET"];
  const ages = [-10 * ADMIN_SESSION_MS, -CLOCK_SKEW_MS - 1, -CLOCK_SKEW_MS, -1, 0, 1, 1000, ADMIN_SESSION_MS - 1, ADMIN_SESSION_MS, ADMIN_SESSION_MS + 1, 10 * ADMIN_SESSION_MS, Number.NaN, Infinity, -Infinity];
  const nows = [NOW, 0, 1, Number.MAX_SAFE_INTEGER, Number.NaN];
  const maxes = [undefined, 1000, ADMIN_SESSION_MS, 5 * ADMIN_SESSION_MS];
  let grid = 0;
  let allowedByPackage = 0;
  for (const owner of owners) for (const address of addresses) for (const via of vias) for (const age of ages) for (const now of nows) for (const maxAgeMs of maxes) {
    for (const session of [{ address, createdAt: now - age, via }, null]) {
      grid++;
      const got = adminAccess({ owner, session, now, maxAgeMs });
      if (got.ok) {
        allowedByPackage++;
        assert.equal(starterAllows(owner, session, now), true, JSON.stringify({ owner, session, now, maxAgeMs }));
      }
    }
  }
  assert.ok(grid > 10_000, `grid ${grid}`);
  assert.ok(allowedByPackage > 0, "the grid has allowed cases, so the proof is not empty");
});
