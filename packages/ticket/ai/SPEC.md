# Nanoterra sign-in ticket: implementation spec

Package: `@nano133/ticket` (0.1.0 or later). For a game on a **static site** (no server of its
own). A game with a server uses the code exchange instead (the game starter has it).

## 0. Decide (ask)

1. Does the game have a server? If yes, stop: use the code exchange. A ticket cannot prove who
   is at the other end, so a server must not trust it.
2. What the game does with the player's name and character: show them (fine), or give something
   of value (a sale, a prize, a score). **Never give anything of value on a ticket alone.**

## 1. Turn it on

In `nano-game.json` set `"signin": "ticket"`. Nothing else is made at nano133.com (no secret).

## 2. Read the ticket when the page loads

```ts
import { readTicket } from "@nano133/ticket";
const result = await readTicket();
```

Call it once. It takes the ticket out of the address bar first. If `result.ok` is false the
player is a guest (`result.reason` is `"none"` for a plain visit).

## 3. Ask before you sign the player in

Show "Sign in as *name*? Continue / Not me". Anyone can send a link that holds their own ticket.
Until Continue, the player is a guest. Put the name in the page as text, never as HTML.

## 4. Use the details

`result.ticket`: `username`, `address`, `look` (five `#rrggbb` colours), `items` (catalogue ids).
Keep them in memory or `sessionStorage`. Show the name wherever the player is signed in.

## Checks

- A plain visit (no `#nanoterra=`) makes no network call and shows no card.
- A ticket for another origin, a changed ticket and an old ticket each give a guest.
- The address bar has no ticket after the page loaded.
- No sale, prize or score depends on the ticket.
