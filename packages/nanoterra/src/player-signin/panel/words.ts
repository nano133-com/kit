// Every word of the sign-in sheet, and its words for each passkey fault, in plain English. A game gives `words` to `mountPlayerSignin` (or to
// `signInView`) with the keys it wants to change, in its own words or language; the rest stay these. A text with a value in it is a function of that
// value. The wallets' names (Berry Wallet, NanChat, Nautilus) are names, not words: they stay.
//
// The fault codes are @nano133/signin's (PasskeyFault). A fault never names a seed or a key, and never tells the player to delete a passkey. No
// sentence has more than 10 words.

import type { PasskeyFault } from "@nano133/signin/passkey";

/** What to do next after a fault: stay on the passkey step, or offer the wallet apps. */
export type FaultWords = { title: string; text: string; next: "stay" | "wallets" };

/** A fault's words: its title, and its text (a function when it names the game's domain, `rpId`). */
export type FaultText = { title: string; text: string | ((rpId: string) => string) };

export type PlayerSigninWords = {
  /** The sheet's title. The option `title` wins over it. */
  title: string;
  /** The close key's name for a screen reader. */
  close: string;
  /** The first line of the ways. */
  lead: string;
  usePasskey: string;
  /** Under "Use a passkey". */
  passkeyHint: string;
  /** Under "Use a passkey" where the browser reports no passkey PRF. */
  passkeyOff: string;
  lastUsed: string;
  /** Before the wallet tiles, after the passkey. */
  orWallet: string;
  /** Before the wallet tiles, with no passkey before them. */
  chooseWallet: string;
  /** Before the passkey, when it comes last. */
  orPasskey: string;
  back: string;

  // ---- the passkey ----
  passkeyTitle: string;
  passkeyText: string;
  useMine: string;
  makeOne: string;
  waitingPasskey: string;
  makingPasskey: string;
  openingPasskey: string;
  /** A passkey just made, whose first use gave nothing: one key opens it. */
  madeTitle: string;
  madeText: string;
  openMine: string;
  spareTitle: string;
  spareText: string;
  /** Under the code: keep it secret; how to use it. */
  spareFine: string;
  showCode: string;
  copyCode: string;
  copied: string;
  copyFailed: string;
  later: string;
  continue: string;
  signingIn: string;
  signInFailed: string;
  /** After a fault that offers the wallet apps. */
  faultWallets: string;
  faults: Record<PasskeyFault, FaultText>;

  // ---- a wallet app ----
  starting: string;
  startFailed: string;
  /** The words of a refusal: the server's own (`text`, in English) and its HTTP status (0: no answer). Default: the server's words. */
  refusal: (text: string, status: number) => string;
  /** The status while the page waits for a wallet ("Berry Wallet"). */
  waitingFor: (wallet: string) => string;
  /** After a sign-in, with the player's short address. */
  signedInAs: (address: string) => string;
  /** The key that opens a wallet app on a touch screen. */
  openApp: (wallet: string) => string;
  anotherWallet: string;
  /** Before a link that opens the wallet on this computer. */
  onComputer: string;
  /** The link's words: open a wallet ("NanChat", or `aWallet`). */
  openLink: (wallet: string) => string;
  aWallet: string;
  /** With no QR hook, on a screen with a mouse. */
  openOnPhone: (wallet: string) => string;
  qrLabel: (wallet: string) => string;
  /** Only approve a sign-in the player started, on this host. */
  onlyYours: (host: string) => string;
  /** After the key that opens the app (`yourWallet` for Berry Wallet, which opens any wallet). */
  comeBack: (wallet: string) => string;
  yourWallet: string;
  /** Under a QR code: scan it with this wallet. */
  scanWith: (wallet: string) => string;
  /** Under NanChat's QR code: the phone's camera opens it. */
  scanCamera: (wallet: string) => string;
  /** Before Nautilus's code (the code follows, bold). */
  checkCode: string;
  tryAgain: string;
  otherWay: string;
  expired: string;
  usedElsewhere: string;
  tooManyChecks: string;
};

/** `words` as a game gives it: any of the keys, and any of the faults. */
export type PlayerSigninWordsOption = Partial<Omit<PlayerSigninWords, "faults">> & { faults?: Partial<Record<PasskeyFault, FaultText>> };

