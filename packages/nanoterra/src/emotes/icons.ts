// Where the pictures of Nanoterra's emotes are: one strip of eleven 128 px squares (1408 x 128, WebP, 34 kB), in EMOTES' order. It ships in src/ and
// is found from this file's own address, which is the same two folders below the package in src/ and in dist/. A bundler that understands
// `new URL("…", import.meta.url)` (Vite, Rollup, webpack 5, esbuild with a loader) copies it and gives it a hashed name; plain ESM in a browser
// fetches it from the package. Only the address is made here: the picture loads when the wheel first shows it. A game may pass its own address
// (the wheel's `icons`), e.g. Vite's `import icons from "@nano133/nanoterra/emotes/icons.webp?url"`.

export const EMOTE_ICONS_URL: string = new URL("../../src/emotes/icons.webp", import.meta.url).href;
