# Looks: implementation spec

Package: `@nano133/looks` (0.1.0 or later). For a game that sells looks (a colour, a hat) for
Nano. The game starter already uses it. **It never takes part in a sale.**

## 0. Decide (ask)

1. Is the game the seller? It must be. The looks, the prices and the payments stay in the
   creator's own account. Never send them to another site.
2. Does any look change a score, a speed or a rule, or depend on chance? If yes, stop: the
   rules of a look forbid both.

## 1. Check looks.json when the game starts

```ts
import { checkLooks } from "@nano133/looks";
export const LOOKS = checkLooks(rawLooksJson); // throws with the first mistake in plain words
```

Use `lookProblems(raw)` when you want every mistake (a screen, a test).

## 2. Before a change goes live

```ts
import { diffLooks, lookProblems, removalProblems, looksJson } from "@nano133/looks";
const problems = [...lookProblems(next), ...removalProblems(current, next, ownedLookIds)];
if (problems.length) /* show problems[i].message and stop */;
const changes = diffLooks(current, next); // show: added, removed, changed
const text = looksJson(next); // the new looks.json
```

`ownedLookIds` is every look id that any player owns (the game's `owned` table).

## 3. Rules to keep

- One free look (`priceUsd: 0`) at least.
- Never change or remove the id of a look that someone owns. To stop selling it, keep it in the file.
- Prices in US dollars with at most 2 decimals. The server reads the price from the file: the browser never decides it.
- No random look, no loot box, no look that changes a score.
- Write the file with `looksJson` so that a change of one look is a change of one line.
