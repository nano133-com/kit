# @nano133/looks

Stage: Pre-alpha. What this means: https://nano133.com/stages

The looks of a Nanoterra game: the rules of `looks.json`, the price ladder, and
what a change does to the players who own a look. It is the code behind the
**Shelf** screen in the [game starter](https://github.com/nano133-com/nano-game-starter)'s
`/admin`, and you can use it in any game that sells looks for Nano (XNO).

It has **no dependencies**. It runs in a Worker, a browser and Node, and it never
makes a network call. **It never takes part in a sale:** nothing here sends a
price, a sale or a player to nano133.com. Your game is the seller.

```ts
import { checkLooks, removalProblems, looksJson, PRICE_LADDER } from "@nano133/looks";

const looks = checkLooks(JSON.parse(fileText)); // throws an Error with the first mistake in plain words
const problems = removalProblems(looks, newLooks, ownedLookIds); // a look that a player owns must stay
const text = looksJson(newLooks); // the new looks.json: one look on each line
```

## What a look is

```ts
type Look = {
  id: string; // 1 to 40 lowercase letters, digits or dashes: "mint-cap"
  name: string; // 1 to 40 characters
  priceUsd: number; // US dollars, at most 2 decimals; 0 is the free look
  change: { body: string; hat?: "cap" | "beanie" | "crown" | "tophat"; hatColor?: string }; // colours are "#rrggbb"
};
```

The rules (the same as the starter's `AGENTS.md`):

- A look only changes how the character looks. **It never changes a score, a speed or a rule.**
- Every look shows its price before the player buys. **Nothing is random: no loot boxes, no mystery looks.**
- The list has **at least one free look** (`priceUsd: 0`): every player starts with it.
- **Never change or remove the `id` of a look that someone owns.** Owned looks are kept by id. To stop selling a
  look, keep it in the file.

## The API

| | |
|---|---|
| `lookProblems(raw)` | Every mistake in a list of looks, as `{ look, field, message }`. An empty array is a good list. |
| `checkLooks(raw)` | The looks, or an `Error` with the first mistake in plain words. |
| `removalProblems(before, after, owned)` | The looks in `before` that a player owns (`owned` is a set of ids) and that `after` leaves out. |
| `diffLooks(before, after)` | `{ added, removed, changed }` by id. A new order is not a change. |
| `looksJson(looks)` | The text of `looks.json`, one look on each line, as the starter writes it. A change of one look is a change of one line. |
| `slugId(name, taken)` | A free id for a name: `"Mint Cap"` gives `mint-cap`, then `mint-cap-2`. |
| `PRICE_LADDER`, `rungOf(usd)`, `priceText(usd)` | The six steps nano133.com uses, from 1¢ to $1, and a price as a page writes it (`25¢`, `$1.10`). |
| `usdText(usd)`, `wholeCents(usd)`, `HATS` | `"$0.25"`; whether a price has no fraction of a cent; the hats. |

### The price ladder

| Step | Price | For |
|---|---|---|
| dye | 1¢ | a colour |
| charm | 2¢ | a small mark or a badge |
| piece | 5¢ | one worn thing, like a hat or a scarf |
| statement | 25¢ | a bigger piece that people notice |
| set | 50¢ | a few pieces that go together |
| outfit | $1 | a whole look |

The ladder is a suggestion. Any price with at most 2 decimals, up to $1000, is good.

## A fix that you may notice

The starter's old check, `Math.round(x * 100) === x * 100`, refused prices such as $0.07, $0.29, $0.57 and $1.10
because of floating point. `wholeCents` accepts every price in whole cents, and the tests check each one up to $1000.

## What it does NOT do

- It does not read or write a file, and it does not call GitHub. The Shelf screen shows the new text and you commit it.
- It does not sell, price or deliver anything. Payments are your checkout's job
  ([`@nano133/checkout`](../checkout)).
- It does not draw the looks. The starter's character does that.

## Build and test

```
npm install
npm test -w @nano133/looks
```

MIT license.
