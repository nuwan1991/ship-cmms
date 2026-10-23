import { z } from 'zod';
import { AppError } from '../../platform/errors.js';

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError('VALIDATION_FAILED', r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '), {
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const Code = z.string().trim().regex(/^[a-z][a-z0-9_]{0,31}$/);
export const PreviewInput = z.strictObject({
  templateCode: Code,
  fileName: z.string().trim().min(1).max(200).transform((s) => s.replace(/^.*[\\/]/, '')),
  contentBase64: z.string().min(4).max(Math.ceil((MAX_FILE_BYTES * 4) / 3) + 16).regex(/^[A-Za-z0-9+/=\s]+$/, 'must be base64'),
});
export const CommitInput = z.strictObject({ skipErrors: z.boolean().default(false) });
export const FileQuery = z.strictObject({
  kind: z.enum(['blank', 'data']).default('blank'), format: z.enum(['xlsx', 'csv']).default('xlsx'), shipId: z.uuid().optional(),
});
