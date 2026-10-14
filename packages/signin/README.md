# @nano133/signin

Stage: Alpha. What this means: https://nano133.com/stages

Sign in with Nano (XNO). No payment, no password and no email: every way is a
signature from a key the person holds, and your server checks it strictly.
Your server holds no key. nano133.com runs this package for its own sign-in.

| Way | Who signs | Entry points |
|---|---|---|
| **Passkey purse** | A Nano account made from the person's passkey (Face ID, Touch ID, a PIN), in the browser | `/passkey`, `/purse` (browser), `checkSignatureSignin` |
| **A key in the page** | Any wallet in the page that signs a message | `/purse` (browser), `checkSignatureSignin` |
| **Nautilus** | The Nautilus app, by its `nanoauth:` request | `startNautilus`, `answerNautilus`, `checkNautilus` |
| **NanChat** | The NanChat app, by its `nanauth` request | `startNanchat`, `answerNanchat`, `checkNanchat` |

Nautilus publishes no guide for its request: the format here was read in the
app's source. NanChat's is on its developer page. Both have worked with the
real apps on nano133.com.

## A passkey purse (browser)

```ts
import { firstUse, makePasskey, openPasskey, type PasskeyScheme } from "@nano133/signin/passkey";
import { signinBody } from "@nano133/signin/purse";

// FROZEN: a person's account lies at the address these texts give. Never edit; test with fixed vectors.
const SCHEME: PasskeyScheme = { input: "example.com purse v1", salt: "example.com", info: "example.com purse seed v1", versionByte: 1 };
const setup = { rpId: "example.com", rpName: "Example", scheme: SCHEME, exclude: madeHere() };

const made = await makePasskey(setup);          // remember made.credentialId now
const { seed } = await firstUse(setup, made);   // the seed comes from a use, never from the answer at create
// later visits: const { seed } = await openPasskey(setup);
// show the seed as a spare key before any XNO goes in: a lost passkey is a lost purse
await fetch("/signin/signature", { method: "POST", body: JSON.stringify(signinBody("example.com", seed)) });
```

- A passkey belongs to one domain, so each site gets its own account for a person.
- It needs the passkey PRF extension: `passkeySupport()` says "yes", "no" or "unknown".
- Errors are `PasskeyError` with a `code`; the words are yours.

## The signature route (server)

```ts
import { checkSignatureSignin } from "@nano133/signin";
import { firestoreOnce } from "@nano133/signin/firestore";

// POST /signin/signature  { address, at, signature }   (rate-limited per visitor: required)
const account = await checkSignatureSignin({ domain: "example.com", useOnce: firestoreOnce(db, "signin_once") }, body);
createYourSession(account);
```

The message names your domain, is valid for 5 minutes either way, and counts
once (by the hash of the signed message, not the signature, which can have two
forms). Small-order keys (the burn address) and an address with a wrong
checksum are refused.

## Nautilus and NanChat (server)

```ts
import { answerNanchat, answerNautilus, checkNanchat, checkNautilus, nanchatReply, nautilusReply, startNanchat, startNautilus, WalletRefused } from "@nano133/signin";
import { firestoreRequests } from "@nano133/signin/firestore";

const nautilus = { site: "example.com", siteAddress: SITE_ADDRESS, store: firestoreRequests(db, "signin_nautilus") };
const nanchat = { host: "example.com", store: firestoreRequests(db, "signin_nanchat") };

// start (rate-limited): set the starter cookie, pass its sha256
const n = await startNautilus(nautilus, { starter, answerUrl: (id) => `https://example.com/signin/nautilus?id=${id}` });
const c = await startNanchat(nanchat, { starter, answerUrl: "https://example.com/signin/nanchat" });

// the apps post here (no Origin check); always HTTP 200
try { await answerNautilus(nautilus, id, body); reply(nautilusReply("example.com")); }
catch (e) { if (e instanceof WalletRefused) reply(nautilusReply("example.com", e.message)); else throw e; }

// the browser asks every 2 seconds
const r = await checkNautilus(nautilus, id, starter);
if (r.status === "signedin" && r.mine) createYourSession(r.account!);
```

- Only the browser that started a request is signed in by it (`mine`).
- NanChat's answers all come from its relay: limit them by total and per nonce
  (`nanchatNonce`), not per IP address. NanChat shows your reply's text
  whatever it says: `nanchatReply` starts a refusal with "NOT signed in".
- A wallet app's request can be sent to someone else: do not take such a
  sign-in as proof for an action that cannot be undone.

## Sessions

- At sign-in, create a new session id, and show "Signed in as nano_…"
  (required).
- Refuse a sign-in call that another site sent (login CSRF): check that
  `Origin` is exactly your site, except on the two routes the apps post to.
- Firestore rows carry `deleteAt`: set a TTL policy on each collection. Every
  row names its account, for a "delete my data".

## Test

```sh
npm test
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm test
```

The spec for AI coding tools: [`ai/SPEC.md`](ai/SPEC.md).

MIT. From [nano133.com](https://nano133.com).
