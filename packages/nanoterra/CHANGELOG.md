# Changelog

## Unreleased

- `/admin/panel`: the Legal card shows only for a game with plays (`mountAdmin({ plays })` has one, or the store has a play's orders). A game that sells
  no play sees nothing new in Settings (Echo Island, 2026-11-04).
- `/friends/panel` and `/options/panel`: `--n133-scrim`, one colour for the dim of both panels (the options' dark theme reads `--n133-dark-scrim` first).
  Defaults as before: `rgb(16 24 40 / 0.4)`, and black at 0.4 in the options' dark theme.
- `/emotes/wheel`: the key cap says the key as the Keys settings do (`keyLabel` of `/options`: "↑" for ArrowUp, "Num 1" for Numpad1); `emoteKeyLabel` is now
  that function. `keyLabel: (code) => words` lets a game give its own words. `keyLabel` has its own file, so the wheel still loads no other options code.
- `/emotes/wheel`: the fit to the longest name reads each place's and tile's own padding and edges (it took a 1 px edge), so a game's 3 px tile edge no
  longer cuts the name.
- `/emotes/wheel`: `layerClass` puts a game's class names on the holder of the open wheel (with `layerIn` the wheel's own holder, else the key's holder).
- Sizes (gzip, size test): `/emotes/wheel` 7.1 kB (ceiling 7.2 kB, was 7.0 kB).

## 0.15.0 (2026-11-04)

- **The options panel is one page (Banano's UI pass, 2026-11-03; Wes: the less UI and text, the better).** No Basic and Advanced tabs: the Basic rows come
  first, then one fold row opens the Advanced rows under it. The row says the Advanced rows' group when they are one group (a game whose Advanced rows are
  only its keys shows "Keys"), else "More options" (`MORE_WORDS`). With no Basic row, the Advanced rows are the page. "Reset to defaults" moves from a footer
  pinned to the panel's foot to a small key at the end of the page, and on a phone the sheet is as tall as its rows (at most 85% of the screen), so a short
  page leaves the game in sight. Nothing changes in the store, the defs or the API; `TAB_WORDS` stays exported. A game that styled `.n133o-tabs` or
  `.n133o-tab` can drop those rules.
- **The friends panel has a scrim**, as the options panel has: the game dims under the open panel, and a press on it closes the panel.
- `/emotes/wheel`: the Emotes key has its own theme properties, `--n133e-key-edge`, `--n133e-key-edge-color`, `--n133e-key-radius`, `--n133e-key-shadow`,
  `--n133e-key-font` and `--n133e-key-weight` (defaults: today's look). They are inherited, so a game's value wins whichever stylesheet loads last.
- `/emotes/wheel`: `keyCap: true` shows the wheel's key as a key cap beside the word, the player's own key; no cap on a touch screen with no keyboard.
- `/emotes`: the help line of "Show the Emotes key" names the player's own key ("G still opens the wheel on a keyboard"), not always B (`EMOTE_SHOW_HELP`,
  `emoteKeyLabel`).
- `/emotes/wheel`: the places are 76 px or more and Edit's tiles 78 px or more (were 58 to 70 px), and both grow to the longest name in the game's font (measured
  when the wheel opens; up to 96 px and 92 px, and a place only as far as the wheel fits the screen's short side), so "Facepalm" in a game's 16 px words is whole.
  Checked in Chromium and WebKit on eight screens from 320 x 568 to 1440 x 900: no name cut, the wheel and Edit inside the screen, no two places touching.
- `/emotes/wheel`: `layerIn` (`document.body`) puts the open wheel in another element, so a game's HUD slot with its own `z-index` no longer holds it under the
  game's top bar. The theme's `--n133-*` values are copied from the key's holder when it opens (`EMOTE_THEME_VARS`).
- `/emotes/wheel`: the options' "Less motion" (`reducedMotion`) stops the wheel's pop-in, as the device's setting does (`EmoteSettings.calm`).
- `/emotes/player`: `playing` is `"wave"` for the Wave's 1.8 s (it was always null for the Wave), so a game or a test sees it play. `WAVE_SECONDS` has its own
  file (`character/wave.ts`), so the player loads none of the pose's code.
- `/options`: a `help` line may name a key binding with `{key:<binding>}` (and a fallback, `{key:<binding>|<code>}`); the panel draws it again when the binding
  changes. `helpText` and `helpKeys` give the words for a menu of your own.
- Sizes (gzip, size test): `/emotes/wheel` 6.8 kB (ceiling 7.0 kB, was 6.5 kB), `/emotes/player` 3.1 kB (3.5 kB).
- **Plays: charge for a round (Wes, 2026-11-03 and 2026-11-04).** A play is one thing a player buys and uses ONCE: a round, a level, a life or a continue.
  Pay to play only: a play buys one use of the game, never money or a prize of value, nothing bought is random or changes the odds, and no credit
  converts or moves. A play goes through the same orders, reservation, scan and test mode as a look; only the grant differs (one credit per paid order).
- **`plays.json` and `checkPlays`** (in `@nano133/nanoterra/looks`, and `/shop`): `id`, `name`, `priceUsd`, `use` (`PLAY_USES`: round, level, life,
  continue) and `useWithinDays` (1 to 365, default 30). An unknown field is a mistake; `prize`, `reward`, `odds`, `chance`, `random`, `tickets`,
  `tokens`, `cash` and `bonus` are refused with "a play buys one use of the game, nothing else". A play never takes a look's id. Also `playProblems`.
- **`paidRoundsOn(plays)`** (`/looks` and `/shop`): the listing file's word, `"paidRounds": paidRoundsOn(plays)`, beside `"freePlay"`. A file without it
  sells no paid rounds.
- **The routes** (`createShopHandler({ plays, legal })`, `createShop` passes them): `POST /api/orders { playId }`, `GET /api/plays` (`ready` and `forSale`
  of each play), `POST /api/plays/use { playId, ref }` (200 `{ used, again }`, 402, 409, 400; 60 a minute) and `POST /api/plays/adult`. The handler
  has `use`, `ready` and `refusal` for a game's own round route. A use comes at the round's start; a ref answers "again" for good. At most 5 credits
  of one play ready or waiting for a payment (`MAX_READY_PER_PLAY`).
- **The store contract** adds `credits`, `useCredit`, `adult` and `keepAdult`; `forget` deletes the credits and the yes, and keeps a paid play's payer
  while its credit was unused. Each credit keeps its own end, fixed when it is paid. Memory, D1 and Firestore keep the rules; `shopStoreConformance`
  has the plays' cases (`{ plays: false }` leaves them out).
- **A new migration file, `@nano133/nanoterra/shop/d1-plays.sql`:** the orders' `kind`, `use_days` and `forgot_unused`, the tables `credits` and
  `play_adults`. Apply it before the Worker that sells plays. A game that sells only looks needs none of it.
- **The D1 shop reads the schema** (the orders' `kind` column) to know whether it has the plays, never `plays.json`: a play order paid after the plays
  left the file is still a play. `{ plays: true }` skips the read. The D1 limits keep a salted hash of their keys in `hits` (`limitKey`), never a
  player's id. Firestore: `credits`, `shop_uses` and `play_adults`.
- **A play's order holds its amount as a look's does:** 15 minutes, then an hour after the order ends (`PLAY_LATE_HOLD_MS`, equal to `LATE_HOLD_MS`;
  Wes, 2026-11-04: "15+60 for plays too"). An order nobody pays holds its amount 75 minutes, so a price under about 5¢ can be busy (README, "Plays").
- **The Legal card in /admin** (the Settings tab, after the Game card): "Paid rounds for 18 and up only" (on), "Sell an extra life or a continue" (off),
  the refund rule (14 days and the creator's words, shown before any pay step) and the owner's one confirmation, "You are responsible for the laws where
  you sell." Outside test mode no play is sold until the owner confirms. Five more settings in `SETTING_KEYS`; `loadLegal(store)`, `DEFAULT_LEGAL`,
  `refundText`, `mergeLegal`, `parseLegalKey`. A press may be 2048 bytes (was 512).
- **The age step:** with "18 and up only" on, a play's order answers 403 `needs: "age"` until the player says "I am 18 or older" (kept once). The pay
  sheet shows the step.
- **The panel** (`mountShop({ plays, playsBase, onCredit })`): `buyPlay`, `playKey` ("Play for 5¢", "1 round ready"), `ready`, the refund words before
  any step, and new words in `SHOP_WORDS` (`playFor`, `playReady`, `playTitle`, `playLine`, `playPaid`, `playLate`, `playSignIn`, `ageLine`, `ageYes`,
  `ageNo`), `playPrice` and `useWord`.
- **The admin** (`createAdminHandler({ plays, unmatched })`, `mountAdmin({ plays })`, `createD1Store(db, { plays: true })`): the Cosmetics tab's
  "Looks / Rounds" switch and the plays' draft (text to copy: the admin writes no play); a "Round" mark in Orders; each player's ready rounds; the
  summary's `plays`, `sendBack` and `totals.sendBack`. "To send back" lists late payments, credits not used in time, credits of a play no longer sold
  and the unused credits of deleted players, each with its payer.
- **"Unmatched payments"** (the Overview tab; `POST {base}/unmatched`, 6 a minute; `findUnmatched` in `/shop`, `shop.unmatched` on a Worker): the
  receives on the game's address that no order recorded, from the newest 200 entries since the oldest listed order. It only reads, and a read that
  fails lists nothing. The creator checks each one and sends it back by hand.
- **What a game's own tests see change** (no code of the game must change, but a test that pins these does):
  - `GameState` (the admin's `GET /api/admin/game` and every press's answer) gains `legal` (`LegalState`): a test that builds a GameState by hand
    adds `legal: DEFAULT_LEGAL`.
  - The admin's press body may be 2048 bytes (`ADMIN_LIMITS.gameBodyMax`, was 512): a test that expects a 413 between 513 and 2048 bytes gets 200 or 400.
  - The admin conformance's `snapshot` leaves out ten settings (`SETTING_KEYS`), not five: a game store's own snapshot must leave out the five new
    keys too, `setting:adultsOnly`, `setting:sellLives`, `setting:refundDays`, `setting:refundWords` and `setting:lawsConfirmedAt`, or the
    conformance sees them as rows changed by mistake. `seed` takes `credits`, and `plays: true` runs the plays' case. The host conformance has a
    case for each `POST …/unmatched` route the host lists.
  - The admin summary gains `plays`, `sendBack` and `totals.sendBack` (a deep-equal of a summary sees them).
  - The Worker's D1 limits keep `limitKey`'s salted hash in `hits`: a test that reads a `hits` row by `order|<visitor>` finds none.
  - `SHOP_LIMITS` gains `use` and `adult`. The Worker's status warns "No NODE_API_KEY" only when the public nodes are asked: with `NANO_NODES` set
    and no key, the warnings are one fewer.
  - The panel's Play key: a press with no round ready reads `GET {playsBase}` before it orders (a test awaits the press, and sees that GET first).
  - `roundsView` (`/admin/panel`) gains `setSellLives(on)`.
- **Fixes from the phone check (2026-11-04):** on a phone on its side the pay sheet's refund words have their own row above the QR code (they fell
  under it, cut by the sheet); the Play key reads the credits again before it buys and when the page comes back into view, so a credit paid
  meanwhile starts the round, never a second order; the admin's Orders keep the name's width and wrap a long payer line (the price never runs over
  it); every admin key, tab, filter key and summary is at least 44 px high (and the Orders table's copy key, an icon alone there, 44 px wide); "To send back" stops under the sticky tabs, not behind them; the Rounds
  draft offers a life or a continue only while the Legal card sells them; "No NODE_API_KEY" is no longer said for the game's own `NANO_NODES`; the
  README's "paid state" test is the starter's Vitest file (`testAccount()`, `looks.json` imported) and runs there as it is.
- Sizes (gzip, size test): `/looks` 4.0 kB (ceiling 4.1 kB), `/shop` 12.7 kB (12.9 kB), `/shop/worker` 14.4 kB (14.5 kB), `/shop/panel` 11.3 kB (11.6 kB).

## 0.14.1 (2026-11-03)

- **The shop's Firestore adapter: a lost race is the next amount, never an error.** When many buyers of one price order at the same instant, they all race
  for one amount's document, and Firestore retries the losers. A loser that lost on every attempt got ABORTED (gRPC code 10), and `insert` let it through:
  `reserveOrder` threw a raw Firestore error, not the next amount and not `ShopBusy`. `insert` now answers an ABORTED (code `10`, or the web SDK's
  `"aborted"`) as "taken": an aborted transaction wrote nothing, so the order goes on to the next amount, and `ShopBusy` comes after the last one. Any other
  error still goes to the caller. Found by the conformance case "25 at the same instant" on the Firestore emulator (about 1 run in 6 failed). New tests: the
  adapter on the fake with an injected ABORTED, and on the emulator a burst of 25 at once that counts the ABORTED answers.

## 0.14.0 (2026-11-02)

- **"Free play" in /admin (Wes, 2026-11-02):** the Game card's fifth setting, a switch, On by default. Off says that the game has no free play: a player must pay in
  the game to play. The switch only says so; the game asks for the payment. `freePlay` ("on" or "off") is in `GameSettings`, `GamePatch` and `GameState` (with
  `fromAdmin.freePlay`), `POST {base}/game` takes `{ "freePlay": "on" | "off" }`, and the memory, D1 and Firestore stores keep it as `setting:freePlay`, with a
  store conformance case. `freePlayOn(settings)` gives the listing file's word, `"freePlay": true` or `false`: Nanoterra's listing then says "Paid" in place of
  "Free to play". The game's paid play, its prices and its risk are the creator's. The Overview lists the switch too.

## 0.13.0 (2026-11-01)

- **The camera's distance on one curve (`createZoom`, `listenZoom` in `@nano133/nanoterra/input`):** one number, the camera's distance from the eyes, moved by
  the mouse wheel, a trackpad's scroll or pinch, a touch pinch and the + and − keys, with nano133.com's island feel. A notch moves `0.35 + 0.14 × distance`
  metres (100 px of scroll, a line 16 px, a page 400 px, a trackpad pinch five times a scroll), and every bit of a scroll counts: Echo Island's dead zone and
  speed limit dropped most of a quick spin, and its wheel needed about five times the spins. The last notch in goes to the eyes, the first notch out past the
  switch. The touch pinch is the same curve as a ratio: twice the spread divides `distance + 2.5` by 2^1.3 (`pinchStart`, `pinch`, `pinchEnd`; the game wires
  the fingers). `createZoom(range, { read, write })` keeps the distance in the game's own storage (`read` at first use, never on the server), eases it
  (`step(dt, calm)`, at once with reduced motion), and has `set`, `by`, `eyes` and `subscribe`. `listenZoom(zoom, canvas, { skip })` stops the page's scroll
  over the canvas and leaves the browser's zoom keys and a field alone. The pure parts (`wheelNotches`, `zoomedBy`, `pinchedTo`) are exported. About 1.0 kB gzip.

## 0.12.0 (2026-11-01)

- **A passkey for the owner (`createAdminSignin({ passkeys: true })`): the owner's LINKED passkeys open /admin.** A passkey is only a key to /admin; the money stays
  in the owner's wallet. A link counts only when both sides prove their key: `POST /api/admin-signin/passkey/link` needs a live **wallet** admin session of the
  owner AND the passkey's own signature of "Link this passkey to the ADMIN of <host>: sign in as <address> at <ms>". A linked passkey then signs "ADMIN of <host>:
  sign in as ..." at `POST /api/admin-signin/passkey` (the person check and the start limit, like `start`) and gets a new admin session (`via: "passkey"`, one day,
  the admin cookie, a row of the sign-in list). Never the host alone: a player's passkey signature never opens /admin. Each signature counts once (the admin's own
  table) within 5 minutes. At most 10 passkeys per owner (`ADMIN_PASSKEY_LIMIT`); a passkey's session can list them (`POST /passkeys`) but not add or remove one;
  `POST /passkey/unlink` (wallet only) removes a link and ends that passkey's sessions. Off by default: no route, and no passkey session opens /admin.
- **`session(request)` reads the link on every request** with the CURRENT owner: a "passkey" session comes back as `{ address, createdAt, via: "passkey", linkedTo:
  owner }` only while its link exists, else as no session (401). A removed link, a new owner address, or the passkeys turned off end its access at the next request.
- **The guard's ONE new rule (Wes, 2026-11-01):** `AdminSession` has an optional `linkedTo`; check 3 accepts `via: "passkey"` only when `linkedTo` is a text, and
  check 4 then compares `linkedTo` with the owner (exact text) instead of the address. Every other `via` is refused as before; a wallet session is judged by its
  address (its `linkedTo` is not read). "DO NOT LOOSEN" stays. The grid test proves the kit is at least as strict as the starter for every input except a
  "passkey" session with `linkedTo === owner`.
- Stores: optional passkey methods on `AdminSigninStore` (`createSession`, `linkPasskey` → "linked" | "exists" | "full", `unlinkPasskey`, `passkeys`, `linked`,
  `useOnce`; `clean` drops used signatures); memory, D1 and Firestore have them, and `adminSigninStoreConformance(make, { passkeys })` has four new cases. **D1
  migration** for a game with the tables already (the starter: `migrations/0009_admin_passkeys.sql`): `admin_passkeys (owner, address, created_at, PRIMARY KEY
  (owner, address))` and `admin_once (key PRIMARY KEY, until)`, now at the end of `/admin-signin/d1.sql`. Without it the wallet sign-in and `clean()` work as before.
  Firestore: `admin_passkeys/{owner}` (one document per owner) and `admin_once/{key}` (TTL on `deleteAt`).
- The panel: `adminSignIn({ passkeys: true, scheme, name })` adds a **Passkey** tile after the wallets; `ownerPasskeys({ scheme, name })` is the **Owner passkeys**
  card (the list, Add a passkey and Remove, both only with a wallet session) for the new `mountAdmin` option `cards` (cards of the game's own in Settings,
  `{ el, refresh? }`, `AdminCard`). The passkey code and the purse load only when a passkey is used. The admin icons have a `key`.
- Sizes (gzip, size test): `/admin-signin` 6.9 kB (ceiling 7.3 kB), `/admin-signin/d1` 1.9 kB (1.95 kB), `/admin-signin/firestore` 2.2 kB (2.3 kB),
  `/admin-signin/panel` 9.3 kB (9.7 kB).

## 0.11.0 (2026-11-01)

- **New path `@nano133/nanoterra/admin-signin`: the admin's wallet sign-in, on one fixed route in every game, `/api/admin-signin`.** The game starter's admin
  sign-in moved into the package with every check and every signed text unchanged: Berry Wallet signs the page `https://<host>/admin` (no query), Nautilus the
  label "ADMIN of <host> sign-in ABCD-EFGH from <country>"; a request lives 2 minutes, is delivered one more minute and works once; only the browser that started it
  and only the game's own address (`owner`; another wallet gets `not_owner`) make an admin login; the cookie `admin` (`__Host-admin` on https, one day) and the
  database's `sha256("admin:" + token)` keep it apart from the player's login; each login writes the sign-in list (time, country, short browser name, 30 days).
  `createAdminSignin({ store, owner, ... })` gives `handle`, `session` (for `createAdminHandler`), `signOut`, `signOutEverywhere`, `recentLogins` and `clean`.
- **NanChat is off for the admin** (`nanchat: false`, the default): its text must start "Login to <host>" and cannot name the ADMIN, so a start is refused with
  "NanChat cannot open the admin yet. Use Berry Wallet or Nautilus." `nanchat: true` turns it on (its "Login to <host>" text, the same admin checks). Berry
  Wallet is first in every wallet list.
- Stores: `createD1AdminSignin` on the starter's own tables (`signin_requests` and `sessions` with `scope = 'admin'`, `admin_logins`: **no migration** for the
  starter; a new game adds `/admin-signin/d1.sql`), `createFirestoreAdminSignin`, `createMemoryAdminSignin`, and `adminSigninStoreConformance`
  (`/admin-signin/conformance`) for a store a game writes itself.
- The panel `/admin-signin/panel`: `adminSignIn()` and `adminSignOut()` fit `mountAdmin`'s `signIn` and `signOut`; Berry Wallet and Nautilus as tiles (NanChat with
  `nanchat: true`), one key on a phone, a QR code on a computer (the package's own; Nautilus's link is too long for it and shows as a link). Its stylesheet
  `/admin-signin/style.css` is the player sheet's (which gets a two-tile row).
- The package's tests run `adminSigninConformance` (the player's sign-in and the admin's side by side, Berry Wallet, Nautilus and NanChat turned on) and
  `adminConformance` (with `createAdminHandler` and the sign-in's `session`) on the memory store and on D1.

## 0.10.1 (2026-11-01)

- **The admin conformance suite's heavy checks are one case for each route.** "Other spellings of EVERY admin path" and "a request from another
  page" were each one case over every route, every visitor and every method: hundreds of requests, which timed out at the starter's 30 s under load
  and even alone on a game with more routes (the prompt pack's Echo Island runs). They are now "other spellings of GET /api/admin/summary ..." and
  "a request from another page to GET /api/admin/summary ...", one for each route; the checks are the same. `ConformanceCase` has an optional
  `timeoutMs`, and the heavy cases (these two and "OPTIONS and HEAD") set it to the new `HEAVY_CASE_MS` (120 s): pass it to the runner,
  `it(c.name, c.run, c.timeoutMs)`.
- README: a test of the shop's sheet clicks a slot's tab (`.n133s-tab`) before it looks for that slot's looks, or calls `buy(lookId)`.

## 0.10.0 (2026-11-01)

- **No minimum price: a fraction of a cent works.** A look's `priceUsd` may have up to 4 decimals (`0.005` is half a cent, `0.0001` the smallest price
  above 0); before, the looks check refused anything under a whole cent. New in `/looks`: `priceStepOk(usd)` (the new rule), `PRICE_STEP_USD`
  (`0.0001`) and `usdDecimals(usd)`; `wholeCents` stays as it was. The shop already rounded the Nano amount up to a step of 0.0001 XNO (at least one
  step), and the matcher compares exact amounts, so a half-cent order asks for 0.005 XNO at $1 and only that amount pays it.
- `usdText` writes 2 to 4 decimals (`"$0.25"`, `"$1.00"`, `"$0.005"`), so the Buy key and the pay sheet no longer show a sub-cent price as a rounded
  cent; `priceText` writes `0.5¢`. An order keeps its dollars as `usdDecimals` (`"0.25"` and `"1.00"` as before, `"0.005"`), not `toFixed(2)`.
- The admin counts sales in steps of $0.0001, not cents (the Shelf, Earned, the best sellers), its price box takes 4 decimals, and the message for an
  AI assistant says "at most 4 decimals".

## 0.9.3 (2026-11-01)

- **A session that ended at Buy.** A 401 from the server at Buy (the session ended, though the game's `signedIn()` still said yes) showed a
  "Sign in" key that asked `signedIn()` again, got yes, and posted the same refused order again. The key now calls `signIn()` without asking, and the
  new `onSessionEnd()` hook on `mountShop` lets the game mark the player signed out (the Echo Island worker found it).

## 0.9.2 (2026-11-01)

- Not published on npm: its changes reached npm in 0.9.3.
- **`onSignInCancel(lookId, look)` on `mountShop`** (the Echo Island worker found the gap while it moved Echo's shop to `/shop`). A game with its own
  looks sheet calls `shop.buy(lookId)`; when the player closes the sign-in without signing in, the kit now opens nothing (and closes its sheet if it
  was open) and calls the hook, so the game shows its own sheet again. Before, the kit's own looks list opened. A Buy in the kit's own list still
  goes back to that list and does not call the hook.
- **`buy(lookId)` starts on the next frame.** A game's own `<dialog>` that closed just before has had its `close` event by then (Chromium fires it at
  the frame), so the game's close handler can no longer take the focus and the Escape key from the kit's sheet. `dialog.close(); shop.buy(id)` is safe.
  `shop.isOpen` is false until that frame; `open()` still opens at once. The README says to close the game's dialog first.
- **Phone-first sizes by default** in the shop's sheets and the sign-in sheet: every text 16 px or more (was 11 to 15 px: the tabs, the Looks key,
  each look's line, the notes, the price-source line, the time left, the address and labels by hand, the copy keys, the wallet tiles' names, "Or a
  wallet app", the back key, the status, "Last used"), and every key, tab, close key, back key, fold summary, copy key, wallet tile and link 48 px or
  more each way (was 44 px; the inline "open a wallet" link was 17 px tall). "Last used" sits in the flow now (under a wallet's name, at the end of
  the passkey's row) so it never covers a word. A game that wants smaller text or keys sets them in its own stylesheet, after the kit's.

## 0.9.1 (2026-11-01)

- Not published on npm: its changes reached npm in 0.9.3.
- **The words of the shop's sheets and of the player's sign-in sheet are the game's to set** (the coordinator asked for it: Echo Island's move to
  `/shop` waited on it; Wes prefers fewer words). `words` on `mountShop`, `looksView` and `payPanel` (`ShopWords`, defaults `SHOP_WORDS`,
  `shopWords()` merges) and on `mountPlayerSignin` and `signInView` (`PlayerSigninWords`, defaults `PLAYER_SIGNIN_WORDS`, `PlayerSigninWordsOption`
  for a game's partial words and faults, `playerSigninWords()` merges). Every visible word, every key and every name for a screen reader; a text
  with a value is a function (`buyTitle(look)`, `endsIn(time)`, `prices(sources)`, `waitingFor(wallet)`). `refusal(text, status)` turns the
  server's refusals into the game's words. `faultWords(code, rpId, words?)` takes the words. Not the game's to change: the stamp "TEST MODE: DO
  NOT PAY", and "Powered by CoinGecko" while CoinGecko is a price feed (`priceLine` adds it back).
- **Shorter default words.** The pay sheet: 30 words in TEST MODE (was about 85) and 29 live (was about 47), no sentence over 10 words. Live:
  "Send exactly 0.25 XNO", "Ends in 14:59.", "Waiting for payment…", "Price: Kraken, KuCoin. Powered by CoinGecko."; by hand: "Another amount
  does not match." TEST MODE: the stamp, "Nothing can be paid here.", the wallet key "Wallet off: test mode", no timer and no status (nothing
  waits for a payment). Paid late: "Paid after the order ended, so no look. The creator sends it back." The looks sheet: "Looks never change
  play. Pay in Nano, straight to the creator." and "Sign in first to buy a look."; "Back" (was "Back to looks"). The sign-in sheet: the lines
  over 10 words split or cut, with the same meaning (the spare key's note, the password manager's and the "two answers" faults, the QR lines).
- `test/panel-words.test.ts` counts the words a player sees (happy-dom) and proves a game's words reach the page.

## 0.9.0 (2026-11-01)

- **The player's sign-in** (`@nano133/nanoterra/player-signin`, `/player-signin/conformance`, `/player-signin/d1` with `/player-signin/d1.sql`,
  `/player-signin/firestore`, `/player-signin/panel` and `/player-signin/style.css`). Wes: "start the player passkey sign-in too" (2026-11-01); the kit's change
  list asked for "a passkey sign-in for players" (a prompt-pack run found that players without a wallet app cannot buy).
  - **A passkey** (the passkey purse of `@nano133/signin`: a Nano account made in the browser from the passkey's PRF output, by the game's own FROZEN scheme)
    and the three **wallet apps** (Berry Wallet, NanChat, Nautilus), in one path. The server checks signatures only and holds no key; a player is a Nano
    address whichever way they sign in. `@nano133/signin` (`^0.5.0`) is a new **optional** peer, needed by this path only.
  - **The server** (`createPlayerSignin({ store, ... })`): the game starter's routes and answers (`/api/signin/start`, `/nano/:id`, `/nautilus`, `/nanchat`,
    `/check`, `/api/signout`) plus `POST /api/signin/passkey`; the starter's session cookie (`session`, `__Host-session` on https, 30 days, the token's SHA-256
    kept); `player(request)` for the shop and the friends list, `session`, `signIn` (the game's own code exchange), `signOut`, `forget` ("Delete my data") and
    `clean`. `sharedPaths` leaves the admin's calls to the game. `schemeVector` and `checkScheme` for the scheme's fixed vectors.
  - **The stores:** memory, D1 (the starter's own `signin_requests` and `sessions`, plus `signin_once`: a starter's players stay signed in; admin rows are never
    touched) and Firestore (a small interface, no Firebase dependency), with `playerSigninStoreConformance`.
  - **The sheet** (`mountPlayerSignin`, `signInView`): passkey first, then the wallet apps; no passkey on a preview address (`*.workers.dev`, `previewHost`;
    `passkey: true` offers it there), where a passkey would be lost when the game moves to its own domain; "Make a passkey" and "Use my passkey", "Keep a spare key" after a new
    passkey, the faults in plain words (no PRF and the rest), QR or one key per wallet, phone first, light and dark. The purse's signing code loads only at a
    passkey sign-in.
  - **The admin** (`mountAdmin`, `playerPasskeys: true`): on `*.workers.dev` its "Check these" banner says "Passkeys turn on when your game has its own domain."
- **A shop for a game's looks** (`@nano133/nanoterra/shop`, `/shop/d1`, `/shop/d1.sql`, `/shop/firestore`, `/shop/worker`, `/shop/conformance`,
  `/shop/panel` and `/shop/style.css`). Wes: "start the shop kit path" (2026-11-01). A game installs the game starter's shop instead of copying its
  2,600 lines. The starter's money model, unchanged: the money goes straight from the player's wallet to the creator's address, the server holds
  no key and only reads the ledger, and each order asks for a unique, clean amount (at most 4 decimals of XNO) that a payment must match exactly.
  - **The rules** (no DOM, no database): the starter's amounts (raw text and BigInt, prices rounded up), the reservation (one step more while
    another held order has the amount, at most a tenth more; an amount held until an hour after the order ends), the match (a confirmed send of
    exactly the amount to exactly the address, first seen after the order; late is "paid late", no look), the price (the median of three feeds,
    kept 5 minutes, the last good one for 6 hours), the nodes with failover (`nodesFor`: Nanswap first with a key, then the game's own list or
    the public nodes), and the payment scan (`scanPayments`: one scan for the whole game every 4 s, fails closed). The creator's address is
    checked with its checksum (`validAddress`, the package's own 5-byte BLAKE2b): a typo keeps test mode on.
  - **The routes** (`createShopHandler`): the starter's paths and JSON (`POST /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/check`)
    and its words for each refusal, the game's player through `player(request)`, the same-origin check on POST, a limit of new orders and the person
    check as hooks. **Test mode** until the owner's own address is set AND test mode is off: no address and no link in the answer.
  - **The stores**, each keeping the rules in one step: memory, D1 on the starter's own tables (`createD1Shop`; `d1.sql` with `IF NOT EXISTS`: a
    game from the starter switches with no migration and keeps its orders and owned looks; `d1Limit` and `visitorKey` on the same rows), and
    Firestore (`createFirestoreShop`: the admin's orders, owned and meta, plus a document for each held amount and each recorded payment, in
    transactions). `forget(player)` for "Delete my data": waits while a payment may still come; deletes the owned looks and the unpaid orders;
    keeps a paid order as the sales record under "deleted", and a late payment's payer (the creator sends it back by hand).
  - **The conformance suite** (`shopStoreConformance`, 17 short cases with `SHOP_CASE_TIMEOUT_MS`): one owner per order, a paid order never paid
    twice, one payment for one order, an expired order past its hold never paid, unique amounts among held orders (25 at once), busy, 39-digit
    amounts, the scan's claim, the price, and `forget`.
  - **The Worker** (`createShop(env, { catalogue, player })`): the starter's settings (`RECEIVE_ADDRESS`, `TEST_MODE`, `NODE_API_KEY`, `NANO_NODES`,
    `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`), Turnstile's check, the limit in D1, `scan()` for the cron, `config()` for the page and `status()`
    (with the starter's warnings) for the admin.
  - **The panel** (`mountShop`): the Looks key (or `key: false` and `open()`), the looks sheet with a tab for each wear slot, Buy through the
    game's `signIn()` (the shop draws no sign-in), the pay sheet with the package's own QR code (SVG, byte mode, level M; the same modules as
    the starter's qrcode-generator), the starter's "TEST MODE: DO NOT PAY" stamp with the wallet key off, a check every 5 s for 2 minutes, and
    `onOwned(lookId)`. Phone first; on a phone held sideways the QR code stands alone on the left and the wallet key stays in view. Light and
    dark with the `--n133-*` variables and their `--n133-dark-*` twins.
  - **The CSP lists** (`SHOP_CSP`, `mergeCsp`): Turnstile's origin for `script-src` and `frame-src`, merged into the game's own policy.
  - Ideas from Echo Island's shop (a tab for each wear slot with its plain choice first; the wallet key in a foot that stays in view) and from the
    prompt pack's runs (the shop's tests read a fixture, not a game's looks; the conformance cases are short and each its own test).

## 0.8.1 (2026-11-01)

- **A closed panel gives the keys back to the game.** The options panel, the friends panel and the emote wheel put the focus back on their key when they
  closed; Space (a game's jump) then pressed that key and opened the panel again (in the starter, after the player moved Jump off Space). Now the focus
  leaves the key and the panel. `focusAfterClose: "key"` (on `mountOptions`, `mountFriends` and `mountEmotes`) keeps the old way, for a page with no keys of
  its own.

## 0.8.0 (2026-11-01)

- **An options menu for a game** (`@nano133/nanoterra/options`, `/options/panel` and `/options/style.css`). Wes: "build options menu and emotes in kit"
  (2026-11-01).
  - **The store** (`createOptions({ game, defs })`, no DOM): a game declares its settings as data, of four kinds: `"toggle"`, `"choice"`, `"range"` and `"key"`
    (a key binding, a `KeyboardEvent.code`; two bindings never share a key: a taken key swaps). Each has a key, a short label, an optional help line, a tab
    (`"basic"` or `"advanced"`), an optional group and a default, one value or one for each device class `{ phone?, tablet?, desktop?, reducedMotion?, default }`
    (`detectDevice`: a coarse pointer with a short side under 600 px is a phone, another coarse pointer a tablet, else a desktop). The device's reduced-motion
    setting is followed live until the player sets the option. Only the values that differ from the default are kept, in `localStorage` under
    `n133-options:<game>`; a kept value that does not fit is dropped on read; a refused storage works in memory; `migrate` reads an old save. `get`, `set`,
    `reset`, `values`, `defs`, `def`, `defaultOf`, `isDefault`, `subscribe`, `subscribeDefs`, `add` (a module's section, keys like `emotes.show`; a key used twice
    throws) and `redetect`.
  - **The common settings** a game opts into by key (`common(...)`, `COMMON_OPTIONS`): `masterVolume`, `musicVolume`, `effectsVolume`, `cameraSensitivity`,
    `invertLook`, `stickSide` (a phone and a tablet only), `reducedMotion`, `quality` and `showFps`. `keyBinding(action, label, code)` and `optionSection(name, defs,
    group?)` make defs.
  - **The panel** (`mountOptions(el, store, { title?, key?, onOpen?, onClose?, onRangeDone?, confirm? })`): a gear key and a sheet (from the bottom on a phone held
    upright, from the right on a wide or sideways screen) with Basic and Advanced tabs (ARIA tabs, the arrow keys), groups, a switch, a row of keys or a
    drop-down, a slider with its value, a key cap that waits for a key. A change applies at once and shows in place (no Save key; the panel never scrolls back to
    the top). "Reset to defaults" asks in the panel, never in a browser dialog. `key: false` for a game's own pause menu. Light and dark: it follows
    `data-n133-theme` on `<html>`, else `prefers-color-scheme`; every colour is a `--n133-*` variable with a `--n133-dark-*` twin.
  - `reflectOptions(store, ["reducedMotion"])` keeps `data-n133-opt-reduced-motion` on `<html>` for the page's CSS.
  - Ideas from Echo Island's own draft (its key bindings with a swap, the live reduced motion, "Less motion" in the page's CSS, rows changed in place, a sound when
    a slider is let go).
- The admin panel's icons have a `gear`.

- **Emotes for a game** (`@nano133/nanoterra/emotes`, `/emotes/player`, `/emotes/wheel`, `/emotes/style.css` and `/emotes/icons.webp`). Wes: "build options
  menu and emotes in kit" (2026-11-01). Nano Island's eleven emotes, the same as nano133.com's (2026-10-30):
  - **The clips** (`/emotes/player`): the Wave is the character's own `wave()`; Cheer, Clap, Dance, Bow, Shrug, Laugh, Point, Sit, Facepalm and Spin are the
    island's Blender clips, made on this package's skeleton. `createEmotes(character, { onEmote, onStop })` gives `play(id)`, `stop()` and `playing`. A clip is a
    layer over the character's pose: `update` solves the walk, the clip blends over it, then the tail, the wings and the hair follow, so the frame loop does not
    change. The island's rules: fades of 0.12 s in, 0.22 s out at the end and 0.18 s on a stop; a whole-body clip stops on a move or a jump, an upper-body one
    (Clap, Shrug, Point, Facepalm) plays over the walk; Dance and Sit loop until a move; reduced motion holds one frame. `playRemote(character, { id, at? })`
    plays another player's emote and ignores an id that is not one; `stopEmote(character)`. The clips (84 kB, 18.8 kB gzip) load on the first emote
    (`loadEmotes`, a dynamic `import()`, so a chunk of their own).
  - **The wheel** (`/emotes/wheel`): `mountEmotes(el, { game, onPlay })`, the island's wheel in plain DOM: an Emotes key, the wheel in the middle over a dim
    page, eight places, a tap or a hold-and-slide, Edit ("Your wheel is full. Take one off first."), B and 1 to 8, Escape; kept per game in this browser
    (`n133-emotes:<game>`). Nanoterra's emotes, the game's own (`{ id, label, icon? }`), or both. Light and dark. The pictures load when it first opens.
  - **Multiplayer:** `onEmote({ id, loop, at, again })` (a loop again every 10 s, `LOOP_AGAIN_MS`), `onStop({ id, at, why })`, and the message
    `emoteMessage(e)` = `{ emote: id }`, read back with `readEmoteMessage`. The kit has no network.
  - **Options:** `EMOTE_OPTIONS` for `/options`: "Show the Emotes key", "Show other players' emotes" and the wheel's key (`keys.emotes`, B).
  - **Licence:** the clips and the icons picture are part of the package and under its MIT licence (Wes, 2026-11-01).
- **The admin's Game card: "Allow Nanoterra emotes"** (`emotes`: `"on"` by default, or `"off"`), kept as `setting:emotes` by the memory, D1 and Firestore stores
  (a fourth setting; the store contract has a case for it). `GameState.emotes`, `DEFAULT_EMOTES`, `isEmotes`; the Overview shows it.

## 0.7.1 (2026-10-31)

- **Friends: the panel asks in the panel, never in a browser dialog.** Remove, Block and Join (both modes) showed `window.confirm`; now the question and a key for
  each answer show at the top of the panel, which opens for it. Escape or closing the panel answers no. The `confirm` option stays, and may return a promise.
- **Friends, "own": no Invite key without `onJoin`.** A game with no way to join a friend gave an invite that led nowhere.

## 0.7.0 (2026-10-30)

- **The admin panel has a light and a dark theme** (`/admin/panel`, `/admin/style.css`). A theme key in the top bar (and on the signed-out screen) opens Device,
  Light and Dark; Device is the default and follows `prefers-color-scheme` live. The choice is kept in this browser (`localStorage`, `n133-admin-theme`); a refused
  storage reads Device. The panel gets `data-theme` and `color-scheme`; the page's `<html>` gets `data-n133-theme` while the panel is mounted, so the host page can
  follow (README, "Light and dark"). Every colour of the stylesheet is a variable now: `--n133-*` sets the light value as before, and each has a `--n133-dark-*`
  twin. `mountAdmin` returns `theme` and `destroy()` too. New exports: `createTheme`, `themeKey`, `resolveTheme`, `readThemeChoice`, `themeLabel`, `THEME_KEY`,
  `THEME_CHOICES` and their types.

## 0.6.1 (2026-10-30)

- **Friends: a name may be 80 characters** (it was 64), so a whole Nano address (65 with `nano_`) reaches the game's `PlayerDirectory`: the handler's
  `FRIENDS_LIMITS.nameMax` and the panel's name field.

## 0.6.0 (2026-10-30)

- **A friends list for the game's players** (`@nano133/nanoterra/friends`, `/friends/d1`, `/friends/firestore`, `/friends/conformance`, `/friends/panel` and
  `/friends/style.css`). The admin's Game card has a third choice, **"Friends list: Nanoterra / The game's own / Off"** (Nanoterra by default):
  - **Nanoterra:** `mountFriends(el, { mode: "nanoterra", game })` puts a Friends key in the game and holds nano133's friends window
    (`https://nano133.com/embed/friends?game=<id>&v=1`) in its panel. The friends stay on nano133; the game gets none of them, only the window's height, two
    counts for the badge (requests, else friends online) and a friend's https address to join (the kit asks the player first). The window
    is loaded at once and kept while the panel is closed, because it holds the player's live connection ("Playing <game>" for their friends). The messages
    are contract v1 with the site, `{ source: "nanoterra-friends", v: 1, type }` (README, "The nano133 window").
  - **The game's own:** a full friends list of the game's own players on the game's own database: requests (by name, through the game's `PlayerDirectory`),
    accept, decline, remove, block and unblock, invites ("come to Level 2"), and online with a place. `createFriendsHandler` gives the routes (GET the view,
    POST an op; same origin, 30 calls a minute for each player; no answer holds a player id). The stores: `createMemoryFriends`, `createD1Friends` (with the
    migration `@nano133/nanoterra/friends/d1.sql`) and `createFirestoreFriends` (a small interface the Admin SDK fits). `friendsStoreConformance` proves the
    rules on any store; the package runs it on all three (and on the Firestore emulator through the Admin SDK). The panel polls the view every 20 s while open
    and pulses every 45 s with a lease for each tab.
  - **Off:** nothing is drawn.
