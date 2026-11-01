---
name: add-options
description: Add an options menu (settings) to a Nanoterra game with @nano133/nanoterra/options - the game's settings as data with defaults for each device (phone, tablet, desktop, reduced motion), kept in the player's browser, common settings (volumes, camera speed, invert look, stick side, less motion, quality, frame rate), key bindings, and a ready Options key and panel with Basic and Advanced tabs. Use when the user asks for settings, options, a pause menu's options, volume sliders, key bindings or less motion in a game made with the Nanoterra kit or the game starter.
---

# Add an options menu

Follow step 10 of the package's `ai/SPEC.md` (https://nano133.com/build/nanoterra, or
`node_modules/@nano133/nanoterra/ai/SPEC.md`) and the README section "The options menu".

1. **Ask** which settings the game can really honour, and whether the menu opens from the
   kit's gear key or from the game's own pause menu.
2. Make one store when the game starts: `createOptions({ game, defs })`, with
   `common(...)` for the common settings and the game's own defs. Keep labels short.
3. Read values with `get(key)` and apply changes at once in `subscribe`. Never keep a
   second copy of a setting in the game's own storage.
4. Mount the panel with the stylesheet `@nano133/nanoterra/options/style.css`:
   `mountOptions(el, store)`, or `{ key: false }` and `open()` from the pause menu.
5. With "Less motion": honour it in the game's code, and call
   `reflectOptions(store, ["reducedMotion"])` for the page's CSS.
6. A later part adds a section: `store.add(optionSection("name", defs, "Heading"))`.
7. Test: a change holds after a reload; a value set back to its default is not kept;
   phone upright, phone sideways, tablet and desktop; the tabs by touch.

A setting never changes a rule, a score or a payment. Finish with the SPEC's step 10 check.
