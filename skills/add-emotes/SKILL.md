---
name: add-emotes
description: Add emotes to a Nanoterra game with @nano133/nanoterra/emotes - Nano Island's eleven emotes (Wave, Cheer, Clap, Dance, Bow, Shrug, Laugh, Point, Sit, Facepalm, Spin) on the kit's character, an emote wheel of eight that the player picks (tap or hold-and-slide, Edit, B and 1 to 8), the game's own animations on the same wheel, other players' emotes in a multiplayer game, and the admin's "Allow Nanoterra emotes" switch. Use when the user asks for emotes, an emote wheel, dances, waves or gestures in a game made with the Nanoterra kit or the game starter.
---

# Add emotes

Follow step 11 of the package's `ai/SPEC.md` (https://nano133.com/build/nanoterra, or
`node_modules/@nano133/nanoterra/ai/SPEC.md`) and the README section "Emotes".

1. **Ask** which emotes the game offers: Nanoterra's (they need the kit's character), the
   game's own animations, or both. Nanoterra's follow the admin's `emotes` setting ("on" by
   default); read it with `loadGameSettings` on the server.
2. With the kit's character: `createEmotes(hero)` once. The frame loop does not change:
   `hero.update(dt, motion)` plays the emote over the walk.
3. Mount the wheel: `mountEmotes(el, { game, onPlay, onOpen: () => void loadEmotes(),
   nanoterraEmotes: settings.emotes })`, with `@nano133/nanoterra/emotes/style.css`. Never
   import the clips yourself: they must stay out of the game's first load.
4. Multiplayer: send `emoteMessage(e)` from `onEmote` (and again when a loop fires again);
   on the other side `playRemote(character, { id: readEmoteMessage(m) })`. A relay server
   checks the id against `EMOTES`.
5. With an options menu: add `EMOTE_OPTIONS` to the store and pass it as `options`.
6. Test on a phone: a tap, a hold-and-slide, Edit, a reload; a walk ends Dance.

An emote is display only: never a score, a rule or a payment. Finish with the SPEC's step 11 check.
