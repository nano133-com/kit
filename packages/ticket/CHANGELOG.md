# Changelog

## 0.1.0

First release (Pre-alpha): `readTicket`, `verifyTicket`, `fetchKeys`, `ticketFromHash`,
`hashWithoutTicket`. One ticket is pinned byte for byte in the tests, and nano133.com's own
test pins the same one.
The key list is read with a 5 second limit (`KEYS_TIMEOUT_MS`), so a slow nano133.com never holds a game's first screen. A ticket's `look` is a clean copy of its five colours.
