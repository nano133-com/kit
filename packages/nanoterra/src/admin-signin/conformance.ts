// The conformance suite of the admin sign-in's store: a game that writes its own store (another database) runs it, and so proves that its store keeps
// every rule the package's adapters keep. The package runs it on the memory store, D1 (on SQLite) and Firestore (a fake).
//
//   import { adminSigninStoreConformance } from "@nano133/nanoterra/admin-signin/conformance";
//   for (const c of adminSigninStoreConformance(async () => ({ store: myStore(), dump: () => allMyRowsAsText() }))) it(c.name, c.run);
//
// Each case gets a NEW, empty store from `make`. The rules: a request is finished once and delivered once, and a delivery writes its session in the same
// step; the two wallet apps stay apart; a session lasts until its time; "Sign out everywhere" ends every session and every request not delivered; the
// sign-in list keeps three things for 30 days; and (since 0.12.0) the owner's passkeys: a link is written once, at most 10 for an owner even when many come
// at once, a removal ends the passkey's sessions, and a used signature counts once. (The whole chain, with the player's sign-in beside it, is `adminSigninConformance` in
// "@nano133/nanoterra/admin/conformance".)

import type { AdminSessionRecord, AdminSigninStore, SigninRequest } from "./types.js";
import { ADMIN_LOGIN_KEEP_MS, ADMIN_PASSKEY_LIMIT } from "./types.js";

export type AdminSigninHarness = {
  store: AdminSigninStore;
  /** Every row the store keeps (requests, sessions, the sign-in list) as one text. */
  dump(): Promise<string>;
};

export type AdminSigninConformanceCase = { name: string; run: () => Promise<void> };

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

/** An address the suite can find in any text (a store does not check addresses: the handler does). */
const who = (n: string) => `nano_3${n}${"x".repeat(59 - n.length)}`;
const OWNER = who("own");
const hex = (n: number, len = 64) => n.toString(16).padStart(len, "0");

let serial = 0;
/** A request as a wallet's start makes it: a fresh id each time. */
function request(at: number, extra: Partial<SigninRequest> = {}): { key: string; r: SigninRequest } {
  serial += 1;
  const id = hex(Date.now() * 1000 + serial, 32).slice(-32);
  return { key: id, r: { id, starter: hex(serial + 7), status: "waiting", expiresAt: at + 2 * 60_000, nonce: hex(serial + 99), issuedAt: at, ...extra } };
}
const session = (at: number, n: number, via = "wallet"): AdminSessionRecord => ({ idHash: hex(1_000_000 + n + serial++), address: OWNER, createdAt: at, expiresAt: at + 86_400_000, via });

export type AdminSigninConformanceOptions = {
  /**
   * The owner's passkeys (the store's optional passkey methods). true: the cases run and the store must have them. false: no passkey case. Not set: the
   * cases are listed, and a store with no `linkPasskey` passes them with nothing to check (a store written for 0.11.0).
   */
  passkeys?: boolean;
};

type PasskeyStore = Required<AdminSigninStore>;

