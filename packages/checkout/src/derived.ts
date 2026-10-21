import { randomBytes } from "node:crypto";
import { DEFAULT_SEED_LABEL, DERIVED_INDEX_CAP, DEFAULT_KEEP_MS, DEFAULT_ADDRESS_LIST_MAX, cleanQuote, deriveAddress, derivedSigner, sameAccount, checkLabel, checkSecret, nano, type DerivedSigner } from "./derivedKeys.js";
import type { Checkout, DerivedStore, Rpc } from "./types.js";

export { DERIVED_INDEX_CAP, DEFAULT_SEED_LABEL, CLEAN_STEP_RAW, DEFAULT_KEEP_MS, DEFAULT_ADDRESS_LIST_MAX, sameAccount, cleanQuote, isCleanQuote, deriveAddress, stateBlockHash, derivedSigner, type DerivedSigner } from "./derivedKeys.js";
export * from "./sweep.js";

// Derived-address mode: see derivedKeys.ts for the idea. This file makes the checkouts and the Late Payment Return pieces;
// sweep.ts moves the money on.

/** What every derived-address function needs: where the checkouts live, and the secret the addresses come from. */
export type DerivedOptions = {
  /** Calls your Nano node. Use your own node: its answers decide what you credit. */
  rpc: Rpc;
  /** memoryStore() (tests) or firestoreStore(...), or your own DerivedStore. */
  store: DerivedStore;
  /** The secret the addresses come from: 32 random bytes in hex, from your secret manager. Never log it. At least 32 characters. */
  secret: string;
  /** Turns the secret into the Nano seed. Default DEFAULT_SEED_LABEL. Never change it after the first checkout. */
  label?: string;
  /** The current time, ms (tests). */
  now?: () => number;
};

/**
 * Creates a checkout with its OWN address: a clean quote (`price` rounded up to a whole 0.0001 XNO, no tail, no amount
 * lock), the next index from the store's counter, the address that index gives, and the window (`ttlMs`, default 15
 * minutes) and grace (`graceMs`, default 1 hour). `keepMs` (default 7 days) is how long Late Payment Return keeps
 * watching the address after the grace. Throws, and takes no index, for a price below 0.0001 XNO.
 *
 * Pay-check it with `claimCheckout`: the stored address and the exact stored quote, first seen in the window, confirmed.
 */
export async function createDerivedCheckout(
  o: DerivedOptions,
  p: { item: string; price: bigint; ttlMs?: number; graceMs?: number; keepMs?: number; meta?: Record<string, unknown> },
): Promise<Checkout> {
  const quote = cleanQuote(p.price);
  checkSecret(o.secret);
  const label = o.label ?? DEFAULT_SEED_LABEL;
  checkLabel(label);
  const now = o.now?.() ?? Date.now();
  const ttl = p.ttlMs ?? 15 * 60_000;
  const graceMs = p.graceMs ?? 60 * 60_000;
  // An index is given to one caller, ever. A checkout that fails to save wastes its index; that is harmless.
  const index = await o.store.takeIndex(DERIVED_INDEX_CAP);
  const { address } = deriveAddress(o.secret, index, label);
  const checkout: Checkout = {
    id: randomBytes(12).toString("hex"),
    item: p.item,
    amount: quote.toString(),
    to: address,
    status: "waiting",
    createdAt: now,
    expiresAt: now + ttl,
    graceMs,
    index,
    scanUntil: now + ttl + graceMs + (p.keepMs ?? DEFAULT_KEEP_MS),
    ...(p.meta ? { meta: p.meta } : {}),
  };
  if (!(await o.store.createDerived(checkout))) throw new Error(`index ${index} already has a checkout: the store's counter was reset, or this id exists`);
  return checkout;
}

/**
 * The three pieces of Late Payment Return's options (`@nano133/late-returns` 0.4.0) for derived addresses, so a payment of
 * ANY other amount (a rounded one, a short one, an over one, a second one, a late one) goes back in full, from its own address:
 *
 *   runLateReturns({ rpc, store, signer, ...derivedReturns({ store: checkoutStore, secret }), never: [...] })
 *
 * - `addresses`: the addresses of the checkouts that Late Payment Return still watches (`scanUntil`), newest first.
 * - `signerFor(address)`: a signer for that address, made from the checkout's own index and checked: the index must give
 *   exactly that address, or the answer is null (that return waits).
 * - `isClaimable({ amount, to })`: true only for the EXACT quote of a waiting checkout at its own address, inside its window
 *   and grace. Any other payment is not claimable. For payments to your own other wallets, add your own rule:
 *   `isClaimable: async (p) => (await derived.isClaimable(p)) || mine(p)`.
 */
export function derivedReturns(o: { store: DerivedStore; secret: string; label?: string; now?: () => number; max?: number }) {
  checkSecret(o.secret);
  const label = o.label ?? DEFAULT_SEED_LABEL;
  checkLabel(label);
  const now = () => o.now?.() ?? Date.now();
  const signers = new Map<string, DerivedSigner>();
  return {
    addresses: () => o.store.derivedAddresses(now(), o.max ?? DEFAULT_ADDRESS_LIST_MAX),
    async signerFor(address: string): Promise<DerivedSigner | null> {
      const known = signers.get(nano(address));
      if (known) return known;
      const c = await o.store.byAddress(address);
      if (!c || !Number.isInteger(c.index)) return null;
      const made = derivedSigner(o.secret, c.index!, label);
      // The record's index must give exactly this address, or nothing is signed for it.
      if (!sameAccount(made.address, address)) return null;
      signers.set(nano(address), made);
      return made;
    },
    async isClaimable(p: { amount: string; to: string }): Promise<boolean> {
      const c = await o.store.byAddress(p.to);
      return !!c && c.status === "waiting" && c.amount === p.amount && c.expiresAt + c.graceMs > now();
    },
  };
}
