// @nano133/signin: Sign in with Nano (XNO). No payment, no password, no email: every way is a signature, and the
// server checks it strictly. The server part is here; the stores are @nano133/signin/memory and
// @nano133/signin/firestore; the browser part is @nano133/signin/passkey and @nano133/signin/purse.
//
//   a passkey purse, or any key the browser holds   checkSignatureSignin   (./signature)
//   Nautilus (its nanoauth request)                  start/answer/checkNautilus   (./nautilus)
//   NanChat (its nanauth request)                    start/answer/checkNanchat    (./nanchat)

export * from "./verify.js";
export { checkSignatureSignin, onceKey, SigninError, type SignatureOptions, type UseOnce } from "./signature.js";
export * from "./message.js";
export * from "./requests.js";
export * from "./nautilus.js";
export * from "./nanchat.js";
