// What the admin's sign-in list keeps of a browser: a short name made from fixed lists ("Chrome on macOS") and the rough country. The game starter's
// src/worker/browser.ts, unchanged. It NEVER returns any of the browser's own text, so a hostile browser text cannot put anything in the list, and only
// this name is kept (never the browser text itself).

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\//, "Chrome"],
  [/\bSafari\//, "Safari"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b|\biPad\b|\biPod\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b|\bX11\b/, "Linux"],
];

/** "Chrome on macOS", "Safari on iOS", "Firefox", or "Unknown browser". At most 40 characters, only from the lists above. */
export function shortBrowser(userAgent: string | null | undefined): string {
  if (typeof userAgent !== "string" || !userAgent) return "Unknown browser";
  // Only the start of the text is read: a long text cannot make the matching slow.
  const ua = userAgent.slice(0, 400);
  const browser = BROWSERS.find(([re]) => re.test(ua))?.[1];
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  if (!browser && !system) return "Unknown browser";
  return `${browser ?? "Browser"}${system ? ` on ${system}` : ""}`;
}

/** The rough country of a request: Cloudflare's two-letter country header, or null (not there, "XX" for unknown, "T1" for Tor, or anything that is not two capital letters). */
export function countryOf(req: Request): string | null {
  const c = req.headers.get("CF-IPCountry");
  return typeof c === "string" && /^[A-Z]{2}$/.test(c) && c !== "XX" && c !== "T1" ? c : null;
}