export function adminSigninStoreConformance(make: () => Promise<AdminSigninHarness>, options: AdminSigninConformanceOptions = {}): AdminSigninConformanceCase[] {
  const cases: AdminSigninConformanceCase[] = [];
  const add = (name: string, run: (h: AdminSigninHarness, now: number) => Promise<void>) => cases.push({ name, run: async () => run(await make(), Date.now()) });
  /** A passkey case: it runs only on a store with the passkey methods (required with `passkeys: true`). */
  const addPasskey = (name: string, run: (store: PasskeyStore, now: number, h: AdminSigninHarness) => Promise<void>) => {
    if (options.passkeys === false) return;
    add(`passkeys: ${name}`, async (h, now) => {
      const has = ["createSession", "linkPasskey", "unlinkPasskey", "passkeys", "linked", "useOnce"].every((m) => typeof (h.store as unknown as Record<string, unknown>)[m] === "function");
      if (!has) {
        check(options.passkeys !== true, "the store has no passkey methods (createSession, linkPasskey, unlinkPasskey, passkeys, linked, useOnce)");
        return;
      }
      await run(h.store as PasskeyStore, now, h);
    });
  };

  add("a request reads back as it was made, by its key and by its browser id, and only for its own wallet app", async ({ store }, now) => {
    const { key, r } = request(now, { label: "ADMIN of game.test sign-in ABCD-EFGH from US" });
    await store.requests("nautilus").create(key, r);
    const back = await store.requests("nautilus").get(key);
    check(back !== null && back.id === r.id && back.starter === r.starter && back.status === "waiting" && back.expiresAt === r.expiresAt && back.label === r.label && back.nonce === r.nonce && back.issuedAt === r.issuedAt && back.account === undefined, `read back: ${JSON.stringify(back)}`);
    const found = await store.requests("nautilus").find(r.id);
    check(found?.key === key && found.request.id === r.id, `find: ${JSON.stringify(found)}`);
    check((await store.requests("berry").get(key)) === null, "Berry Wallet does not see a Nautilus request");
    check((await store.requests("berry").find(r.id)) === null, "Berry Wallet does not find a Nautilus request");
    check((await store.requests("nautilus").get(hex(12345, 32))) === null, "an unknown key is null");
  });

  add("NanChat's request (when the game turns NanChat on) is kept under the hash of its nonce and found by the browser's id, for NanChat only", async ({ store }, now) => {
    const { r } = request(now);
    const key = hex(424242);
    await store.requests("nanchat").create(key, { ...r, id: "AbCdEfGhIjKlMnOpQrStUvWx" });
    check((await store.requests("nanchat").find("AbCdEfGhIjKlMnOpQrStUvWx"))?.key === key, "found by the browser's id");
    check((await store.requests("berry").find("AbCdEfGhIjKlMnOpQrStUvWx")) === null, "Berry Wallet does not find a NanChat request");
  });

  add("a second request with the same key is refused", async ({ store }, now) => {
    const { key, r } = request(now);
    await store.requests("berry").create(key, r);
    let threw = false;
    try {
      await store.requests("berry").create(key, { ...r, starter: hex(1) });
    } catch {
      threw = true;
    }
    check(threw, "the second create throws");
    check((await store.requests("berry").get(key))?.starter === r.starter, "the first request is unchanged");
  });

  add("finish signs a waiting request in once, with its account; a second finish, one on an unknown key, or one by the other wallet app is false", async ({ store }, now) => {
    const { key, r } = request(now);
    await store.requests("berry").create(key, r);
    check(await store.requests("berry").finish(key, OWNER), "the first finish");
    check(!(await store.requests("berry").finish(key, who("bob"))), "a second finish is false");
    const back = await store.requests("berry").get(key);
    check(back?.status === "signedin" && back.account === OWNER, `the account stays the first: ${JSON.stringify(back)}`);
    check(!(await store.requests("berry").finish(hex(777, 32), OWNER)), "an unknown key");
    check(!(await store.requests("nautilus").finish(key, OWNER)), "the other wallet app cannot finish it");
  });

  add("two finishes at the same moment: exactly one is true", async ({ store }, now) => {
    const { key, r } = request(now);
    await store.requests("berry").create(key, r);
    const both = await Promise.all([store.requests("berry").finish(key, OWNER), store.requests("berry").finish(key, who("bob"))]);
    check(both.filter(Boolean).length === 1, `results: ${JSON.stringify(both)}`);
  });

  add("deliver: false while waiting; then once, with its session; a second delivery writes no session", async ({ store }, now) => {
    const { key, r } = request(now);
    await store.requests("berry").create(key, r);
    const early = session(now, 1);
    check(!(await store.deliver("berry", key, early)), "a waiting request is not delivered");
    check((await store.session(early.idHash, now)) === null, "and no session was written");
    await store.requests("berry").finish(key, OWNER);
    const s1 = session(now, 2);
    check(await store.deliver("berry", key, s1), "the first delivery");
    const read = await store.session(s1.idHash, now);
    check(read?.address === OWNER && read.via === "wallet" && read.expiresAt === s1.expiresAt && read.createdAt === s1.createdAt && read.idHash === s1.idHash, `the session: ${JSON.stringify(read)}`);
    const s2 = session(now, 3);
    check(!(await store.deliver("berry", key, s2)), "a second delivery is false");
    check((await store.session(s2.idHash, now)) === null, "and wrote no session");
    check(!(await store.deliver("nautilus", key, session(now, 4))), "the other wallet app cannot deliver it");
    check(!(await store.deliver("berry", hex(888, 32), session(now, 5))), "an unknown key");
  });

  add("two deliveries at the same moment: one is true, and one session is written", async ({ store, dump }, now) => {
    const { key, r } = request(now);
    await store.requests("nautilus").create(key, r);
    await store.requests("nautilus").finish(key, OWNER);
    const a = session(now, 10);
    const b = session(now, 11);
    const both = await Promise.all([store.deliver("nautilus", key, a), store.deliver("nautilus", key, b)]);
    check(both.filter(Boolean).length === 1, `results: ${JSON.stringify(both)}`);
    const live = [await store.session(a.idHash, now), await store.session(b.idHash, now)].filter(Boolean);
    check(live.length === 1, `sessions written: ${live.length} (${(await dump()).slice(0, 300)})`);
  });

  add("a session reads while it lasts and not from its end, with the word it was written with; ending it removes it", async ({ store }, now) => {
    for (const [i, via] of ["wallet", "ticket"].entries()) {
      const { key, r } = request(now);
      await store.requests("berry").create(key, r);
      await store.requests("berry").finish(key, OWNER);
      const s = session(now, 20 + i, via);
      await store.deliver("berry", key, s);
      const read = await store.session(s.idHash, now);
      check(read?.address === OWNER && read.via === via, `read: ${JSON.stringify(read)} (a store returns the word it holds; the sign-in reads anything but "wallet" and "nanoterra" as "unknown")`);
      check((await store.session(s.idHash, s.expiresAt)) === null, "not at its end");
      check((await store.session(s.idHash, s.expiresAt + 1)) === null, "not after it");
      await store.endSession(s.idHash);
      check((await store.session(s.idHash, now)) === null, "ended");
      await store.endSession(s.idHash);
    }
    check((await store.session(hex(999), now)) === null, "an unknown hash");
  });

  add("Sign out everywhere ends every admin session and says how many; a signed request that was not delivered, and a waiting one, make no login after it", async ({ store }, now) => {
    const made: AdminSessionRecord[] = [];
    for (let i = 0; i < 3; i++) {
      const { key, r } = request(now);
      await store.requests("berry").create(key, r);
      await store.requests("berry").finish(key, OWNER);
      const s = session(now, 30 + i);
      await store.deliver("berry", key, s);
      made.push(s);
    }
    const signed = request(now);
    await store.requests("nautilus").create(signed.key, signed.r);
    await store.requests("nautilus").finish(signed.key, OWNER);
    const waiting = request(now);
    await store.requests("berry").create(waiting.key, waiting.r);
    check((await store.signOutEverywhere()) === 3, "three sessions went");
    for (const s of made) check((await store.session(s.idHash, now)) === null, "a session is left");
    check(!(await store.deliver("nautilus", signed.key, session(now, 40))), "a signed request that was not delivered makes a login after Sign out everywhere");
    const w = await store.requests("berry").get(waiting.key);
    check(w === null || w.expiresAt <= now, `a waiting request must have ended (its time over), so a wallet's answer is refused: ${JSON.stringify(w)}`);
    // Even if a wallet's answer were taken, the request is not delivered again.
    await store.requests("berry").finish(waiting.key, OWNER);
    check(!(await store.deliver("berry", waiting.key, session(now, 41))), "a request that was waiting at Sign out everywhere makes a login afterwards");
    check((await store.signOutEverywhere()) === 0, "a second call ends nothing and says 0");
  });

  add("the sign-in list: newest first, at most the limit, only the time, the country and the browser; a row older than 30 days goes when the next is written", async ({ store, dump }, now) => {
    check((await store.recentLogins(10)).length === 0, "a new store lists no sign-ins");
    await store.recordLogin({ at: now - ADMIN_LOGIN_KEEP_MS - 60_000, country: "FR", browser: "Old" });
    await store.recordLogin({ at: now - ADMIN_LOGIN_KEEP_MS + 86_400_000, country: "FR", browser: "Kept" });
    for (let i = 0; i < 12; i++) await store.recordLogin({ at: now - 1000 * (12 - i), country: i % 3 === 0 ? null : "US", browser: `Chrome on macOS ${i}` });
    const got = await store.recentLogins(10);
    check(got.length === 10, `expected 10 sign-ins, got ${got.length}`);
    check(got.every((l, i, all) => i === 0 || all[i - 1].at >= l.at), "the sign-ins are not newest first");
    check(got[0].at === now - 1000 && got[0].browser === "Chrome on macOS 11" && got[0].country === "US", `the first must be the newest: ${JSON.stringify(got[0])}`);
    check(got.some((l) => l.country === null), "a sign-in with no country keeps null");
    check(got.every((l) => Object.keys(l).sort().join() === "at,browser,country"), `a sign-in must carry only at, browser and country: ${JSON.stringify(got[0])}`);
    check((await store.recentLogins(3)).length === 3, "the limit must hold");
    check((await store.recentLogins(0)).length === 0, "a limit of 0 lists none");
    const all = await store.recentLogins(50);
    check(all.length === 13 && all.some((l) => l.browser === "Kept") && !all.some((l) => l.browser === "Old"), `the row of 31 days went, the row of 29 days stayed: ${all.map((l) => l.browser).join(", ")}`);
    check(!(await dump()).includes("Old"), "the old row is gone from the store");
  });

  add("clean deletes requests 2 hours after they ended, ended sessions and sign-in rows past 30 days, and keeps the rest", async ({ store }, now) => {
    const sessions: AdminSessionRecord[] = [];
    for (const [i, at] of [now - 2 * 86_400_000, now].entries()) {
      const { key, r } = request(at);
      await store.requests("berry").create(key, r);
      await store.requests("berry").finish(key, OWNER);
      const s = session(at, 50 + i);
      await store.deliver("berry", key, s);
      sessions.push(s);
    }
    const old = request(now - 3 * 3_600_000);
    const fresh = request(now);
    await store.requests("berry").create(old.key, old.r);
    await store.requests("berry").create(fresh.key, fresh.r);
    await store.recordLogin({ at: now - ADMIN_LOGIN_KEEP_MS + 60_000, country: null, browser: "Edge on Windows" });
    await store.clean(now + 120_000);
    check((await store.session(sessions[1].idHash, now)) !== null, "the live session stays");
    check((await store.session(sessions[0].idHash, now - 2 * 86_400_000)) === null, "the ended session went");
    check((await store.requests("berry").get(old.key)) === null, "the old request went");
    check((await store.requests("berry").get(fresh.key)) !== null, "the fresh request stays");
    check((await store.recentLogins(10)).length === 0, "the sign-in row past 30 days went");
  });

  addPasskey("a link is written once and read back exactly, oldest first, for its owner only", async (store, now) => {
    const a = who("pka");
    const b = who("pkb");
    check((await store.passkeys(OWNER)).length === 0, "a new store lists no passkey");
    check(!(await store.linked(OWNER, a)), "nothing is linked yet");
    check((await store.linkPasskey(OWNER, a, now - 1000)) === "linked", "the first link");
    check((await store.linkPasskey(OWNER, b, now)) === "linked", "a second passkey");
    check((await store.linkPasskey(OWNER, a, now + 5)) === "exists", "the same passkey again is 'exists'");
    const list = await store.passkeys(OWNER);
    check(list.length === 2 && list[0].address === a && list[0].createdAt === now - 1000 && list[1].address === b, `the list: ${JSON.stringify(list)}`);
    check(list.every((p) => Object.keys(p).sort().join() === "address,createdAt"), `a passkey carries only address and createdAt: ${JSON.stringify(list[0])}`);
    check(await store.linked(OWNER, a), "linked");
    check(!(await store.linked(who("oth"), a)), "another owner has no link to it");
    check(!(await store.linked(OWNER.toUpperCase(), a)) && !(await store.linked(OWNER, a.toUpperCase())) && !(await store.linked(` ${OWNER}`, a)), "only the exact texts are linked");
    check((await store.passkeys(who("oth"))).length === 0, "another owner lists none");
  });

  addPasskey(`at most ${ADMIN_PASSKEY_LIMIT} for an owner, even when many links come at once; another owner has its own ${ADMIN_PASSKEY_LIMIT}`, async (store, now) => {
    const many = Array.from({ length: ADMIN_PASSKEY_LIMIT + 4 }, (_, i) => who(`m${i}`));
    const got = await Promise.all(many.map((a, i) => store.linkPasskey(OWNER, a, now + i)));
    check(got.filter((r) => r === "linked").length === ADMIN_PASSKEY_LIMIT && got.filter((r) => r === "full").length === 4, `results: ${JSON.stringify(got)}`);
    check((await store.passkeys(OWNER)).length === ADMIN_PASSKEY_LIMIT, "the list holds the limit");
    check((await store.linkPasskey(OWNER, who("late"), now)) === "full", "full");
    const linked = (await store.passkeys(OWNER))[0].address;
    check((await store.linkPasskey(OWNER, linked, now)) === "exists", "a passkey that is there is 'exists', not 'full'");
    check((await store.linkPasskey(who("oth"), who("late"), now)) === "linked", "another owner is not full");
    check(await store.unlinkPasskey(OWNER, linked), "a removal");
    check((await store.linkPasskey(OWNER, who("late"), now)) === "linked", "a removal makes room for one");
  });

  addPasskey("a removal ends the link and every admin session of that passkey, and nothing else", async (store, now) => {
    const a = who("rma");
    const b = who("rmb");
    await store.linkPasskey(OWNER, a, now);
    await store.linkPasskey(OWNER, b, now);
    const sa = { ...session(now, 60, "passkey"), address: a };
    const sb = { ...session(now, 61, "passkey"), address: b };
    const owner = session(now, 62, "wallet");
    for (const s of [sa, sb, owner]) await store.createSession(s);
    const read = await store.session(sa.idHash, now);
    check(read?.address === a && read.via === "passkey" && read.createdAt === now && read.expiresAt === sa.expiresAt, `a passkey session reads back: ${JSON.stringify(read)}`);
    check(await store.unlinkPasskey(OWNER, a), "the removal says it removed one");
    check(!(await store.unlinkPasskey(OWNER, a)), "a second removal says false");
    check(!(await store.linked(OWNER, a)) && (await store.linked(OWNER, b)), "only that link went");
    check((await store.session(sa.idHash, now)) === null, "the passkey's session ended with its link");
    check((await store.session(sb.idHash, now)) !== null && (await store.session(owner.idHash, now)) !== null, "the other passkey's session and the wallet's session stay");
    let threw = false;
    try {
      await store.createSession(sb);
    } catch {
      threw = true;
    }
    check(threw, "a second session with the same hash is refused");
    check((await store.signOutEverywhere()) === 2, "Sign out everywhere ends the passkey sessions too");
    check((await store.session(sb.idHash, now)) === null, "and the passkey's session is gone");
    check(await store.linked(OWNER, b), "Sign out everywhere keeps the links (a removal ends one)");
  });

  addPasskey("a used signature counts once, even twice at the same moment; after its time, or after clean, it may be used again", async (store) => {
    const k = hex(31337);
    check(await store.useOnce(k, 60_000), "the first use");
    check(!(await store.useOnce(k, 60_000)), "the second use is refused");
    const k2 = hex(31338);
    const both = await Promise.all([store.useOnce(k2, 60_000), store.useOnce(k2, 60_000)]);
    check(both.filter(Boolean).length === 1, `two at once: ${JSON.stringify(both)}`);
    const k3 = hex(31339);
    check(await store.useOnce(k3, 1), "a short one");
    await new Promise((r) => setTimeout(r, 15));
    check(await store.useOnce(k3, 60_000), "past its time it may be used again");
    await store.clean(Date.now() + 120_000);
    check(await store.useOnce(k, 60_000), "clean dropped the used row past its time");
  });

  return cases;
}
