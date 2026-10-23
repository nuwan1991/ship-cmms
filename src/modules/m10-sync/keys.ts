import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, timingSafeEqual, verify } from 'node:crypto';
import type { Db } from '../../platform/db/open.js';
import { sha256Hex } from '../../platform/canonical.js';
import { nowUtc } from '../../platform/time.js';

/** Ed25519 installation keys. The private key stays in this database; peers get the public key at provisioning. */
export function ensureLocalKey(db: Db): { publicPem: string; privatePem: string } {
  const r = db.prepare('SELECT public_pem, private_pem FROM syn_local_key WHERE singleton = 1').get() as { public_pem: string; private_pem: string } | undefined;
  if (r) return { publicPem: r.public_pem, privatePem: r.private_pem };
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  db.prepare('INSERT INTO syn_local_key (singleton, public_pem, private_pem, created_at) VALUES (1, ?, ?, ?)').run(publicPem, privatePem, nowUtc());
  return { publicPem, privatePem };
}

export const signText = (db: Db, text: string): string => sign(null, Buffer.from(text, 'utf8'), createPrivateKey(ensureLocalKey(db).privatePem)).toString('base64');

export function verifyText(publicPem: string, text: string, signatureB64: string): boolean {
  try {
    return verify(null, Buffer.from(text, 'utf8'), createPublicKey(publicPem), Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** One-time enrolment secret: shown once in the provisioning package, stored only as a hash. */
export const newSecret = (): string => randomBytes(24).toString('base64url');
export const secretHash = (s: string): string => sha256Hex(`syn-enrol:${s}`);
export const secretMatches = (given: string, storedHash: string): boolean => {
  const a = Buffer.from(secretHash(given)), b = Buffer.from(storedHash);
  return a.length === b.length && timingSafeEqual(a, b);
};
