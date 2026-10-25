# Changelog

## 0.1.0

- First version (Pre-alpha). The rules of `looks.json` from the game starter, moved
  here so a game and its Shelf screen check the same words: `lookProblems` (every
  mistake), `checkLooks` (the first, as an `Error`), `HATS`, `usdText`.
- `removalProblems` and `diffLooks`: what a new list does to the players who own a
  look, and what changed between two lists.
- `looksJson` writes the file as the starter does, one look on each line, and
  `slugId` makes an id from a name.
- `PRICE_LADDER`: nano133.com's six steps from 1¢ to $1, with `rungOf` and `priceText`.
- **Fix:** a price with whole cents is good. The starter's check refused $0.07,
  $0.14, $0.28, $0.29, $0.55 to $0.58, $1.09 to $1.16 and others, because
  `Math.round(x * 100) === x * 100` is false for them. `wholeCents` replaces it.
- No dependencies, no network, no file access.
