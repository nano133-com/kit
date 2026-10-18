# Sign in with Nano: implementation spec

Follow these steps in order. Each step ends with a check. Stop and ask the
site owner when a step says "ask".

Package: `@nano133/signin` (0.3.0 or later). Every way is a signature, and the
server checks it strictly: no payment, no password, no email, and your server
holds no key. The server part works with any Node.js server and any database
that can insert a row with a unique key and update a row in a transaction.

| Way | Who signs | Browser | Server |
|---|---|---|---|
| Passkey purse | a Nano account made from the person's passkey | `@nano133/signin/passkey`, `@nano133/signin/purse` | `checkSignatureSignin` |
| Any key the browser holds | a wallet in the page that signs a message | `@nano133/signin/purse` (or your own) | `checkSignatureSignin` |
| Nautilus | the Nautilus app (its `nanoauth:` request) | a link or a QR code | `startNautilus`, `answerNautilus`, `checkNautilus` |
| NanChat | the NanChat app (its `nanauth` request) | a link or a QR code | `startNanchat`, `answerNanchat`, `checkNanchat` |
| Berry Wallet | Berry Wallet, or any wallet that reads `nano-signin-v1` | a link or a QR code | `startNanoSignin`, `readNanoSignin`, `answerNanoSignin`, `checkNanoSignin` |

## 0. Decide (ask)

1. Which ways. Each one is optional; the passkey purse needs no wallet app.
2. The site's domain, exactly as users see it ("example.com"). Every message
   names it, so a signature for your site counts nowhere else.
3. For Nautilus: a Nano address of the site's own (`siteAddress`). It is only
   named in the request and in the text the app signs; no key is needed.
4. For the passkey purse: the site's frozen scheme (step 4). Ask the owner to
   approve the texts: they can never change.
