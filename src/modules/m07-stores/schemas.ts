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
const Name = z.string().trim().min(1).max(160);
const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_./-]{0,39}$/, 'use A-Z, 0-9, _ . / - (max 40 characters)');
const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const ActiveStatus = z.enum(['active', 'inactive']);
/** Quantities may be fractional (metres, litres) but never absurd; 3 decimals is the precision stores work to. */
const Qty = z.number().positive().max(1_000_000).refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'at most 3 decimal places');
const Cost = z.number().min(0).max(1_000_000_000);
const Currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'ISO currency code, e.g. LKR');

export const Tombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

export const PartCreate = z.strictObject({
  partNo: Code, name: Name, description: Text(500), unit: z.string().trim().min(1).max(12).default('each'), category: Text(60),
  manufacturer: Text(120), manufacturerPartNo: Text(80), status: ActiveStatus.optional(),
});
export const PartUpdate = z.strictObject({
  expectedVersion: Version, name: Name.optional(), description: Text(500), unit: z.string().trim().min(1).max(12).optional(), category: Text(60),
  manufacturer: Text(120), manufacturerPartNo: Text(80), status: ActiveStatus.optional(),
});
export const CompatibilityCreate = z.strictObject({ partId: Uuid, classificationId: Uuid.optional(), assetId: Uuid.optional(), note: Text(200) })
  .refine((v) => (v.classificationId === undefined) !== (v.assetId === undefined), { message: 'give exactly one of classificationId or assetId' });

export const LocationCreate = z.strictObject({
  code: Code, name: Name, kind: z.enum(['store', 'locker', 'workshop', 'other']).default('store'), siteId: Uuid.nullable().optional(), orgLocationId: Uuid.nullable().optional(),
});
export const LocationUpdate = z.strictObject({ expectedVersion: Version, name: Name.optional(), kind: z.enum(['store', 'locker', 'workshop', 'other']).optional(), orgLocationId: Uuid.nullable().optional(), status: ActiveStatus.optional() });

export const LevelCreate = z.strictObject({ partId: Uuid, locationId: Uuid, minLevel: z.number().min(0).max(1_000_000), reorderQty: Qty.nullable().optional() });
export const LevelUpdate = z.strictObject({ expectedVersion: Version, minLevel: z.number().min(0).max(1_000_000).optional(), reorderQty: Qty.nullable().optional() });

const Moment = { occurredAt: UtcTimestamp.optional() };
export const Receive = z.strictObject({ partId: Uuid, locationId: Uuid, quantity: Qty, unitCost: Cost.optional(), currency: Currency.optional(), reference: Text(120), note: Text(500), ...Moment });
const WorkRef = { workOrderId: Uuid.optional(), reference: Text(120) };
export const Issue = z.strictObject({ partId: Uuid, locationId: Uuid, quantity: Qty, note: Text(500), ...WorkRef, ...Moment })
  .refine((v) => v.workOrderId !== undefined || !!v.reference, { message: 'give a workOrderId, or a reference saying what the stock was used for' });
export const Return = z.strictObject({ partId: Uuid, locationId: Uuid, quantity: Qty, note: Text(500), ...WorkRef, ...Moment });
export const Adjust = z.strictObject({
  partId: Uuid, locationId: Uuid, delta: z.number().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'must not be zero')
    .refine((n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'at most 3 decimal places'),
  reason: z.string().trim().min(3).max(500), ...Moment,
});
export const Reserve = z.strictObject({ partId: Uuid, locationId: Uuid, quantity: Qty, workOrderId: Uuid, note: Text(500) });
export const Release = z.strictObject({ partId: Uuid, locationId: Uuid, quantity: Qty.optional(), workOrderId: Uuid, note: Text(500) });

export const TransferLine = z.strictObject({ partId: Uuid, quantity: Qty });
export const Dispatch = z.strictObject({
  fromLocationId: Uuid, toLocationId: Uuid, lines: z.array(TransferLine).min(1).max(100).refine((a) => new Set(a.map((l) => l.partId)).size === a.length, { message: 'each part may appear once' }),
  note: Text(500), dispatchedAt: UtcTimestamp.optional(),
});
export const ReceiveTransfer = z.strictObject({ note: Text(500), receivedAt: UtcTimestamp.optional() });
export const CancelTransfer = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });
