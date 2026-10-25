# Nanoterra sign-in ticket: the prompt

```
Take players who press Play in Nanoterra signed in on this static game (no server of its own).
Use the npm package @nano133/ticket and follow its SPEC step by step:
https://nano133.com/build/nanoterra
Set "signin": "ticket" in nano-game.json. Call readTicket() once when the page loads, ask
"Sign in as <name>? Continue / Not me" before treating the player as that name, and show the name.
Never give a sale, a prize or a score on a ticket alone. Put the name in the page as text.
```
