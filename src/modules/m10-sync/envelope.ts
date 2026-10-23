import type { Db } from '../../platform/db/open.js';
import { canonicalJson } from '../../platform/canonical.js';
import { nowUtc } from '../../platform/time.js';
import { signText, verifyText } from './keys.js';

/** Everything exchanged between installations is a signed envelope; the signature covers sender, time, path and body. */
export interface Envelope<T = unknown> { from: string; sentAt: string; path: string; body: T; signature: string }

const signedText = (e: Omit<Envelope, 'signature'>): string => canonicalJson({ from: e.from, sentAt: e.sentAt, path: e.path, body: e.body });

export function signEnvelope<T>(db: Db, from: string, path: string, body: T): Envelope<T> {
  const base = { from, sentAt: nowUtc(), path, body };
  return { ...base, signature: signText(db, signedText(base)) };
}

export const verifyEnvelope = (publicPem: string, e: Envelope): boolean => verifyText(publicPem, signedText(e), e.signature);
