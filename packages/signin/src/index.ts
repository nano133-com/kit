import { randomBytes, randomInt } from "node:crypto";
import { checkPayment } from "@nano133/checkout";
import type { CheckResult, Rpc, SigninConfig, SigninSession, SigninStore } from "./types.js";

export * from "./types.js";
export { signinMessage } from "./message.js";

// Sign in with Nano, by payment.
//
// The visitor sends a tiny, unique amount (by default 0.00000133nnnn XNO) from
// any wallet to the site's sign-in address. When it confirms, the browser that
// started the sign-in is signed in as the sending account. The amount can go
// straight back (use @nano133/late-returns: record a return for it).
//
// Rules (from nano133.com):
// - an amount names one sign-in at a time; it stays reserved until the
//   sign-in's grace plus a margin are over;
// - a sign-in only takes a payment the node first saw after it began, and
//   looks past an older one of the same amount;
// - it stops taking payments when its grace is over;
// - taking a payment and marking the sign-in done is one atomic step, which
//   also checks that the sign-in was still waiting; one payment signs in once;
// - the node is your own; when it doesn't answer, check() throws (fail closed).

export type SigninOptions = { rpc: Rpc; store: SigninStore; config: SigninConfig; now?: () => number; pick?: () => number };

const defaults = (c: SigninConfig) => ({
  address: c.address,
  base: c.base ?? 133n * 10n ** 22n,
  step: c.step ?? 10n ** 18n,
  slots: c.slots ?? 9_999,
  ttlMs: c.ttlMs ?? 15 * 60_000,
  graceMs: c.graceMs ?? 2 * 60_000,
  reuseMarginMs: c.reuseMarginMs ?? 3 * 60_000,
});

/**
 * Throws when the amounts could reach the next "round" amount: every slot
 * must stay below the base's last digit's next value (base 133 × 10^22 and
 * 9,999 × 10^18 stay below 134 × 10^22), so a normal payment of a round
 * amount never matches a slot.
 */
export function checkConfig(config: SigninConfig) {
  const c = defaults(config);
  if (!/^nano_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/.test(c.address)) throw new Error("the sign-in address isn't a nano_ address");
  if (c.base <= 0n || c.step <= 0n || !Number.isInteger(c.slots) || c.slots < 1) throw new Error("base, step and slots must be positive");
  const zeros = (c.base.toString().match(/0*$/)?.[0].length ?? 0);
  const unit = 10n ** BigInt(zeros);
  if (c.step * BigInt(c.slots) >= unit) throw new Error(`the slots reach the next round amount: ${c.slots} × ${c.step} must stay below ${unit}`);
  if (c.reuseMarginMs < 2 * 60_000) throw new Error("reuseMarginMs must be at least 2 minutes (longer than the clock allowance)");
}

/** Starts a sign-in for this browser (`starter`: a hash of your own cookie). Throws when no amount is free. */
export async function startSignin(o: SigninOptions, p: { starter: string }) {
  const c = defaults(o.config);
  checkConfig(o.config);
  const now = o.now?.() ?? Date.now();
  for (let attempt = 0; attempt < 6; attempt++) {
    const slot = o.pick?.() ?? randomInt(1, c.slots + 1);
    const session: SigninSession = {
      id: randomBytes(12).toString("hex"),
      amount: (c.base + BigInt(slot) * c.step).toString(),
      address: c.address,
      status: "waiting",
      starter: p.starter,
      startedAt: now,
      expiresAt: now + c.ttlMs,
      graceMs: c.graceMs,
    };
    if (await o.store.create(session, session.expiresAt + c.graceMs + c.reuseMarginMs)) return session;
  }
  throw Object.assign(new Error("busy, try again"), { status: 503 });
}

/**
 * Checks a sign-in. `hash`: a block the browser saw, or null to search.
 * `starter`: this browser's hash, to tell whether the sign-in is its own.
 */
export async function checkSignin(o: SigninOptions, id: string, hash: string | null, p: { starter: string }): Promise<CheckResult> {
  const now = o.now?.() ?? Date.now();
  const s = await o.store.get(id);
  if (!s) return { state: "unknown" };
  const mine = s.starter === p.starter;
  if (s.status === "signedin") return { state: "signedin", account: s.account!, hash: s.hash!, again: true, mine };
  // Past its grace a sign-in is over: its amount may already belong to a newer one.
  if (now > s.expiresAt + s.graceMs) return { state: "expired" };
  const check = await checkPayment(o.rpc, { hash, to: s.address, amount: s.amount, window: { from: s.startedAt, until: s.expiresAt + s.graceMs } });
  if (check.state === "invalid" || check.state === "wrong") return { state: check.state };
  if (check.state === "unconfirmed") return { state: "pending" };
  if (check.state !== "paid") return { state: now > s.expiresAt ? "expired" : "waiting" };
  const account = check.info.block_account;
  const r = await o.store.claim(s.id, check.hash, account, now);
  if (r === "used") return { state: "used" };
  const done = (await o.store.get(s.id))!;
  if (done.status !== "signedin") return { state: "waiting" };
  return { state: "signedin", account: done.account!, hash: done.hash!, again: r === "taken", mine };
}
