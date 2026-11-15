// The screens of Sign in from Nanoterra: "Sign in as <name>?" (Continue / Not me), "Switch to <name>?" (Switch / Stay) and the pages of a sign-in that
// did not work. Markup only: no check, cookie or form rule lives here (./core.ts sets the cookies and reads the press). The markup and the words are the
// game starter's (src/worker/nanoterra.ts, origin/main 5409723), so a game's own stylesheet for them (public/nanoterra.css: `.nt`, `.nt-logo`,
// `.nt-card`, `.nt-guard`, `.nt-go`, `button.primary`) keeps working unchanged. The package's own stylesheet for them is "./style.css"
// ("@nano133/nanoterra/connect/style.css", the `--n133-*` tokens).
//
// A game changes them in three ways, from small to whole: its words (`words`, `errors`), its stylesheet and head tags (`stylesheets`, `head`,
// `logoLabel`), or the whole page (`render`), which gets the escaped parts and the kit's own page. Every name in a screen comes from another site:
// it is escaped here, and `render` gets it escaped. Never change the forms' fields, actions or methods: they belong to the sign-in's safety.

/** Every character that could start markup is written as a numeric entity (the starter's). */
export const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** An address as the player can compare it: the start and the end. */
export const shortAddress = (a: string) => `${a.slice(0, 11)}…${a.slice(-6)}`;

/**
 * The words of the two screens. `{name}` is the name Nanoterra sent, `{current}` the account signed in here (its name, or its short address),
 * `{address}` the short address in a <code>; `**x**` is strong text. Everything else is plain text: it is escaped.
 */
export type ConnectWords = {
  signInTitle: string;
  signInLead: string;
  signInGuard: string;
  signInKey: string;
  notMeKey: string;
  switchTitle: string;
  switchLead: string;
  switchKey: string;
  stayKey: string;
  guestKey: string;
};

/** The pages of a sign-in that did not work: a title and a line each (plain text). */
export type ConnectErrorKey = "off" | "notSetUp" | "setupWrong" | "tooMany" | "badCode" | "notHere" | "refused" | "notOwnPage" | "ranOut" | "changed" | "used";
export type ConnectErrorWords = Record<ConnectErrorKey, { title: string; text: string }>;

/** The starter's words, exactly. */
export const CONNECT_WORDS: ConnectWords = {
  signInTitle: "Sign in as {name}?",
  signInLead: "Nanoterra says you are **{name}**, with the address {address}.",
  signInGuard: "Press **Continue** only if you just pressed Play in Nanoterra yourself. If someone sent you this link, press **Not me**.",
  signInKey: "Continue as {name}",
  notMeKey: "Not me",
  switchTitle: "Switch to {name}?",
  switchLead: "You are signed in here as **{current}**.",
  switchKey: "Switch to {name}",
  stayKey: "Stay as {current}",
  guestKey: "Play as a guest",
};

/** The starter's pages, exactly. */
export const CONNECT_ERRORS: ConnectErrorWords = {
  off: { title: "Sign-in from Nanoterra is off", text: "This game has turned off sign-in from Nanoterra. You can play as a guest." },
  notSetUp: { title: "Nanoterra sign-in is not set up", text: "This game has not finished setting up sign-in from Nanoterra yet." },
  setupWrong: { title: "Nanoterra sign-in is set up wrong", text: "This game's sign-in from Nanoterra needs a fix by its owner. You can play as a guest." },
  tooMany: { title: "Too many tries", text: "Wait a minute, then press Play in Nanoterra again." },
  badCode: { title: "That sign-in did not work", text: "The sign-in code is missing or not valid. Press Play in Nanoterra again." },
  notHere: { title: "That sign-in did not start here", text: "It did not start in this browser, or it started more than 10 minutes ago. Press Play in Nanoterra again." },
  refused: { title: "That sign-in did not work", text: "The sign-in code was refused or has run out. Press Play in Nanoterra again." },
  notOwnPage: { title: "That sign-in did not work", text: "The request did not come from this game's own page. Press Play in Nanoterra again." },
  ranOut: { title: "That sign-in has run out", text: "It is more than 5 minutes since you pressed Play, or it did not start in this browser. Press Play in Nanoterra again." },
  changed: { title: "That sign-in changed", text: "Another sign-in started in this browser after this screen was shown. Press Play in Nanoterra again." },
  used: { title: "That sign-in was used", text: "This sign-in was used or cancelled already. Press Play in Nanoterra again." },
};

