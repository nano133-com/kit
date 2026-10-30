// The Friends key and panel of a game: `mountFriends(element, options)`. Plain DOM, no framework, no Three.js. The mode is the admin's friends
// setting (GET {admin}/game gives it as `friends`; a game with no admin passes its own word):
//
//   "nanoterra"  the key opens the nano133 window (./window.ts, contract v1). The window is made at once and kept while the panel is closed: it holds
//                the player's live connection, which tells their friends "Playing <game>" and keeps the badge true. Closed, it is hidden (not shown,
//                off the screen, out of the tab order), never removed or `display: none`. `destroy()` removes it. The badge shows the requests
//                (the thing to do) when there are any, else the friends online, in another colour.
//   "own"        the key opens the game's own list, from the handler of "@nano133/nanoterra/friends" at `base`: the view every 20 s while open (every
//                60 s while closed, for the badge), a pulse every 45 s with this tab's lease, and a "leave" pulse when the page goes away.
//   "off"        nothing is drawn.
//
// The panel is phone first: a sheet from the bottom on a phone held upright, from the side on a wide or sideways screen; every key is 44 px.

import { ApiError, createApi, type Api } from "../../admin/panel/api.js";
import { h } from "../../admin/panel/dom.js";
import { icon } from "../../admin/panel/icons.js";
import type { FriendRow, FriendView } from "../types.js";
import { readWindowMessage, toWindow, whereText, windowUrl, type ToWindow } from "./window.js";

export type FriendsMode = "nanoterra" | "own" | "off";

export type FriendsMountOptions = {
  mode: FriendsMode;
  /** The game's id on Nanoterra (its listing's id): the window shows the player as "Playing" it. */
  game: string;
  /** nano133's origin. Default "https://nano133.com". */
  origin?: string;
  /** The handler's path for the game's own friends. Default "/friends". */
  base?: string;
  /** Where the player is now, in the game's own words ("Level 2", a room): friends see it. Plain text, at most 64 characters. Change it with `setWhere`. */
  where?: string | null;
  /**
   * The player chose to join a friend. "nanoterra": `target` is the friend's https address (the kit has asked the player already) and there is no
   * `friend` (the window sends no name); with no `onJoin` the page goes there. "own": `target` is the `where` of the friend's invite, for the game to
   * move the player, and `friend` names them (with no `onJoin`, there is no Join key).
   */
  onJoin?: (target: string, friend?: { name: string }) => void;
  /** The `fetch` to use (default: the page's). */
  fetch?: typeof fetch;
  /** Asks the player a yes or no question (default: `window.confirm`). */
  confirm?: (question: string) => boolean;
};

export type MountedFriends = {
  /** Sets where the player is (friends see it). Null: no place. */
  setWhere(where: string | null): void;
  open(): void;
  close(): void;
  /** Removes the key, the panel and the window, and stops every timer. */
  destroy(): void;
};

export const FRIENDS_TIMING = { viewOpenMs: 20_000, viewClosedMs: 60_000, pulseMs: 45_000 } as const;

const NOTHING: MountedFriends = { setWhere() {}, open() {}, close() {}, destroy() {} };

let mounts = 0;