5. Where sessions live (your own session code, or your framework's).

## 1. Install

```sh
npm install @nano133/signin
```

## 2. The stores

- **A once-only store** for signatures: `useOnce(key, ttlMs, address)` inserts
  a row with a unique key and the account, and answers false when the row
  exists. Firestore: `firestoreOnce(db, collection)` from
  `@nano133/signin/firestore`. Tests: `memoryOnce()` from
  `@nano133/signin/memory`.
- **A request store** for Nautilus, NanChat and Berry Wallet (`RequestStore`): `create`,
  `get`, `find` (by the browser's id) and `finish` (waiting → signed,
  atomically; false when it was not waiting). Firestore:
  `firestoreRequests(db, collection)`, one collection for each app. Tests:
  `memoryRequests()`.
- Every row names the account that signed: a "delete my data" can find a
  person's rows. Firestore rows carry `deleteAt`: set a TTL policy on it for
  each collection.

**Check:** the same once-only key twice: the second answers false; two
`finish` calls at the same moment: one answers true.

## 3. The starter cookie (Nautilus, NanChat, Berry Wallet)

A wallet app answers on another device, so only the browser that started a
request may be signed in by it. At each start, set an httpOnly, SameSite=Lax
cookie with a random value (30 minutes), and pass `sha256(value)` (hex) as
`starter`. Pass the asking browser's hash to the check functions: sign that
browser in only when the answer has `mine: true`.

## 4. The passkey purse (browser)

A passkey gives the page 32 secret bytes (the PRF extension), and those bytes
become the seed of a Nano account, the purse. Your server takes no part in the
passkey: it checks the purse's signature (step 5).

1. **The scheme, frozen.** Write it in your code one time:
   `{ input: "example.com purse v1", salt: "example.com", info: "example.com
   purse seed v1", versionByte: 1 }`. A change of one character makes another
   account for every person. Write a test with fixed vectors (a PRF output,
   its seed, its address) that must never change. A new scheme is a new
   `versionByte` with new texts, never an edit.
2. **The setup:** `{ rpId: "<your domain>", rpName, scheme, userName,
   exclude }`. Call only on your own domain. `exclude` holds the ids of the
   passkeys this browser made, so a device never makes a second one.
3. **Make:** `makePasskey(setup)`, remember its `credentialId` at once, then
   `firstUse(setup, made)`: the seed always comes from a USE of the passkey.
   If a browser refuses the second prompt without a press, show one button for
   it; on a closed sheet, call `firstUse(setup, made, signal, true)`.
4. **Open later:** `openPasskey(setup)` gives the same seed.
5. **A spare key.** Before any XNO goes into a purse, show its seed for the
   person to write down. A lost passkey is a lost purse.
6. **Sign in:** `signinBody(domain, seed)` from `@nano133/signin/purse` gives
   `{ address, at, signature }`; post it to step 5's route. Keep the seed in
   memory only for as long as you need it.
7. Errors are `PasskeyError` with a `code` ("cancelled", "no-prf", "exists",
   "unstable", …): write your own words for each. `passkeySupport()` says
   whether the browser can try.

**Check:** your vectors pass; a second make on one device answers "exists".

## 5. The signature route

- The browser signs `signinMessage(domain, address, Date.now())` (from
  `@nano133/signin/message`) and posts `{ address, at, signature }`.
- `POST /signin/signature`: `checkSignatureSignin({ domain, useOnce }, body)`
  → create the session for the returned address. Map `SigninError` status to
  the answer. **Required:** rate-limit it per visitor.

**Check:** the same signature twice: the second is refused; a signature for
another domain is refused; one older than 5 minutes is refused.

## 6. Nautilus routes

- `POST /signin/nautilus/start`: `startNautilus({ site, siteAddress, store },
  { starter, answerUrl: (id) => "https://<domain>/signin/nautilus?id=" + id })`
  → `{ id, code, link }`. Show the link as a button (a phone) or a QR code (a
  computer), and the code: "Check that Nautilus shows <site> sign-in <code>".
- `POST /signin/nautilus?id=<id>` (the app posts here; no Origin to check):
  `answerNautilus(options, id, body)`. Reply with HTTP 200 and
  `nautilusReply(site)`, or `nautilusReply(site, error.message)` for a
  `WalletRefused`: Nautilus shows the message only with a 200.
- `POST /signin/nautilus/check { id }`: `checkNautilus(options, id, starter)`,
  every 2 seconds for 5 minutes. Sign in when `status === "signedin" && mine`.
- **Required:** rate-limit start, answer and check. Let the app's POST through
  your firewall. The phone's clock must be within 5 minutes.

**Check:** a signature made as Nautilus signs (Ed25519-BLAKE2b over the
text's bytes, see the package's tests) signs in once; another label, another
site address or an old time is refused.

## 7. NanChat routes

- `POST /signin/nanchat/start`: `startNanchat({ host, store }, { starter,
  answerUrl: "https://<domain>/signin/nanchat" })` → `{ id, link }`. Show the
  link (it opens nanchat.com in a new tab, or the app) or its QR code, and:
  "Only approve a sign-in that you started on <host>."
- `POST /signin/nanchat` (NanChat's relay posts here): `answerNanchat(options,
  body)`. Reply with `nanchatReply(host)` or `nanchatReply(host,
  error.message)`: NanChat shows the text under "Success" whatever it says.
- `POST /signin/nanchat/check { id }`: `checkNanchat(options, id, starter)`.
- **Required:** every answer comes from one relay, so limit the answers in
  total (not per IP address) and per nonce (`nanchatNonce(host, message)`).

**Check:** a signature made as NanChat signs (`tools.sign(key, "Signed
Message: " + text)`) signs in once; a `ban_` account, another host or another
nonce is refused.

## 7b. Berry Wallet routes (`nano-signin-v1`)

- `POST /signin/nano/start`: `startNanoSignin({ domain, uri, store },
  { starter, requestUrl })` with `requestUrl = (id) =>
  "https://<domain>/signin/nano/" + id` → `{ id, link, walletLink,
  expiresAt }`. On a phone, show `link` as "Open Berry Wallet" and
  `walletLink` as "Another wallet". On a computer, show `link` as a QR code.
- `GET /signin/nano/:id` (the wallet reads it; no cookies, no Origin):
  `readNanoSignin(options, id, requestUrl)` → HTTP 200 and the JSON, or 404
  when it is null.
- `POST /signin/nano/:id` (the wallet's signature): `answerNanoSignin(options,
  id, body, requestUrl)`. Reply with HTTP 200 and `nanoSigninReply(id,
  account)`, or HTTP 401 and `nanoSigninRefusal(error.message)` for a
  `WalletRefused`.
- `POST /signin/nano/check { id }`: `checkNanoSignin(options, id, starter)`.
- **Required:** rate-limit the start, the GET, the POST and the check. A
  request lives 5 minutes at most (Berry Wallet refuses more).

**Check:** a signature made as Berry Wallet signs (Ed25519-BLAKE2b over the
SHA-256 of `nanoSigninMessage(request, account)`) signs in once; another text,
another `signatureType`, another `requestId` or an expired request is refused.

## 8. Sessions

When you create a session: give it a new session id (never reuse one from
before the sign-in), and show "Signed in as nano_…" with the account
(required). Refuse a sign-in route call that another site sent (login CSRF):
check that `Origin` is exactly your site, or `Sec-Fetch-Site` is
`same-origin`, except on the routes the apps call. A sign-in from a
wallet app's request (Nautilus, NanChat, Berry Wallet) can be approved by someone who was
sent the link: do not take it as proof for an action that cannot be undone
(deleting an account); ask for a new signature from the browser instead.

## 9. Test

1. `npm test` in the package (Firestore tests with
   `FIRESTORE_EMULATOR_HOST`).
2. A site test with the memory stores and keys made in the test.
3. One real sign-in with each way you offer, on a real device.

## Done when

- [ ] Every route is rate-limited (required); NanChat's answer by total and nonce.
- [ ] Only the browser that started a request is signed in by it (`mine`).
- [ ] A new session id at each sign-in, and "Signed in as nano_…" on screen.
- [ ] The messages use the site's real domain or host.
- [ ] The passkey scheme is frozen in your code, with a vector test.
- [ ] A spare key is offered before any XNO goes into a purse.
- [ ] Every store row names its account, and has a TTL.
- [ ] Keys and secrets are in a secret store, never logged.
