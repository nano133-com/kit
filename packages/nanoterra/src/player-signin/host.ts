// Where a passkey may be made. A passkey belongs to one domain for good: one made on a preview address (`*.workers.dev`, where the game starter
// runs first) is lost when the game moves to its own domain, and the player's looks go with it. So the sheet offers no passkey there by default,
// and the admin says why. No DOM and no package: the admin panel uses it too.

/** True for a preview address that a game leaves for its own domain: `*.workers.dev`. */
export function previewHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "workers.dev" || host.endsWith(".workers.dev");
}

/** What the admin says on a preview address of a game that offers its players a passkey. */
export const PASSKEY_PREVIEW_NOTE = "Passkeys turn on when your game has its own domain.";
