import { z } from 'zod';
import { PartyRef, UtcTimestamp, Uuid } from '../../platform/contracts.js';
import { AppError } from '../../platform/errors.js';

/** Zod → AppError so malformed input always yields the shared VALIDATION_FAILED envelope. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError('VALIDATION_FAILED', r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '), {
      issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,31}$/, 'use A-Z, 0-9, _ . - (max 32 characters)');
/** Installation position tag as used on the ship, e.g. 2.1.1.03 or ME-GEN-01. */
const PositionTag = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_./-]{0,39}$/, 'use A-Z, 0-9, _ . / - (max 40 characters)');
const Name = z.string().trim().min(1).max(120);
const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const Version = z.number().int().min(1);
const ActiveStatus = z.enum(['active', 'inactive']);
const SortOrder = z.number().int().min(0).max(100000);
export const ASSET_STATUSES = ['in_service', 'in_store', 'under_repair', 'out_of_service', 'condemned'] as const;
const AssetStatus = z.enum(ASSET_STATUSES);

export const Tombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

export const ClassificationCreate = z.strictObject({ code: Code, name: Name, kind: z.enum(['equipment', 'component']), parentId: Uuid.nullable().optional(), description: Text(500), status: ActiveStatus.optional() });
export const ClassificationUpdate = z.strictObject({ expectedVersion: Version, name: Name.optional(), description: Text(500), status: ActiveStatus.optional() });

export const PositionCreate = z.strictObject({
  shipId: Uuid, parentId: Uuid.nullable().optional(), positionTag: PositionTag, name: Name,
  classificationId: Uuid.nullable().optional(), sortOrder: SortOrder.optional(), status: ActiveStatus.optional(),
});
export const PositionUpdate = z.strictObject({
  expectedVersion: Version, positionTag: PositionTag.optional(), name: Name.optional(),
  classificationId: Uuid.nullable().optional(), sortOrder: SortOrder.optional(), status: ActiveStatus.optional(),
});

export const ResponsibilityCreate = z.strictObject({ positionId: Uuid, departmentId: Uuid, effectiveFrom: UtcTimestamp, effectiveTo: UtcTimestamp.nullable().optional(), reason: Text(500) });
export const ResponsibilityUpdate = z.strictObject({ expectedVersion: Version, departmentId: Uuid.optional(), effectiveFrom: UtcTimestamp.optional(), effectiveTo: UtcTimestamp.nullable().optional(), reason: Text(500) });
export const ResponsibilityReassign = z.strictObject({ positionId: Uuid, departmentId: Uuid, effectiveFrom: UtcTimestamp, reason: Text(500) });

export const AssetCreate = z.strictObject({
  name: Name, serialNumber: Text(80), manufacturer: Text(120), model: Text(120), classificationId: Uuid.nullable().optional(),
  homeShipId: Uuid.nullable().optional(), notes: Text(1000),
  assetStatus: AssetStatus.optional(), custody: PartyRef.optional(), locationId: Uuid.optional(), positionId: Uuid.optional(),
});
export const AssetUpdate = z.strictObject({
  expectedVersion: Version, name: Name.optional(), serialNumber: Text(80), manufacturer: Text(120), model: Text(120),
  classificationId: Uuid.nullable().optional(), notes: Text(1000),
});

const Common = { locationId: Uuid.optional(), custody: PartyRef.optional(), assetStatus: AssetStatus.optional(), occurredAt: UtcTimestamp.optional(), note: Text(500) };
export const MovementCreate = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('install'), positionId: Uuid, ...Common }),
  z.strictObject({ kind: z.literal('remove'), ...Common }),
  z.strictObject({ kind: z.literal('custody_transfer'), ...Common, custody: PartyRef }),
  z.strictObject({ kind: z.literal('status_change'), ...Common, assetStatus: AssetStatus }),
  z.strictObject({ kind: z.literal('void'), correctsMovementId: Uuid, occurredAt: UtcTimestamp.optional(), note: z.string().trim().min(1).max(500) }),
]);
export type MovementInput = z.infer<typeof MovementCreate>;
