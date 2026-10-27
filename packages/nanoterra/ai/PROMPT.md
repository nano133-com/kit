# Nanoterra for a game: the prompt

```
Add Nanoterra to this game with the npm package @nano133/nanoterra and follow its ai/SPEC.md
step by step: https://nano133.com/build/nanoterra
Show the player's own Nanoterra character in the Three.js scene with createCharacter from
@nano133/nanoterra/character: add its object to the scene and call update(dt, { speed, airborne,
verticalSpeed }) once each frame with the game's own numbers (dt in seconds). Keep the choice
between the Nanoterra character and the game's own in ONE place (the starter's game.config.json,
"character": "nanoterra" or "own"). Use the same collider, jump and reach for every body.
If this game is a static site, read the sign-in ticket once with readTicket from
@nano133/nanoterra/ticket, ask "Sign in as <name>? Continue / Not me" first, and pass
ticket.record and ticket.look to createCharacter. Never give a sale, a prize or a score on a ticket
alone. Check every record with recordProblem and every look with isLook before it reaches the
character. Call dispose when a character leaves the game. Ask me which quality (high or low) to use.
```
