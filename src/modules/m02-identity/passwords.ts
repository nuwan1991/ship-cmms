import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError } from '../../platform/errors.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, LEN = 64;

/** `scrypt$N$r$p$salt$hash` (base64). Parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${h.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function assertPasswordPolicy(password: string, username?: string): void {
  if (password.length < 10) throw new AppError('VALIDATION_FAILED', 'Password must be at least 10 characters');
  if (password.length > 128) throw new AppError('VALIDATION_FAILED', 'Password must be at most 128 characters');
  if (username && password.toLowerCase().includes(username.toLowerCase())) throw new AppError('VALIDATION_FAILED', 'Password must not contain the username');
}
