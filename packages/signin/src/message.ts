// The text a wallet signs to sign in with its key (browser and server build it the same way).
// It names the site's domain, so a signature for one site can't sign in to another.

/** "example.com: sign in as nano_… at 1790000000000" (the time in ms). */
export const signinMessage = (domain: string, address: string, at: number) => `${domain}: sign in as ${address} at ${at}`;