/**
 * What `render` gets: which screen, its status, the kit's whole page (`page`), and its parts as ESCAPED html (`html`). A game that draws its own page
 * puts the parts in its own markup; for "signin" and "switch" it must keep `html.confirm` and `html.cancel` (the two forms, with the `bind` field) or
 * build forms with exactly the same method, action and fields (`bind`, `actions`).
 */
export type ConnectScreen = {
  kind: "signin" | "switch" | "error";
  status: number;
  /** The error page's key (kind "error" only). */
  error?: ConnectErrorKey;
  /** The kit's own page for this screen. */
  page: string;
  /** The `bind` field's value (32 hex digits; "signin" and "switch" only). */
  bind?: string;
  actions: { confirm: string; cancel: string };
  /** Every value is escaped html: safe to put in markup as it is. */
  html: { title: string; name?: string; current?: string; address?: string; lead?: string; guard?: string; text?: string; confirm?: string; cancel?: string; guest: string };
};

/** How the screens look: the game's words, stylesheets and head tags, or its whole page. */
export type ConnectScreens = {
  words?: Partial<ConnectWords>;
  errors?: Partial<ConnectErrorWords>;
  /** The stylesheets the pages link, this site's own files (default: the starter's "/nanoterra.css"). The page's policy allows only this site's files. */
  stylesheets?: string[];
  /** Extra tags for the head, written by the game (for example a font's preload). Never put a value from a request or from Nanoterra here. */
  head?: string;
  /** The logo's name for a screen reader (`.nt-logo` is a CSS picture): plain text. Without it the logo is hidden from screen readers. */
  logoLabel?: string;
  /** The game's own page for a screen, or null for the kit's. */
  render?: (screen: ConnectScreen) => string | null | undefined;
  /**
   * The pages' Content Security Policy. The default allows this site's own stylesheets, pictures and fonts, no script at all, forms to this site only
   * and no frame around the page. A game whose own page needs more (an inline style) sets its own here.
   */
  csp?: string;
};

/** The pages' default policy: no script, no frame around them (a frame could hide a press of Continue), forms to this site only. */
export const CONNECT_CSP = "default-src 'none'; style-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

/** The game's words (plain text) as html: escaped, `**x**` as strong, and the placeholders filled with values that are already escaped html. */
function fill(word: string, values: Record<string, string>): string {
  return escapeHtml(word)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\{(name|current|address)\}/g, (_, k: string) => values[k] ?? "");
}

/**
 * The frame of every page of this flow (the confirm screen and the error pages), so they share one look: the game's stylesheet (the starter's
 * public/nanoterra.css, or this package's style.css), whose tokens give them the game's colours, font, keys and an optional picture and logo (the logo
 * is a CSS picture on `.nt-logo`, hidden until the stylesheet shows it, so the page holds no <img>). Markup only: no check, cookie or form lives here.
 */
function frame(s: ConnectScreens, title: string, card: string): string {
  const links = (s.stylesheets ?? ["/nanoterra.css"]).map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("");
  const logo = s.logoLabel ? `role="img" aria-label="${escapeHtml(s.logoLabel)}"` : 'aria-hidden="true"';
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">${s.head ?? ""}${links}<title>${title}</title><main class="nt"><div class="nt-logo" ${logo}></div><div class="nt-card">${card}</div></main>`;
}