export function mountFriends(root: HTMLElement, options: FriendsMountOptions): MountedFriends {
  if (options.mode !== "nanoterra" && options.mode !== "own") return NOTHING;
  const n = ++mounts;
  const origin = (options.origin ?? "https://nano133.com").replace(/\/+$/, "");
  const ask = options.confirm ?? ((q: string) => window.confirm(q));
  let where = options.where === undefined ? null : whereText(options.where);
  let isOpen = false;
  let destroyed = false;
  const cleanup: (() => void)[] = [];

  const badge = h("span", { class: "n133f-badge", "aria-hidden": "true" });
  badge.hidden = true;
  const keyWords = h("span", { class: "n133f-key-word" }, "Friends");
  const key = h("button", { class: "n133f-key", type: "button", "aria-expanded": "false", "aria-controls": `n133f-panel-${n}` }, icon("players", 20), keyWords, badge);
  const title = h("h2", { class: "n133f-title", id: `n133f-title-${n}` }, "Friends");
  const closeKey = h("button", { class: "n133f-close", type: "button", "aria-label": "Close friends" }, icon("close", 20));
  const body = h("div", { class: "n133f-body" });
  const panel = h("section", { class: `n133f-panel n133f-${options.mode}`, id: `n133f-panel-${n}`, role: "dialog", "aria-labelledby": `n133f-title-${n}`, "data-open": "false" }, h("header", { class: "n133f-head" }, title, closeKey), body);
  const wrap = h("div", { class: "n133-friends" }, key, panel);
  root.append(wrap);

  /** The requests (the thing to do) when there are any, else the friends online (another colour). The key's name says both. */
  const setBadge = ({ requests, online }: { requests: number; online: number }) => {
    const shown = requests > 0 ? requests : online;
    badge.hidden = shown <= 0;
    badge.classList.toggle("is-online", requests <= 0 && online > 0);
    badge.textContent = shown > 9 ? "9+" : String(shown);
    const parts = [requests > 0 ? `${requests} ${requests === 1 ? "request" : "requests"}` : "", online > 0 ? `${online} online` : ""].filter(Boolean);
    key.setAttribute("aria-label", parts.length ? `Friends, ${parts.join(", ")}` : "Friends");
  };

  let onOpen = () => {};
  let onClose = () => {};
  const open = () => {
    if (destroyed || isOpen) return;
    isOpen = true;
    panel.dataset.open = "true";
    key.setAttribute("aria-expanded", "true");
    onOpen();
    closeKey.focus();
  };
  const close = () => {
    if (destroyed || !isOpen) return;
    isOpen = false;
    panel.dataset.open = "false";
    key.setAttribute("aria-expanded", "false");
    onClose();
    key.focus();
  };
  key.addEventListener("click", () => (isOpen ? close() : open()));
  closeKey.addEventListener("click", close);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen) close();
  };
  document.addEventListener("keydown", onKey);
  cleanup.push(() => document.removeEventListener("keydown", onKey));

  let setWhereHere = (_w: string | null) => {};

  if (options.mode === "nanoterra") {
    // The window, made at once (no lazy loading) and kept while the panel is closed.
    const frame = h("iframe", {
      class: "n133f-window",
      src: windowUrl(origin, options.game),
      title: "Friends",
      referrerpolicy: "origin",
      allow: "storage-access",
      sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation",
    });
    body.append(frame);
    const hideFrame = (hidden: boolean) => {
      if (hidden) {
        frame.setAttribute("aria-hidden", "true");
        frame.tabIndex = -1;
      } else {
        frame.removeAttribute("aria-hidden");
        frame.removeAttribute("tabindex");
      }
    };
    hideFrame(true);
    let ready = false;
    const send = (msg: ToWindow) => {
      if (ready) frame.contentWindow?.postMessage(msg, origin);
    };
    onOpen = () => {
      hideFrame(false);
      send(toWindow({ type: "open" }));
    };
    onClose = () => {
      hideFrame(true);
      send(toWindow({ type: "closed" }));
    };
    setWhereHere = (w) => send(toWindow({ type: "where", where: w }));
    const onMessage = (e: MessageEvent) => {
      // Only the window itself, from nano133's origin.
      if (e.origin !== origin || e.source !== frame.contentWindow) return;
      const m = readWindowMessage(e.data);
      if (!m) return;
      if (m.type === "ready") {
        // Right after ready: where the player is, then whether the panel is open.
        ready = true;
        send(toWindow({ type: "where", where }));
        send(toWindow({ type: isOpen ? "open" : "closed" }));
      } else if (m.type === "size") {
        // The height its content needs, at most the panel's own room.
        const room = body.clientHeight;
        frame.style.height = `${room > 0 ? Math.min(m.height, room) : m.height}px`;
      } else if (m.type === "badge") setBadge(m);
      else if (m.type === "join") {
        if (!ask("Leave this game to join your friend?")) return;
        if (options.onJoin) options.onJoin(m.url);
        else window.location.assign(m.url);
      }
      // "signin": the window needs a tap (Storage Access) inside itself. The panel stays as it is; the kit does nothing else.
    };
    window.addEventListener("message", onMessage);
    cleanup.push(() => window.removeEventListener("message", onMessage));
  } else {
    const own = ownList(body, options, () => where, setBadge, ask);
    onOpen = own.opened;
    onClose = own.closed;
    setWhereHere = own.moved;
    cleanup.push(own.stop);
  }

  return {
    setWhere(w) {
      where = whereText(w);
      setWhereHere(where);
    },
    open,
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const f of cleanup) f();
      wrap.remove();
    },
  };
}

