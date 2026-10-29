// Held input that a page can no longer trust, and a pause for when the player leaves. For a game that a player walks in with keys, a thumb stick
// or a drag, in the browser.
//
// THE FAULT: the browser sends a key's "up" only to the window that has the focus. A key that is down when the player leaves the page (another
// tab, another window, a pop-up, Cmd+Tab, another app on a phone) never sends its "up" here. A game that keeps a "held keys" set keeps the key,
// and the character walks on by itself when the player comes back (nano133.com's own island and rooms had it: "my character is now moving by
// himself"). The ways that were found:
//   - the tab or the window changes while a key is down (Cmd+Tab, Ctrl+Tab, Cmd+a number, a click elsewhere)
//   - on a Mac, a key that is released while Cmd is down sends NO keyup (Cmd+Shift+4 for a picture, Cmd+C, ...)
//   - a menu of the browser or the system opens (a right click, a long press) and takes the keyup
//   - a pointer of a thumb stick ends where the page does not get it (the edge of the screen, a system gesture)
//   - ONE MORE REPEAT of the held key arrives after the page was let go, or the repeats go on when the player comes back: it puts the key back
//     into the held set, and its keyup went to the other window. A repeat only says that a key was down at some time.
//
// `releaseWhenLost(release)` calls your `release` at each of them, and drops key repeats after a leave until a key goes down again. `pauseWhenLeft(pause)`
// calls your `pause` when the player really left (a free round stops its clock and shows a Resume key). No package: plain browser events.
//
// A ROUND THAT COSTS MONEY must not pause: its deadline must not move. Keep `releaseWhenLost` (the character always stops) and leave `pauseWhenLeft` out.

type Listens = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Calls `release` each time what is held may be wrong. In it, clear every held key, thumb stick and drag, and any jump or tool that a key press queued.
 * `keysOnly`, when given, is called when a menu opens (a right click): a menu takes a keyup, but on a touch screen a long press also asks for a menu,
 * and a thumb that rests on a stick must not lose its walk for that. A menu that your page stopped (`preventDefault`) did not open: nothing is let go.
 *
 * After a leave (blur, focus, page hide, the tab hidden or shown), a key REPEAT does not reach your key handlers until a key goes down for the first
 * time (`repeat` false). The player presses the key again to walk on. A menu is no leave: the held key that a menu took comes back by its repeat.
 * The repeat is stopped in the capture phase (`stopImmediatePropagation`), so register your own key handlers as usual: they never see it.
 *
 * Returns the function that takes the listeners away. `win` and `doc` are given in a test.
 */
export function releaseWhenLost(release: () => void, keysOnly?: () => void, win: Listens = window, doc: Listens & { hidden?: boolean } = document): () => void {
  // Set by each leave; a key that goes down (not a repeat) ends it. While it is set, repeats do not reach the page's handlers.
  let stale = false;
  const lost = () => {
    stale = true;
    release();
  };
  const hidden = () => {
    // Either way the page was left for a while: a repeat that comes now may belong to a key that went up elsewhere.
    stale = true;
    if (doc.hidden !== false) release();
  };
  // Cmd (Meta) going down or up: each key that is released in between sends no keyup. The OS key on Windows is the same key.
  const meta = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.key === "Meta" || k.key === "OS" || k.metaKey) release();
    if (e.type !== "keydown") return;
    if (!k.repeat) stale = false;
    else if (stale) e.stopImmediatePropagation();
  };
  // At the window, after your own handlers: a handler that stopped the menu has done so by now.
  const menu = (e: Event) => {
    if (!e.defaultPrevented) keysOnly?.();
  };
  const windowEvents = ["blur", "focus", "pagehide"] as const;
  for (const type of windowEvents) win.addEventListener(type, lost);
  win.addEventListener("contextmenu", menu);
  doc.addEventListener("visibilitychange", hidden);
  // Capture: before your key handler, which then leaves a key with Cmd out (`swallowsKeyup`), and which a stale repeat never reaches.
  win.addEventListener("keydown", meta, true);
  win.addEventListener("keyup", meta, true);
  return () => {
    for (const type of windowEvents) win.removeEventListener(type, lost);
    win.removeEventListener("contextmenu", menu);
    doc.removeEventListener("visibilitychange", hidden);
    win.removeEventListener("keydown", meta, true);
    win.removeEventListener("keyup", meta, true);
  };
}

/** A keydown whose keyup may never come (Cmd is down, or it is the Cmd key): it must not go into your held set. */
export const swallowsKeyup = (e: { metaKey?: boolean; key?: string }) => !!e.metaKey || e.key === "Meta" || e.key === "OS";

/**
 * Calls `pause` when the player leaves: the tab or the window is hidden (`visibilitychange`: another tab, a minimized window, a locked phone,
 * another app on a phone), or the window loses the focus to another window (a real `blur`: not a script's, and not a focus that moves inside
 * your page into a dialog or a field). It may call `pause` twice for one leave (a blur, then the tab hiding): make `pause` safe to call twice.
 * Show a Resume key and stop your clock in it; start nothing again until the player taps Resume. Returns the function that takes the listeners away.
 * `win` and `doc` are given in a test.
 */
export function pauseWhenLeft(pause: () => void, win: Listens = window, doc: Listens & { hidden?: boolean; hasFocus?: () => boolean } = document): () => void {
  const hidden = () => {
    if (doc.hidden) pause();
  };
  const blur = (e: Event) => {
    if (!e.isTrusted || doc.hasFocus?.()) return;
    pause();
  };
  win.addEventListener("blur", blur);
  doc.addEventListener("visibilitychange", hidden);
  return () => {
    win.removeEventListener("blur", blur);
    doc.removeEventListener("visibilitychange", hidden);
  };
}
