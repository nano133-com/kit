// The checks of the Legal card's settings (./legal.ts): a press (`parseLegalKey`, for parsePatch) and a stored value (`mergeLegal`). The admin's side only:
// the shop reads the merged settings and never loads this file.

import { DEFAULT_LEGAL, type LegalPatch, type LegalState } from "./legal.js";

/** The longest refund rule in days, and the most characters of the refund words. */
export const REFUND_DAYS_MAX = 365;
export const REFUND_WORDS_MAX = 280;

const onOff = (v: unknown): v is "on" | "off" => v === "on" || v === "off";
/** A refund rule in days: a whole number from 0 to REFUND_DAYS_MAX. */
export const isRefundDays = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= REFUND_DAYS_MAX;
/** Refund words: plain text of 1 to REFUND_WORDS_MAX characters on one line, never HTML (no "<" or ">"), no control character. */
export const isRefundWords = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0 && v.length <= REFUND_WORDS_MAX && v === v.trim() && !/[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v);

/** The stored words of the Legal card (as an admin store keeps them: text), read back. Anything that is not a known value is the default. */
export function mergeLegal(stored: { adultsOnly?: unknown; sellLives?: unknown; refundDays?: unknown; refundWords?: unknown; lawsConfirmedAt?: unknown }): LegalState {
  const days = typeof stored.refundDays === "string" && /^\d{1,3}$/.test(stored.refundDays) ? Number(stored.refundDays) : NaN;
  const at = typeof stored.lawsConfirmedAt === "string" && /^[1-9]\d{0,15}$/.test(stored.lawsConfirmedAt) ? Number(stored.lawsConfirmedAt) : null;
  return {
    adultsOnly: onOff(stored.adultsOnly) ? stored.adultsOnly === "on" : DEFAULT_LEGAL.adultsOnly,
    sellLives: onOff(stored.sellLives) ? stored.sellLives === "on" : DEFAULT_LEGAL.sellLives,
    refundDays: isRefundDays(days) ? days : DEFAULT_LEGAL.refundDays,
    refundWords: isRefundWords(stored.refundWords) ? stored.refundWords : DEFAULT_LEGAL.refundWords,
    lawsConfirmedAt: at,
  };
}

/** One key of a press on the Legal card: the patch it gives, an error in words, or null when the key is not the card's. */
export function parseLegalKey(key: string, value: unknown): { patch: LegalPatch } | { error: string } | null {
  if (key === "adultsOnly") return onOff(value) ? { patch: { adultsOnly: value } } : { error: '"adultsOnly" must be "on" or "off".' };
  if (key === "sellLives") return onOff(value) ? { patch: { sellLives: value } } : { error: '"sellLives" must be "on" or "off".' };
  if (key === "refundDays") return isRefundDays(value) ? { patch: { refundDays: value } } : { error: `"refundDays" must be a whole number of days from 0 to ${REFUND_DAYS_MAX}.` };
  if (key === "refundWords")
    return isRefundWords(value) ? { patch: { refundWords: value } } : { error: `"refundWords" must be plain text of 1 to ${REFUND_WORDS_MAX} characters on one line, with no "<" or ">".` };
  if (key === "confirmLaws") return value === true ? { patch: { confirmLaws: true } } : { error: '"confirmLaws" must be true.' };
  return null;
}
