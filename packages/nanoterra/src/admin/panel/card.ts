// A card of the game's own for the admin panel's Settings tab (`mountAdmin`'s `cards`). Its own file, so a card made elsewhere (the owner's passkeys, in
// "@nano133/nanoterra/admin-signin/panel") names the type without reaching the whole panel.

/** A card of the game's own in the Settings tab: its element, made once, and what to do each time the owner signs in (read its data again). */
export type AdminCard = { el: HTMLElement; refresh?: () => void | Promise<void> };
