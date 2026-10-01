# @nano133/signin

Sign in with Nano (XNO). No password and no email: owning a Nano account is
the proof. Two ways, often offered together:

| Way | How | Needs |
|---|---|---|
| **By payment** | The visitor sends a tiny unique amount (0.00000133nnnn XNO by default) from any wallet to your sign-in address. | Any wallet with a little XNO |
| **By signature** | The visitor's wallet (for example a browser purse) signs a short message with its key. | A wallet that can sign messages; no XNO |

## By payment

```ts
import { startSignin, checkSignin, checkConfig } from "@nano133/signin";
import { firestoreStore } from "@nano133/signin/firestore";

const options = {
  rpc,                                               // your own node; fail closed
  store: firestoreStore(db, { sessions: "signins", amounts: "signin_amounts", payments: "signin_payments" }),
  config: { address: SIGNIN_ADDRESS },               // a wallet used ONLY for sign-ins
};
checkConfig(options.config);                         // at startup

// POST /signin/start   (rate-limited: 20 per visitor and 600 in all, per 10 minutes)
const s = await startSignin(options, { starter: sha256(starterCookie) });
// → show "send exactly s.amount to s.address" (a QR code with the amount, a wallet link)

// POST /signin/check { id, hash? }   (rate-limited like any payment claim)
const r = await checkSignin(options, id, hash ?? null, { starter: sha256(starterCookie) });
if (r.state === "signedin" && r.mine) createYourSession(r.account);
```

Rules (the same as nano133.com):

- An amount names one sign-in at a time. It stays reserved until the
  sign-in's grace plus a margin are over.
- A sign-in takes only a payment your node first saw after it began; an
  older payment of the same amount, or one that was already waiting, is skipped.
- It stops taking payments when its grace (2 minutes after expiry) is over.
- Taking a payment and marking the sign-in done is one atomic step. One
  payment signs in once.
- Only the browser that started a sign-in gets it (`mine`), and only for 10
  minutes after it signed in.
- When your node doesn't answer, `checkSignin` throws: nobody is signed in.

Defaults, all configurable: 15 minutes to pay, 2 minutes of grace, a 3-minute
margin, base 0.00000133 XNO, step 0.000000000001 XNO, 9,999 slots.
`checkConfig` refuses settings whose amounts could reach the next round
amount, so a normal payment never matches a slot.

**The sign-in address must be used for sign-ins only.** Every send of a
slot's exact amount to it counts as a sign-in payment.

**Exchanges:** a payment from an exchange comes from the exchange's shared
hot wallet. That account signs in, and a refund goes to the exchange, not to
the person. Tell users to pay from their own wallet.

### Sending the amount back

The amount is tiny, and you can keep it. If you keep it, receive the waiting
amounts now and then (any wallet does that): a search reads the newest 1,000
waiting payments.

To send each amount back, give the store a `returns` collection. Each sign-in
then records its return in the same step that signs the visitor in, and a
regular run sends it back exactly once:

```ts
import { firestoreStore as returnStore } from "@nano133/late-returns/firestore";
import { settleSigninRefunds } from "@nano133/signin/refunds";

const store = firestoreStore(db, { sessions: "signins", amounts: "signin_amounts", payments: "signin_payments", returns: "signin_returns" });
const refunds = returnStore(db, { returns: "signin_returns", used: ["signin_payments"], meta: "signin_wallet" });

// every minute or so (a scheduler, or after each sign-in):
await settleSigninRefunds({ rpc, signer, store: refunds });
```

That needs the sign-in wallet's key on your server (a hot wallet: keep it
nearly empty). `settleSigninRefunds` refuses to run while
`FIRESTORE_EMULATOR_HOST` is set, so a test database never moves real money.

### Sessions

- Set the starter cookie (httpOnly, SameSite=Lax, a random value) with a
  short life (30 minutes), and pass its SHA-256 as `starter`.
- At sign-in, create a new session id, and replace the starter cookie.
- Show "Signed in as nano_…" right after sign-in.
- Firestore documents carry `deleteAt`: set a TTL policy on it for each
  collection except the payments.

## By signature

```ts
import { checkSignatureSignin } from "@nano133/signin/signature";
import { signinMessage } from "@nano133/signin/message";   // browser-safe
import { firestoreOnce } from "@nano133/signin/firestore";

// In the browser: sign signinMessage("example.com", address, Date.now()) with the wallet's key.
// On the server:
const account = await checkSignatureSignin(
  { domain: "example.com", useOnce: firestoreOnce(db, "signin_once") },
  { address, at, signature },
);
```

- The message names your domain, so a signature for another site fails.
- It is valid for 5 minutes in both directions, and once only (by the hash
  of the signed message, not the signature, which can have two forms).
- Keys that anyone can forge a signature for (small-order points, such as
  the burn address) are refused.

## Test

```sh
npm test
FIRESTORE_EMULATOR_HOST=localhost:8080 npm test
npm run example
```

MIT. From [nano133.com](https://nano133.com).