- **The admin's settings have a third word, `friends`** (`"nanoterra" | "own" | "off"`): `GameState` has `friends` and `fromAdmin.friends`, a press may send
  `{ friends }`, the stores keep `setting:friends` (D1 and Firestore beside the two settings), and `GameSettings.friends` is optional (Nanoterra when left out).
  A game that compares the whole `GameState` (a test with `deepEqual`) adds the two new fields.

## 0.5.0 (2026-10-30)

- **Wear slots** (`@nano133/nanoterra/looks`, and the Shelf of `/admin/panel`): a look fills one wear slot, and a player wears one look in each slot at once. An outfit (no
  `wear`, or `"outfit"`: `OUTFIT`) is the character's own look, with its `change` (the body colour and the hat), as before. Any other `wear` is the game's own slot (a tool's
  skin, a charm: `"wear": "shovel"`): an item there has no `change`. `lookProblems` refuses a bad slot name (field `wear`) and a `change` on an item (field `change`), and
  now asks for one free OUTFIT (a list of outfits only keeps the starter's words); `checkLooks` leaves `wear` out for an outfit and `change` out for an item; `looksJson`
  writes `wear` after `priceUsd`; `removalProblems` refuses a changed wear slot on an owned look (field `wear`); `diffLooks` lists `"wear"`. New: `OUTFIT`, `wearOf`,
  `isOutfit`, the type `Change`. **`Look.change` is optional in the type now** (read an outfit's colours after `isOutfit`): a game that reads `look.change.body` directly
  changes that line. The Shelf shows an item's slot and a tag picture, edits its wear slot (locked for an owned look and the last free outfit) in place of the body and hat,
  and its message for an AI assistant names the wear rule. A file of outfits only reads and writes exactly as before. Echo Island sells shovel and Pinger skins and charms
  with it (Wes, 2026-10-30).

## 0.4.0 (2026-10-30)

- **The admin panel (`@nano133/nanoterra/admin/panel`) has a new layout: the game at a glance, in tabs.** A top bar (who is signed in, Live or Test mode, the bot
  check, Sign out), the warnings as one banner, four numbers (Earned, Open now, To send back, Players; each opens its list), then five tabs: Overview (best sellers
  with their share of the money, the last five orders, the switches as On or Off, the shelf in numbers, first steps for a game with no order), Cosmetics (the
  Shelf), Orders (a filter with counts, a search, a table on a wide panel, 20 at a time), Players (with a search) and Settings (the Game card, the sign-ins, the
  facts). Wes asked for less scrolling and reading, clear sections, and a much better cosmetics screen (2026-10-30).
- **The Shelf**: a grid of cards with a big picture on a tint of the look's colour, the price with its ladder step, the share of the sales, slot chips; filters and a
  sort. Its editor opens one card at a time, with grouped fields (the ladder's seven steps as keys, colour swatches, the hats as pictures), "New", "Changed",
  "Owned" and problem marks on each card, a short change bar at the bottom of the screen, and "Put back" for a removed look. The editor's rules do not change: the
  Shelf still writes nothing, and an owned look's id and slots stay.
- New exports: `shelfFilter`, `shelfSort`, `BODY_COLOURS`, `ordersView`, `orderMatches`, `overviewView`, `bestSellers`, `playersView`, `playerMatches`, `tabBar`,
  `TABS`, `icon`, and their types. `gameCard` takes an optional fourth argument, `onChange(state)`. `mountAdmin`'s options and the handler's routes do not change.
- New CSS custom properties: `--n133-ground`, `--n133-warn`, `--n133-bad`, `--n133-shadow`. The stylesheet uses a container query on the panel (`container: n133`).
  Words that changed: the totals are "Earned", "Open now" and "To send back"; "Owned looks" is "Players who own a look"; "Copy a message for my AI" is "Copy for
  my AI" (its tooltip says the rest). A sign-out now takes the drawn data off the page.

## 0.3.2 (2026-10-29)

- **The Game card's character switch says what On means when a game offers a choice.** Echo Island lets a player choose between the Nanoterra character
  and the game's own character (On), or plays only its own (Off). The card's words now hold for that game and for one with no choice (the starter): the title
  is "Players can play as their Nanoterra character"; On adds "The game may also let a player switch to its own character."; Off says "with no choice";
  `CHARACTER_SIGNIN_OFF` says a player "starts as" the island's first character and adds the same sentence. The switch's values (`"nanoterra"`, `"own"`),
  `CHARACTER_NEEDS_SIGNIN` and the API do not change.

## 0.3.1 (2026-10-29)

- **`@nano133/nanoterra/input`: a character that does not walk on by itself.** A key that is down when the player leaves the page (another tab, another window, a pop-up,
  Cmd+Tab, another app on a phone) never sends its keyup to your game, so a "held keys" set kept it and the character walked on by itself on return (nano133.com's own
  island had it, and the starter: Wes, 2026-10-29). `releaseWhenLost(release)` calls your `release` at a blur, a focus, a page hide, a hidden tab, the Cmd key and a
  menu (keys only), and, new, drops every key REPEAT after a leave until a key goes down again (one more repeat could arrive after the release and put the key back: the
  player now presses the key again to walk on). `pauseWhenLeft(pause)` calls your `pause` when the tab is hidden or the window loses the focus to another window.
  `swallowsKeyup(event)` is for a keydown with Cmd, which is never held. No package, plain browser events. A round that costs money must not pause: keep the release
  and leave `pauseWhenLeft` out.
- **`ISLAND_MODEL`'s zone is a disc of 9 m radius** (18 m across), not 10 m (20 m across). nano133.com made its creator plots 30 m across instead of 36 m
  (Wes, 2026-10-28; the gates' standing places moved in, so the plot's free middle is 9 m). A model that reaches 9.0 to 10.0 m from its middle passed 0.3.0
  and fails now: the fix line names the zone as before (18.0 m across).

## 0.3.0 (2026-10-28)

- **Sockets** (`@nano133/nanoterra/character`): three attach points on the character, `c.socket("head" | "hand" | "back")`, each a `THREE.Object3D` on a bone
  (`head`, `grip_R`, `chest`) that follows the walk, the run, the jump and the wave. The head socket sits at the base's hat frame and scales with it and the head's
  size; the hand socket is in the middle of the drawn right hand (a wide build or base draws its hands further out than the bone) and holds a thing pointing
  forward (`HAND_HOLD`); the back socket is on the back of the torso at the chest. A socket is the same object for the character's whole life: a rebuild (a new
  base, hair or clothes) moves it, with what hangs on it, to the new bones. New: `SOCKETS`, `socketFrame`, `placeSocket`, `isSocketName`, `HAND_HOLD`, the types
  `SocketName`, `SocketFrame`, `SocketLook`; `BaseSpec` may set `handAt` and `back`.
- **A model on a socket**: `WornAdapter` takes an optional `socket` and `object` (and `add` is now optional). `createCharacter({ worn })` and `c.setWorn(worn)`
  hang each object on its socket; a model on a socket builds no geometry, and its `fit`, `hidesBadge`, `hideTail` and the new `hideWings` (a back item takes the Bee's wings off, shapes and bones, as `hideTail` takes a tail off) still apply. The character never frees an
  object that the game hung: `setWorn` takes the old ones off, and `dispose` takes the sockets off the dead bones.
- **`@nano133/nanoterra/model`**: the 3D model check, moved here from nano133.com (`app/launch/model`, which now keeps the same code). `checkModel(bytes,
  limits)` reads a `.glb` from its bytes, never throws, and answers the problems with a fix each, the facts and, new, **advice** (a large PNG or JPEG, 32-bit
  positions, parts that share a material). New facts: `draws` (each part of each drawn mesh instance), `materials`, `anchor`. New limits: `maxDraws`, and
  `anchor` (a marker whose origin is the attach point: the zone is measured from it). The cosmetic presets of Wes's table (2026-10-28): `HEAD_ITEM`,
  `HAND_ITEM` (its anchor is `grip_R`; `grip_L` is allowed; the zone is 0.96 x 0.68 m, from 1.17 m below the grip to 0.43 m above: Wes's choice A of 2026-10-28, so that a shovel held by its T-handle fits), `BACK_ITEM`, and `COSMETIC_LIMITS` by socket; `ISLAND_MODEL` is the island's (a disc of 10 m
  radius, 18 m high). A misspelt marker with capitals in its name (`Grip_R`) now gets its rename line too. A fix line gives a zone's number with two decimals when one is not exact (1.17 m), and as before otherwise (the island's 20.0 m).

- **The Shelf's pictures on the real character**: `createLookPreview` (in `@nano133/nanoterra/character`) draws a look on a character (the game's own
  `body`, else the package's character with its shirt in the look's colour) with one shared offscreen WebGL renderer, one picture at a time, kept by the
  look's text; with no WebGL it answers null. `previewPicture(load)` (in `@nano133/nanoterra/admin/panel`, which still loads no Three.js) is a Shelf
  `lookPicture` that shows the flat picture first and the drawn one when it is ready; `load` is called once, so a game imports its preview file only when
  the Shelf opens. New CSS: `.shelf-preview`.

## 0.2.0 (2026-10-27)

- **Slots** on a look (`@nano133/nanoterra/looks`, and the Shelf of `/admin/panel`): `slots?: Record<string, string>`, what a game defines for itself (a pair of wings, a trail colour). Names are 1 to 24
  lowercase letters, digits or dashes starting with a letter; values are words (1 to 40 lowercase letters, digits or dashes) or `#rrggbb` colours; at most 8 on a look. `lookProblems` checks them
  (`slots`, `slots.<name>`), `checkLooks` keeps them, `looksJson` writes them after `change`, `diffLooks` lists a change as the field `"slots"` (order and the case of a colour are not changes), and
  `removalProblems` reports a changed slot on a look that a player owns (players own a look by its id; a price, a name, a colour or a hat of an owned look stays allowed). New: `sameSlots`,
  `cleanSlots`, `slotValueOk`, `SLOTS_MAX`, `SLOT_NAME_PATTERN`, `SLOT_WORD_PATTERN`, the type `Slots`. A file from before slots reads and writes exactly as it did. The Shelf keeps the slots in its
  draft and has a Slots editor. This is a minor change (0.2.0); a game on 0.1.0 drops slots, so it must move to the new version.
- **`@nano133/nanoterra/admin`** (step 1 of the admin panel): the admin of a game, in the package, with no Three.js, no database and no cookie. The game gives a session and a store.
  - `adminAccess(input)`: the guard, ONE pure function. The same five checks as the game starter's `adminGuard`, in the same order (owner set, session present, wallet login,
    same address, not older than one day). It only refuses MORE than the starter does: a bad owner address, a time that is not a number or lies more than five minutes in the
    future, a login word that is not exactly "wallet", and a limit above one day are all refusals. A fault inside it is a refusal.
  - `createAdminHandler(options)`: the routes (summary, the two game switches, the payment check) on Web `Request` and `Response`. Every path under the base goes through the
    guard first, so a visitor learns nothing about the routes. A POST must come from the game's own page. No CORS header, always `no-store`, a body limit, a rate limit.
  - `AdminStore`: what a game gives (read the two settings, save a checked patch, the summary). The only writes are the two `setting:` values.
  - `loadGameSettings(store, defaults)`: the two switches for the game's own routes (the listing file, the character); the defaults when the store fails.
  - `createMemoryStore()`: a store in memory, for tests.
- **`@nano133/nanoterra/admin/panel`** (step 2): `mountAdmin(element, options)`, the admin page in plain DOM with no framework: the Game card, the status warnings, the totals, the Shelf (the
  starter's, moved here: it edits a draft and gives text to copy, and sends no request), the orders with "Paid late" and an optional "Check payments now", the looks that players own,
  and the screens for a visitor who is signed out, a wrong wallet, a Nanoterra sign-in and a missing owner address. The game gives `signIn`, `signOut` and its `looks`.
  `@nano133/nanoterra/admin/style.css`: its stylesheet, every rule under `.n133-admin`. The summary of the handler now says `canCheck`.
- **`@nano133/nanoterra/admin/d1`** and **`/admin/firestore`** (step 3): `createD1Store(db)` (the game starter's tables, with the starter's own queries) and `createFirestoreStore(db, names?)` (a small interface; no
  Firebase dependency). Both write ONLY the two settings. `adminStoreConformance(make)` (in `/admin/conformance`) is the store contract that every adapter passes: the memory store, D1 on SQLite and Firestore on a fake.
  The summary's numbers come from one file (`summarize`, `moneyOf`, `shapeOrders`), so every adapter says the same thing. The memory store now takes orders with a raw `amountRaw`, like a real database.
- **The Game card's words for sign-in Off** (Wes, "off means off"): "Sign-in from Nanoterra is Off, so every player plays as the island's first character, a player who signed in from Nanoterra before
  included." The card only says it: the game's own page must draw no Nanoterra character while sign-in is Off (the game starter's `src/client/ui/player.ts` does).
- **Who signed in, and "Sign out everywhere"** (optional, Wes's security ideas): `AdminLogin` (time, country, short browser name) and the optional store calls `recentLogins(limit)` and
  `signOutEverywhere()`. With them the summary has `logins` (the last 10, only those three things, whatever the store gives) and `canSignOutEverywhere`, the handler has `POST {base}/signout-all`
  (guarded, same origin, 5 a minute, deletes the admin sessions and no player session), and the panel has a Sign-ins card with a two-press "Sign out everywhere". `createD1Store(db, { logins: true })`
  reads `admin_logins` and deletes `sessions WHERE scope = 'admin'`. Memory store: `createMemoryStore({ logins: true })`. The store contract has cases for both. The panel option `loginsNote` says what
  the game keeps and for how long (30 days suggested).
- **`@nano133/nanoterra/admin/conformance`**: `adminConformance(host)` gives test cases that a game runs against its OWN session code and store: every route refuses a visitor
  who is signed out, a login made for the game's players (also its token in the admin cookie), a Nanoterra sign-in, a login made some way the game does not know, another wallet, a missing
  owner address, an expired login and a login that is old but still valid in the store; OPTIONS and HEAD are refused with no preflight answer; other spellings of an admin path open nothing with
  any method; the game's other routes under the base (`otherRoutes`) refuse a visitor; a POST from another site is refused; a body that is too big is refused; every answer is `no-store` with
  no CORS header. (The first version of this suite passed four wirings that leak everything; a security read found them, and each is a test now.)
- **A fourth security read** (the same fresh agent as the third, 2026-10-27, on the third-read fixes) found that `adminSigninConformance` still passed wrong chains: one with no binding of a request to its
  browser inside one scope, one whose cross-scope ask gave a login in the STORED scope, one whose `sign()` stopped landing (the checks then ran on an unsigned request), one that checked the scope only
  while the request was fresh, one whose Sign out everywhere left a request that was still waiting for a signature, and one with no `signOutEverywhere` at all (the case was skipped). Fixed: `sign()` must
  throw on a refusal; a cross-scope ask must give no login of either kind and the request must still sign in afterwards (the signature is proven to have landed); a same-scope ask from another browser gives
  none; the host may give `advance(ms)` to repeat the asks after the admin's request life; `adminSigninConformance(host, { signOutEverywhere: true })` fails a host that has no call; the store contract
  REQUIRES `seedRequests` and `pendingRequests` when the store has `signOutEverywhere`. `createD1Store(db, { logins: true })`'s `signOutEverywhere` also ends the pending admin requests
  (`expires_at = 0`). Eight fake chains (one good, seven wrong) run against the contract.
  A fifth read of these fixes (same agent) found four small gaps, fixed: `adminSigninConformance(host, { advance: true })` fails a host that cannot move its clock (the time case could be skipped);
  the late asks are made at 10 and at 55 minutes (a scope check that holds for 30 minutes passed); a collected request must give another browser no login either; and the kit's `dist` must be
  built before `npm pack` (a packed tarball of an unbuilt change tested the old code). Ten fake chains (one good, nine wrong).
- **A third security read** (another new fresh agent, 2026-10-27) found that the suite still passed four wirings that leak: a game that caches 200 answers by URL, one that keeps the sessions it has read
  in memory (a login that sign-out or Sign out everywhere ended still opens), one that also reads a player's token from a Bearer header, and one that reads it from the query. Fixed: the suite sends every
  refused visitor again right after the owner was served; `host.endLogin` and the login that used Sign out everywhere are used again and must be refused; `req.tokenAt` sends a player's token in other
  places than the cookie; and `adminSigninConformance(host)` is a contract for the code that MAKES the logins (a game request never makes an admin login and the other way round, for the browser that
  started it, another browser and retyped credentials; once; and a signed admin request makes no login after Sign out everywhere). `createD1Store(db, { logins: true })`'s `signOutEverywhere` also marks
  the admin sign-in requests that were not delivered as delivered (needs `signin_requests.scope` and `.delivered`). The list shows a browser name only when it is words. Four tests run the four wirings
  against the suite, and three fake sign-in chains run against the contract (one good, three wrong).
- **A second security read** (new fresh agent, 2026-10-27) found that the second conformance suite still passed some wirings that leak or act. Fixed: the suite sends a foreign Origin (another site,
  `"null"`, a sibling subdomain) and Sec-Fetch-Site cross-site and same-site on every route with every method, for the owner too; it sends an old login that is still valid THREE times (the last two
  with `req.again`) so a rolling session fails; `expired_login` is now made less than a day ago so only the game's own store can refuse it; new kind `signed_out_login`; the spelling tricks run on
  every route and method; the game's other routes must refuse with a refusal that carries no data. **The handler now refuses a read that says it comes from another page**, as it refused a write.
  Looks: `wholeCents` is exact (`0.300000001` and `1e-9` no longer pass); a slot colour is written in lower case (a change of only its case is no change); the names `constructor` and
  `prototype` are reserved; `checkLooks` checks and copies one snapshot; the Shelf never gives an id that a player owns to a new look.
- **Fixes from a security read of the first admin code:** odd spellings of the base path (a bad percent code, backslashes, many levels of encoding) now reach the guard instead of falling through;
  a fault in the game's `now()` or `onError()` can no longer reject `handle()` with the raw error; the default limiter is keyed by base path and owner, so two games in one process do not share a
  count; the message for an AI assistant takes only valid look ids, written as JSON strings (an id from a database cannot write a line into it); the summary counts only the four statuses it knows
  and reads a dollar text only when it is plain dollars.

## 0.1.0

First version (Pre-alpha). **One package for Nanoterra.** It replaces `@nano133/character` 0.1.0, `@nano133/ticket` 0.1.0 and
`@nano133/looks` 0.1.0 (their npm versions stay; they are deprecated and point here).

- **`@nano133/nanoterra/character`**: the character is now the one that nano133.com's island and 3D room draw, from the same code. Six bases
  (Classic, Round, Critter, Bee, Robot, Pineapple), faces, hair, clothes, sizes and colours, from a **record** of whole numbers on closed lists.
  `createCharacter({ record, look, colors, quality, reducedMotion })` gives `object`, `update(dt, { speed, airborne, verticalSpeed })`,
  `wave()`, `setLook(recordOrFiveColours)`, `setColors(colors)`, `record`, `look`, `reducedMotion` and `dispose()`. `setLook` to another body builds new
  geometry and frees the old; a new colour only repaints. The default Classic is the old package's character, vertex for vertex.
  Also exported: `buildCharacter` and `assemble` (the geometry and the skinned meshes on the island's 28-bone skeleton), the lists, `WornAdapter`.
- **Changed from `@nano133/character` 0.1.0:** the blob shadow is a disc in the body (on the skeleton's shadow bone), so there is no `c.shadow` and one
  `scene.add(c.object)` is enough; it stays on the ground under a jump. A colour that is not on the island's lists (a shop dye) goes through `setColors`
  (`setLook` takes a record or the five colours of the lists). `HEIGHT` and `RADIUS` are the default Classic's.
- **`@nano133/nanoterra/character/record`**: the record with no Three.js and no package at all: `packRecord` and `unpackRecord` (two whole numbers; `null` for
  anything off a list), `recordProblem`, `clean`, `fromLegacy` and `toLegacy` (the five colours; all 8,192 old looks come back whole), `withLegacy`, `withBase`,
  `diceRecord`, `fromBlob` and `toBlob` (the room's blob), the lists, `defaultLook`, `isLook`, `lookProblem`, `assertLook`, `LOOK_PARTS`.
- **`@nano133/nanoterra/ticket`**: `readTicket`, `verifyTicket`, `fetchKeys`, `ticketFromHash`, `hashWithoutTicket`, as in `@nano133/ticket` 0.1.0, and the
  ticket's **`record`** when it carries one (read with care; absent for a ticket from before it, and then the answer reads exactly as it did). The same pinned
  ticket is checked byte for byte here and in nano133.com's own test.
- **`@nano133/nanoterra/looks`**: `@nano133/looks` 0.1.0 as it was (`checkLooks`, `lookProblems`, `removalProblems`, `diffLooks`, `looksJson`, `slugId`,
  `PRICE_LADDER`, `rungOf`, `priceText`, `usdText`, `wholeCents`, `HATS`).
- **`@nano133/nanoterra`**: the types `Look` and `LookRecord`, and nothing that runs. Importing the record, the ticket, the looks or this path loads no Three.js
  (a test reads the built files and proves it). `three` is an optional peer dependency (`>=0.174.0`).
- Body only. The island's 14 worn items are not in this package: the builder takes them through the `WornAdapter` interface, and a later version (0.2.0) adds
  the item art. A player's item ids are in the sign-in answer.
