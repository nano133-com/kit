# @nano133/ticket

Stage: Pre-alpha. What this means: https://nano133.com/stages

Read and check a Nanoterra sign-in ticket, in the player's browser. It is for a
game on a **static site**: no server, no secret. A player who is signed in at
nano133.com presses Play in Nanoterra, agrees once on a card, and arrives at your
game with a signed ticket after the `#` of its address. This package checks the
ticket and gives you the player's **username**, **Nano address** and
**character** (the look and the cosmetics the player owns).

If your game has a server, use the code exchange instead (the
[game starter](https://github.com/nano133-com/nano-game-starter) does): a server that holds
a secret can know who is at the other end. A ticket cannot.

```ts
import { readTicket } from "@nano133/ticket";

const result = await readTicket();
if (result.ok) {
  const { username, address, look, items } = result.ticket;
  // Ask first: "Sign in as {username}? Continue / Not me" (see "Rules" below).
}
// result.ok === false: a guest. result.reason says why ("none" is a plain visit).
```

`readTicket()` does four things, in this order:

1. Finds `#nanoterra=<ticket>` in the page's address. With none, it answers
   `{ ok: false, reason: "none" }` and does nothing else (no network call).
2. **Takes the ticket out of the address bar** (`history.replaceState`), so a
   reload, a copied link, a screenshot or a bookmark never carries it.
3. Reads the public keys from `https://nano133.com/api/nanoterra/keys` (once for
   the session, and again if a ticket names a key it does not know).
4. Checks the signature, the kind, that the ticket is **for this origin** and that
   it has not run out. It never throws.

Call it once, when the page loads.

## Rules

- **A ticket proves nothing to your server.** The ticket sits in an address bar:
  anyone who sees it can use it for two minutes. Use it to show the player's name
  and character. **Never give a sale, a prize or a score on a ticket alone.**
- **Ask before you treat the player as that name.** Anyone can send a link that holds
  their *own* ticket (login CSRF). Show "Sign in as *name*? Continue / Not me" and
  keep the player a guest until Continue.
- **Show the name** wherever the player is "signed in", and say whose account it is
  before a payment.
- **The username comes from another site.** Put it in the page as text, never as HTML.
- A guest is a normal visit. Every refusal (`reason`) means "play as a guest".

## What you get

```ts
type Ticket = {
  username: string;
  address: string; // the whole Nano address; also the player's id
  look: { skin: string; hair: string; shirt: string; pants: string; shoes: string }; // "#rrggbb"
  items: string[]; // the Nanoterra cosmetics the player owns, in the character's slots
  game: string; // your game's id at nano133.com
  audience: string; // the origin the ticket is for
  issuedAt: number; // ms since 1970
  expiresAt: number;
  id: string;
};
```

The character is the same one `@nano133/character` draws in Three.js.

## Refusals

| `reason` | Meaning |
|---|---|
| `none` | no ticket in the address: a plain visit |
| `unsupported` | this browser has no Ed25519 in Web Crypto (Chrome 137, Safari 17, Firefox 129 and later have it) |
| `malformed` | not a ticket |
| `keys` | the public keys could not be read (offline, or nano133.com did not answer) |
| `unknown-key`, `signature` | signed with a key that is not nano133.com's, or the signature does not hold |
| `wrong-kind` | signed right, but not a version 1 ticket from nano133.com |
| `audience` | a ticket for another origin |
| `expired`, `early`, `life` | the time does not hold. A player's clock may be a minute off, either way |

## Options

```ts
readTicket({
  keys, // pin the public keys: no fetch at all
  keysUrl, // another place for the keys (tests)
  audience, // the origin to expect; default: this page's own
});
```

`verifyTicket(token, { audience, keys })` checks a ticket you already hold, and
`fetchKeys()`, `ticketFromHash(hash)` and `hashWithoutTicket(hash)` are the
parts.

## The format

For any language. A ticket is `base64url(JSON claims) "." base64url(signature)`: an Ed25519 signature over the
ASCII of the first part, made with the key whose `kid` the claims name.

```json
{ "v": 1, "typ": "ticket", "iss": "nano133.com", "kid": "fe812c12f3ab4ce6", "aud": "https://game.example",
  "game": "gem-island", "sub": "nano_3i7m…", "name": "Ann",
  "look": { "skin": "#f2c29b", "hair": "#3a2a1e", "shirt": "#2a9df4", "pants": "#1e2a4a", "shoes": "#ffffff" },
  "items": ["hub.sun-hat"], "iat": 1800000000, "exp": 1800000120, "jti": "AAAAAAAAAAAAAAAA" }
```

`GET https://nano133.com/api/nanoterra/keys` answers `{ "keys": [{ "kid", "kty": "OKP", "crv": "Ed25519", "x", "alg": "EdDSA", "use": "sig" }] }`
and may be read from any page. A ticket lives two minutes (`exp - iat` is 120; a longer life is refused).

## Turn it on

Your `nano-game.json` says `"signin": "ticket"`. Nanoterra's Play key then sends signed-in players to
your play address with a ticket. A player who has not agreed, or who plays as a guest, arrives with no ticket.

MIT license.
