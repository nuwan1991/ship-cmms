import { z } from 'zod';
import { UtcTimestamp, Uuid } from '../../platform/contracts.js';
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
const Name = z.string().trim().min(1).max(120);
const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,31}$/, 'use A-Z, 0-9, _ . - (max 32 characters)');
const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const ActiveStatus = z.enum(['active', 'inactive']);
export const OBSERVED_STATUSES = ['in_service', 'in_store', 'under_repair', 'out_of_service', 'condemned'] as const;
const Observed = z.enum(OBSERVED_STATUSES);

export const Tombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

export const LabelIssue = z.strictObject({ count: z.number().int().min(1).max(200), shipId: Uuid.nullable().optional(), note: Text(200) });
export const LabelAssign = z.strictObject({ expectedVersion: Version, assetId: Uuid.optional(), assetTag: z.string().trim().min(1).max(40).optional() })
  .refine((v) => (v.assetId === undefined) !== (v.assetTag === undefined), { message: 'give exactly one of assetId or assetTag' });
export const LabelVoid = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });
export const LabelPrint = z.strictObject({
  labelIds: z.array(Uuid).min(1).max(240), columns: z.number().int().min(1).max(6).default(3), rows: z.number().int().min(1).max(12).default(8), note: Text(200),
});

export const TemplateItem = z.strictObject({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,31}$/, 'lower-case letters, digits and _ (max 32)'),
  label: z.string().trim().min(1).max(120),
  kind: z.enum(['text', 'yesno', 'number']),
});
const TemplateItems = z.array(TemplateItem).max(40).refine((a) => new Set(a.map((i) => i.key)).size === a.length, { message: 'item keys must be unique' });
export const TemplateCreate = z.strictObject({ code: Code, name: Name, description: Text(500), items: TemplateItems.default([]), status: ActiveStatus.optional() });
export const TemplateUpdate = z.strictObject({ expectedVersion: Version, name: Name.optional(), description: Text(500), items: TemplateItems.optional(), status: ActiveStatus.optional() });

export const SurveyCreate = z.strictObject({ locationId: Uuid, templateId: Uuid.nullable().optional(), startedAt: UtcTimestamp.optional(), note: Text(500) });
export const SurveyUpdate = z.strictObject({ expectedVersion: Version, note: Text(500) });
export const SurveyClose = z.strictObject({ expectedVersion: Version, note: Text(500) });

const Answers = z.record(z.string().max(32), z.union([z.string().max(500), z.number(), z.boolean()])).default({});
export const ItemCreate = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('scanned'), labelNo: z.string().trim().min(1).max(40).optional(), assetTag: z.string().trim().min(1).max(40).optional(), assetId: Uuid.optional(),
    observedStatus: Observed.optional(), answers: Answers, note: Text(500),
  }).refine((v) => [v.labelNo, v.assetTag, v.assetId].filter((x) => x !== undefined).length === 1, { message: 'give exactly one of labelNo, assetTag or assetId' }),
  z.strictObject({
    kind: z.literal('pending'), description: Name, manufacturer: Text(120), model: Text(120), serialNumber: Text(80),
    observedStatus: Observed.optional(), answers: Answers, note: Text(500),
  }),
]);
export const ItemUpdate = z.strictObject({
  expectedVersion: Version, observedStatus: Observed.nullable().optional(), answers: Answers.optional(), note: Text(500),
  description: Name.optional(), manufacturer: Text(120), model: Text(120), serialNumber: Text(80),
});
export const ItemConvert = z.strictObject({
  expectedVersion: Version, name: Name.optional(), classificationId: Uuid.nullable().optional(), positionId: Uuid.optional(), labelId: Uuid.optional(),
});
