// A game with its OWN looks sheet that shows the kit's try-on stage in it (README "The try-on stage", "A game with its own looks sheet").
// The supported way is the kit's sheet (mountShop with `tryOn`); a game that keeps its own sheet does all of this itself. The package's tests
// type-check this file against the package's own types, so it follows every change of the API.
//
// The page loads both stylesheets, and the stage's box sits in an element with the class "n133-shop":
//   import "@nano133/nanoterra/shop/style.css";
//   import "@nano133/nanoterra/shop/tryon.css";
import type { Look } from "@nano133/nanoterra/looks";
import { calmNow } from "@nano133/nanoterra/shop/panel";
import type { MountedShop, TryOnStage } from "@nano133/nanoterra/shop/panel";
import type { TryOnBody } from "@nano133/nanoterra/shop/viewer";

export type OwnSheet = { open(): Promise<void>; close(): void };

/**
 * The game's sheet: `el` is its own panel, `shop` the kit's Buy (`mountShop(..., { key: false, offer: false })`), `body` the game's character for the
 * stage, `worn` and `wearOf` the game's own. Tried looks are this sheet's state only: never worn, saved or sent.
 */
export function ownSheet(el: HTMLElement, shop: MountedShop, looks: Look[], worn: () => Look[], wearOf: (l: Look) => string, body: () => TryOnBody<Look>): OwnSheet {
  // 1. the stage's box, in an element with the class n133-shop (tryon.css gives the box its height)
  const scope = document.createElement("div");
  scope.className = "n133-shop";
  const box = document.createElement("div");
  box.className = "n133s-tryon-stage";
  box.tabIndex = 0;
  box.setAttribute("role", "group");
  const tray = document.createElement("ul");
  scope.append(box);
  el.append(scope, tray);

  // 2. what is tried on: one look a wear slot, in the order tried
  const tried = new Map<string, Look>();
  let focus: Look | null = null;
  let stage: TryOnStage | null = null;
  const view = () => ({ worn: worn(), tried: [...tried.values()], focus });

  function draw() {
    box.setAttribute("aria-label", `Your character, trying on ${[...tried.values()].map((l) => l.name).join(", ") || "nothing"}`);
    tray.replaceChildren(
      ...[...tried.values()].map((l) => {
        const row = document.createElement("li");
        const off = document.createElement("button");
        off.textContent = "Take off";
        off.onclick = () => {
          tried.delete(wearOf(l));
          if (focus?.id === l.id) focus = null;
          draw();
          box.focus(); // the focus never falls to the page, where the game's keys act
        };
        const buy = document.createElement("button");
        buy.textContent = `Buy ${l.name}`;
        buy.onclick = () => shop.buy(l.id); // the kit's order and pay sheet
        row.append(l.name, " ", off, " ", buy);
        return row;
      }),
    );
    stage?.show(view());
  }

  // 3. the list's Try on keys
  for (const l of looks) {
    const key = document.createElement("button");
    key.textContent = `Try on ${l.name}`;
    key.onclick = () => {
      tried.set(wearOf(l), l);
      focus = l;
      draw();
    };
    el.append(key);
  }

  return {
    async open() {
      try {
        const { tryOnViewer } = await import("@nano133/nanoterra/shop/viewer");
        stage = await tryOnViewer({ body }).mount(box, {
          calm: calmNow,
          onTap: () => box.focus(),
          words: { zoomIn: "Zoom in", zoomOut: "Zoom out", whole: "Show the whole character", turn: "Turn around" },
          failed: (l) => console.info(`${l.name} could not be shown`),
        });
      } catch {
        // no WebGL: show the look's still picture in the box instead (the game's own picture)
        stage = null;
      }
      draw();
    },
    close() {
      // 4. free the WebGL renderer, and forget what was tried on
      stage?.dispose();
      stage = null;
      tried.clear();
      focus = null;
      draw();
    },
  };
}
