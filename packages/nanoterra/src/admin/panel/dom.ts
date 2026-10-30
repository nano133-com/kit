// A tiny helper to build page elements without innerHTML (safe for any text, and fine under a strict CSP). The panel runs in a browser.

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, ""), v);
    else if (k === "class") el.className = String(v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** "nano_1abc…wxyz" */
export const shortAddress = (a: string): string => `${a.slice(0, 10)}…${a.slice(-6)}`;

export async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  const was = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => (button.textContent = was), 1500);
}

/**
 * A small copy key: an icon and the word "Copy". A press puts `value` on the clipboard and says "Copied" for a moment; only the word changes, so the icon
 * stays. `label` names what is copied, for a screen reader and the tooltip ("Copy the player's address").
 */
export function copyKey(value: string, label: string, icon?: Element): HTMLButtonElement {
  const word = h("span", { class: "copy-word" }, "Copy");
  const button = h("button", { class: "btn btn-small btn-quiet copy-key", type: "button", "aria-label": label, title: label }, icon ?? null, word);
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(value);
      word.textContent = "Copied";
    } catch {
      word.textContent = "Copy failed";
    }
    setTimeout(() => (word.textContent = "Copy"), 1500);
  });
  return button;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". A time in the future reads "just now". */
export function ago(ms: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hours = Math.round(m / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** "3 orders", "1 order" */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "$1.25" from cents. */
export const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