export const PLAYER_SIGNIN_WORDS: PlayerSigninWords = {
  title: "Sign in",
  close: "Close",
  lead: "No password and no payment.",
  usePasskey: "Use a passkey",
  passkeyHint: "Face ID, Touch ID or your device PIN",
  passkeyOff: "Not on this browser",
  lastUsed: "Last used",
  orWallet: "Or a wallet app",
  chooseWallet: "Choose your wallet",
  orPasskey: "Or a passkey",
  back: "Back",

  passkeyTitle: "Passkey",
  passkeyText: "Face ID, Touch ID or your device PIN. The passkey stays on your device. The game never sees it.",
  useMine: "Use my passkey",
  makeOne: "Make a passkey",
  waitingPasskey: "Waiting for your passkey…",
  makingPasskey: "Making your passkey…",
  openingPasskey: "Opening your passkey…",
  madeTitle: "Your passkey is made",
  madeText: "Press the key to open it.",
  openMine: "Open my passkey",
  spareTitle: "Keep a spare key",
  spareText: "Your looks belong to this passkey. If you lose it, this code brings them back.",
  spareFine: "Keep it secret. Anyone with it can sign in as you. Import it as a seed in Nautilus or another wallet. Then sign in with that wallet.",
  showCode: "Show my code",
  copyCode: "Copy the code",
  copied: "Copied",
  copyFailed: "Copy failed: write it down",
  later: "Later",
  continue: "Continue",
  signingIn: "Signing in…",
  signInFailed: "Sign-in did not work. Try again.",
  faultWallets: "Sign in with a wallet app",
  faults: {
    cancelled: { title: "No passkey was used", text: "No passkey was used." },
    "no-prf": { title: "Not on this device yet", text: "This device's passkeys cannot sign in to games yet. Use a wallet app, or a passkey on another device." },
    unsupported: { title: "No passkeys here", text: "This browser has no passkeys. Use a wallet app." },
    "other-form": { title: "Not this password manager", text: "This game cannot read your password manager's answer. Choose iCloud Keychain or Google Password Manager instead. Or use a wallet app." },
    "not-a-purse": { title: "Not this game's passkey", text: "That passkey is not one of this game's. Choose another one, or make one." },
    "wrong-host": { title: "Wrong address", text: (rpId) => `Passkeys for this game work only on ${rpId}.` },
    exists: { title: "You have a passkey", text: "This device has your passkey already. Use it." },
    unstable: { title: "Not on this device", text: "This device gave two answers for one passkey. It cannot sign in here. Use a wallet app." },
    "other-passkey": { title: "Another passkey", text: "That is another passkey. Choose the one you just made. Its name has today's date." },
    failed: { title: "That did not work", text: "The passkey did not work. Try again." },
  },

  starting: "Starting…",
  startFailed: "Sign-in did not start. Try again.",
  refusal: (text) => text,
  waitingFor: (wallet) => `Waiting for ${wallet}…`,
  signedInAs: (address) => `Signed in as ${address}`,
  openApp: (wallet) => `Open ${wallet}`,
  anotherWallet: "Another wallet",
  onComputer: "On this computer: ",
  openLink: (wallet) => `open ${wallet}`,
  aWallet: "a wallet",
  openOnPhone: (wallet) => `Open this page on your phone to use ${wallet}.`,
  qrLabel: (wallet) => `QR code to sign in with ${wallet}`,
  onlyYours: (host) => `Only approve a sign-in you started yourself, on ${host}.`,
  comeBack: (wallet) => `Approve the sign-in in ${wallet}. Then come back to this page.`,
  yourWallet: "your wallet",
  scanWith: (wallet) => `Scan this with ${wallet} on your phone. Then approve the sign-in.`,
  scanCamera: (wallet) => `Scan this with your phone's camera to open ${wallet}. Then approve the sign-in.`,
  checkCode: "Check that Nautilus shows this code: ",
  tryAgain: "Try again",
  otherWay: "Choose another way",
  expired: "This sign-in expired.",
  usedElsewhere: "This sign-in was used in another browser. Start again.",
  tooManyChecks: "Too many checks. Waiting a moment…",
};

/** The game's words over the defaults; its faults over the default faults. A key it leaves out, or gives as undefined, keeps its default. */
export function playerSigninWords(over?: PlayerSigninWordsOption): PlayerSigninWords {
  const out = { ...PLAYER_SIGNIN_WORDS, faults: { ...PLAYER_SIGNIN_WORDS.faults } };
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v === undefined || !(k in PLAYER_SIGNIN_WORDS)) continue;
    if (k === "faults") {
      for (const [code, f] of Object.entries(v as Record<string, FaultText | undefined>)) if (f && code in out.faults) out.faults[code as PasskeyFault] = f;
    } else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** What happens after each fault: the passkey step again, or the wallet apps. Not words: the sheet's steps. */
const NEXT: Record<PasskeyFault, FaultWords["next"]> = {
  cancelled: "stay",
  "no-prf": "wallets",
  unsupported: "wallets",
  "other-form": "wallets",
  "not-a-purse": "stay",
  "wrong-host": "wallets",
  exists: "stay",
  unstable: "wallets",
  "other-passkey": "stay",
  failed: "stay",
};

/** A fault's title, text and next step, in the game's words (default: PLAYER_SIGNIN_WORDS). An unknown code gets the words of "failed". */
export function faultWords(code: PasskeyFault, rpId: string, words: PlayerSigninWordsOption = PLAYER_SIGNIN_WORDS): FaultWords {
  const known: PasskeyFault = code in NEXT ? code : "failed";
  const f = words.faults?.[known] ?? PLAYER_SIGNIN_WORDS.faults[known];
  return { title: f.title, text: typeof f.text === "function" ? f.text(rpId) : f.text, next: NEXT[known] };
}