/** The game's own list in `body`. */
function ownList(body: HTMLElement, options: FriendsMountOptions, whereNow: () => string | null, setBadge: (n: { requests: number; online: number }) => void, ask: (q: string) => boolean) {
  const api: Api = createApi(options.base ?? "/friends", options.fetch);
  const lease = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const status = h("p", { class: "n133f-status", role: "status", "aria-live": "polite" });
  const nameInput = h("input", { class: "n133f-input", type: "text", name: "friend", maxlength: 64, autocomplete: "off", placeholder: "A player's name", "aria-label": "A player's name" });
  const addKey = h("button", { class: "n133f-btn n133f-primary", type: "submit" }, "Add");
  const form = h("form", { class: "n133f-add" }, nameInput, addKey);
  const list = h("div", { class: "n133f-list" });
  const show = h("input", { type: "checkbox", class: "n133f-check" });
  const showRow = h("label", { class: "n133f-show" }, show, h("span", {}, "Show friends when I am online"));
  body.append(form, status, list, showRow);

  let view: FriendView | null = null;
  let isOpen = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const fail = (e: unknown) => {
    status.textContent = e instanceof ApiError ? e.message : "The game's server did not answer. Try again.";
  };
  const draw = () => {
    if (!view) return;
    show.checked = view.showOnline;
    const requests = view.people.filter((p) => p.state === "incoming" || (p.state === "friend" && p.invite)).length;
    setBadge({ requests, online: view.people.filter((p) => p.state === "friend" && p.online).length });
    const groups: [string, FriendRow[]][] = [
      ["Requests", view.people.filter((p) => p.state === "incoming")],
      ["Friends", view.people.filter((p) => p.state === "friend")],
      ["Sent", view.people.filter((p) => p.state === "outgoing")],
      ["Blocked", view.people.filter((p) => p.state === "blocked")],
    ];
    const parts: HTMLElement[] = [];
    for (const [label, rows] of groups) {
      if (!rows.length) continue;
      parts.push(h("h3", { class: "n133f-group" }, `${label} (${rows.length})`), h("ul", { class: "n133f-rows" }, ...rows.map(rowEl)));
    }
    if (!parts.length) parts.push(h("p", { class: "n133f-empty" }, "No friends yet. Add a player by their name."));
    list.replaceChildren(...parts);
  };
  const act = async (body: Record<string, unknown>, done?: string) => {
    try {
      view = await api.post<FriendView>("", body);
      status.textContent = done ?? "";
      draw();
    } catch (e) {
      fail(e);
    }
  };
  const btn = (words: string, onclick: () => void, kind = "") => h("button", { class: `n133f-btn ${kind}`.trim(), type: "button", onclick }, words);
  function rowEl(p: FriendRow): HTMLElement {
    const keys: HTMLElement[] = [];
    if (p.state === "incoming") keys.push(btn("Accept", () => void act({ op: "accept", edge: p.edge }, `${p.name} is your friend now.`), "n133f-primary"), btn("Decline", () => void act({ op: "decline", edge: p.edge })));
    if (p.state === "friend") {
      if (p.invite && options.onJoin) keys.push(btn("Join", () => options.onJoin!(p.invite!.where, { name: p.name }), "n133f-primary"));
      const here = whereNow();
      if (here) keys.push(btn("Invite", () => void act({ op: "invite", edge: p.edge, where: here }, `Invited ${p.name}.`)));
      keys.push(btn("Remove", () => ask(`Remove ${p.name} from your friends?`) && void act({ op: "remove", edge: p.edge })));
      keys.push(btn("Block", () => ask(`Block ${p.name}? They will not see you or be able to ask you again.`) && void act({ op: "block", edge: p.edge }), "n133f-quiet"));
    }
    if (p.state === "outgoing") keys.push(btn("Cancel", () => void act({ op: "decline", edge: p.edge })));
    if (p.state === "blocked") keys.push(btn("Unblock", () => void act({ op: "unblock", edge: p.edge })));
    const line = p.state === "friend" ? (p.online ? p.where ?? "Online" : "Offline") : p.state === "incoming" ? "Wants to be friends" : p.state === "outgoing" ? "Asked" : "Blocked";
    const invite = p.state === "friend" && p.invite ? h("p", { class: "n133f-invite" }, `Invites you: ${p.invite.where}`) : null;
    return h(
      "li",
      { class: `n133f-row n133f-${p.state}${p.online ? " is-online" : ""}` },
      h("span", { class: "n133f-dot", "aria-hidden": "true" }),
      h("div", { class: "n133f-who" }, h("strong", {}, p.name), h("span", { class: "n133f-line" }, p.online ? `Online · ${line}` : line), invite),
      h("div", { class: "n133f-keys" }, ...keys),
    );
  }

  const read = async () => {
    try {
      view = await api.get<FriendView>("");
      draw();
    } catch (e) {
      if (isOpen) fail(e);
    }
  };
  const pulse = async (place: string | null) => {
    try {
      await api.post("", { op: "pulse", where: place, lease });
    } catch {
      // A missed pulse only makes the player look offline for a while.
    }
  };
  /** The next read of the view. One timer at a time: a new one replaces the old. */
  const loop = () => {
    if (timer) clearTimeout(timer);
    if (stopped) return;
    timer = setTimeout(
      () => {
        void read().finally(loop);
      },
      isOpen ? FRIENDS_TIMING.viewOpenMs : FRIENDS_TIMING.viewClosedMs,
    );
  };
  const beat = setInterval(() => {
    const here = whereNow();
    if (here) void pulse(here);
  }, FRIENDS_TIMING.pulseMs);
  const leave = () => {
    // The page goes away: this tab's place is cleared (an old tab cannot clear a newer one: the lease).
    void (options.fetch ?? fetch)(options.base ?? "/friends", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "pulse", where: null, lease }) }).catch(() => undefined);
  };
  window.addEventListener("pagehide", leave);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;
    void act({ op: "request", name }, `Asked ${name}.`).then(() => {
      if (!status.textContent?.startsWith("Asked")) return;
      nameInput.value = "";
    });
  });
  show.addEventListener("change", () => void act({ op: "visibility", showOnline: show.checked }));

  void read();
  if (whereNow()) void pulse(whereNow());
  loop();

  return {
    opened() {
      isOpen = true;
      status.textContent = "";
      void read();
      loop();
    },
    closed() {
      isOpen = false;
    },
    moved(place: string | null) {
      void pulse(place);
      draw();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      clearInterval(beat);
      window.removeEventListener("pagehide", leave);
      leave();
    },
  };
}