const ACTIONS = { confirm: "/nanoterra/confirm", cancel: "/nanoterra/cancel" };
const words = (s: ConnectScreens): ConnectWords => ({ ...CONNECT_WORDS, ...s.words });
const guestLink = (s: ConnectScreens, after: string) => `<a href="${escapeHtml(after)}">${fill(words(s).guestKey, {})}</a>`;

/** The headers of a page of this flow: never kept, framed or sniffed, with its policy. */
export function pageHeaders(s: ConnectScreens, referrer: "no-referrer" | "same-origin"): Headers {
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": referrer,
    "Content-Security-Policy": s.csp ?? CONNECT_CSP,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
  });
}

const drawn = (s: ConnectScreens, screen: ConnectScreen) => s.render?.(screen) ?? screen.page;

/** A page for a sign-in that did not work, with a way into the game as a guest. */
export function errorHtml(s: ConnectScreens, key: ConnectErrorKey, status: number, after: string): string {
  const e = { ...CONNECT_ERRORS[key], ...s.errors?.[key] };
  const title = fill(e.title, {});
  const text = fill(e.text, {});
  const guest = guestLink(s, after);
  const page = frame(s, title, `<h1>${title}</h1><p>${text}</p><p class="nt-go">${guest}</p>`);
  return drawn(s, { kind: "error", status, error: key, page, actions: ACTIONS, html: { title, text, guest } });
}

/** The forms of a screen that waits for a press. The `bind` field ties the press to the cookie this screen was made with (a hash, never the token). */
const confirmForm = (bind: string, label: string) => `<form method="post" action="${ACTIONS.confirm}"><input type="hidden" name="bind" value="${bind}"><button type="submit" class="primary">${label}</button></form>`;
const cancelForm = (label: string) => `<form method="post" action="${ACTIONS.cancel}"><button type="submit">${label}</button></form>`;

/** "Sign in as <name>?": the screen between the callback and the session. The name comes from another site: it is escaped. */
export function signInHtml(s: ConnectScreens, username: string, address: string, bind: string, after: string): string {
  const w = words(s);
  const values = { name: escapeHtml(username), address: `<code>${escapeHtml(shortAddress(address))}</code>` };
  const title = fill(w.signInTitle, values);
  const lead = fill(w.signInLead, values);
  const guard = fill(w.signInGuard, values);
  const confirm = confirmForm(bind, fill(w.signInKey, values));
  const cancel = cancelForm(fill(w.notMeKey, values));
  const page = frame(s, title, `<h1>${title}</h1><p>${lead}</p><p class="nt-guard">${guard}</p>${confirm}${cancel}`);
  return drawn(s, { kind: "signin", status: 200, page, bind, actions: ACTIONS, html: { title, name: values.name, address: values.address, lead, guard, confirm, cancel, guest: guestLink(s, after) } });
}

/**
 * "Switch to <name>?": the screen of a press when this browser is signed in here as ANOTHER account (`current`: that account's name, or its short
 * address). Switch is Continue (POST /nanoterra/confirm: the new session), Stay is Not me (POST /nanoterra/cancel: the session here stays), with the same
 * cookie, `bind` field and once-only rules. Both names are escaped.
 */
export function switchHtml(s: ConnectScreens, username: string, current: string, bind: string, after: string): string {
  const w = words(s);
  const values = { name: escapeHtml(username), current: escapeHtml(current) };
  const title = fill(w.switchTitle, values);
  const lead = fill(w.switchLead, values);
  const confirm = confirmForm(bind, fill(w.switchKey, values));
  const cancel = cancelForm(fill(w.stayKey, values));
  const page = frame(s, title, `<h1>${title}</h1><p>${lead}</p>${confirm}${cancel}`);
  return drawn(s, { kind: "switch", status: 200, page, bind, actions: ACTIONS, html: { title, name: values.name, current: values.current, lead, confirm, cancel, guest: guestLink(s, after) } });
}
