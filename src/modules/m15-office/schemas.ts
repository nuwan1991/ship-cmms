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

const Version = z.number().int().min(1);
const Name = z.string().trim().min(1).max(160);
const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_./-]{0,39}$/, 'use A-Z, 0-9, _ . / - (max 40 characters)');
const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const UserId = z.string().trim().min(1).max(64);
/** Any record of any module: `<prefix>.<noun>` + uuid. */
export const RecordRef = z.strictObject({ type: z.string().regex(/^[a-z]{2,4}\.[a-z0-9_]+$/), id: z.uuid() });
export const Reason = z.string().trim().min(1).max(500);

export const UNIT_LEVELS = ['department', 'section', 'workshop', 'subsection'] as const;
export type UnitLevel = (typeof UNIT_LEVELS)[number];

export const UnitCreate = z.strictObject({
  commandId: z.uuid(), parentId: z.uuid().nullable().optional(), level: z.enum(UNIT_LEVELS), code: Code, name: Name,
  headUserId: UserId.nullable().optional(), deputyUserId: UserId.nullable().optional(),
  verifyRule: z.enum(['in_charge', 'officer_required']).optional(), sortOrder: z.number().int().min(0).max(9999).optional(),
});
export const UnitUpdate = z.strictObject({
  expectedVersion: Version, parentId: z.uuid().nullable().optional(), code: Code.optional(), name: Name.optional(),
  headUserId: UserId.nullable().optional(), deputyUserId: UserId.nullable().optional(),
  verifyRule: z.enum(['in_charge', 'officer_required']).optional(), sortOrder: z.number().int().min(0).max(9999).optional(),
  status: z.enum(['active', 'inactive']).optional(), reason: Text(500),
});

export const LinkCreate = z.strictObject({
  from: RecordRef, to: RecordRef, linkType: z.enum(['originated_from', 'reply_to', 'relates_to', 'supersedes']).default('relates_to'), note: Text(300),
});
export const Remove = z.strictObject({ expectedVersion: Version, reason: Reason });

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const AttachmentUpload = z.strictObject({
  fileName: z.string().trim().min(1).max(200), mimeType: z.string().trim().min(3).max(100), contentBase64: z.string().min(1),
  title: Text(200), classification: z.enum(['unclassified', 'restricted']).default('unclassified'),
  /** Attach to this record straight away (optional). */
  record: RecordRef.optional(),
});
export const AttachTo = z.strictObject({ record: RecordRef });

export const Comment = z.strictObject({ record: RecordRef, kind: z.enum(['comment', 'progress']).default('comment'), note: z.string().trim().min(1).max(4000) });
