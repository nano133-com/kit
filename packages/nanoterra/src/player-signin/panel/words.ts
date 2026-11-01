// The sheet's words for each passkey fault, in plain English. The fault codes are @nano133/signin's (PasskeyFault). A fault never names a seed or a
// key, and never tells the player to delete a passkey.

import type { PasskeyFault } from "@nano133/signin/passkey";

/** What to do next after a fault: stay on the passkey step, or offer the wallet apps. */
export type FaultWords = { title: string; text: string; next: "stay" | "wallets" };

export function faultWords(code: PasskeyFault, rpId: string): FaultWords {
  switch (code) {
    case "cancelled":
      return { title: "No passkey was used", text: "No passkey was used.", next: "stay" };
    case "no-prf":
      return { title: "Not on this device yet", text: "This device's passkeys cannot sign in to games yet. Use a wallet app, or a passkey on another device.", next: "wallets" };
    case "unsupported":
      return { title: "No passkeys here", text: "This browser has no passkeys. Use a wallet app.", next: "wallets" };
    case "other-form":
      return { title: "Not this password manager", text: "Your password manager answered in a way this game cannot read. In the device's sheet, choose its own passkeys (iCloud Keychain or Google Password Manager), or use a wallet app.", next: "wallets" };
    case "not-a-purse":
      return { title: "Not this game's passkey", text: "That passkey is not one of this game's. Choose another one, or make one.", next: "stay" };
    case "wrong-host":
      return { title: "Wrong address", text: `Passkeys for this game work only on ${rpId}.`, next: "wallets" };
    case "exists":
      return { title: "You have a passkey", text: "This device has your passkey already. Use it.", next: "stay" };
    case "unstable":
      return { title: "Not on this device", text: "This device gave two different answers for one passkey, so it cannot sign in here. Use a wallet app.", next: "wallets" };
    case "other-passkey":
      return { title: "Another passkey", text: "That is another passkey. Choose the one you just made: its name has today's date.", next: "stay" };
    default:
      return { title: "That did not work", text: "The passkey did not work. Try again.", next: "stay" };
  }
}
