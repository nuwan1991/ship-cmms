import { z } from 'zod';
import { AppError } from '../../platform/errors.js';
import { UtcTimestamp, Uuid } from '../../platform/contracts.js';

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
const Name = z.string().trim().min(1).max(120);
const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const Version = z.number().int().min(1);
const ActiveStatus = z.enum(['active', 'inactive']);
const SortOrder = z.number().int().min(0).max(100000);

export const FleetCreate = z.strictObject({ code: Code, name: Name });
export const CommandCreate = z.strictObject({ code: Code, name: Name, shortName: Text(40), sortOrder: SortOrder.optional(), status: ActiveStatus.optional() });
export const ShipCreate = z.strictObject({
  fleetId: Uuid.optional(),
  code: Code,
  name: Name,
  pennantNo: Text(20),
  shipClass: Text(60),
  shipType: Text(60),
  status: z.enum(['active', 'laid_up', 'decommissioned']).optional(),
});
export const AssignmentCreate = z.strictObject({
  shipId: Uuid,
  commandId: Uuid,
  effectiveFrom: UtcTimestamp,
  effectiveTo: UtcTimestamp.nullable().optional(),
  reason: Text(500),
});
export const DepartmentCreate = z.strictObject({ code: Code, name: Name, sortOrder: SortOrder.optional(), status: ActiveStatus.optional() });
export const WorkshopCreate = z.strictObject({
  code: Code,
  name: Name,
  kind: z.enum(['onboard', 'command', 'specialist']),
  commandId: Uuid.nullable().optional(),
  shipId: Uuid.nullable().optional(),
  hasReplica: z.boolean().optional(),
  status: ActiveStatus.optional(),
});
export const ProviderCreate = z.strictObject({
  code: Code,
  name: Name,
  contactName: Text(120),
  contactPhone: Text(40),
  contactEmail: z.string().trim().max(160).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'not an e-mail address').nullable().optional(),
  notes: Text(1000),
  status: ActiveStatus.optional(),
});
export const LocationCreate = z.strictObject({
  siteKind: z.enum(['ship', 'workshop']),
  siteId: Uuid,
  parentId: Uuid.nullable().optional(),
  code: Code,
  name: Name,
  kind: z.enum(['deck', 'compartment', 'space', 'room', 'tank', 'area', 'yard', 'other']).optional(),
  sortOrder: SortOrder.optional(),
  status: ActiveStatus.optional(),
});

/** Updates: every field optional, `expectedVersion` mandatory (CONTRACTS §9). Identity-defining fields are immutable. */
const upd = <S extends z.ZodObject>(s: S, immutable: Record<string, true> = {}) =>
  s.omit(immutable as never).partial().extend({ expectedVersion: Version });

export const FleetUpdate = upd(FleetCreate);
export const CommandUpdate = upd(CommandCreate);
export const ShipUpdate = upd(ShipCreate, { fleetId: true });
export const AssignmentUpdate = upd(AssignmentCreate, { shipId: true });
export const DepartmentUpdate = upd(DepartmentCreate);
export const WorkshopUpdate = upd(WorkshopCreate);
export const ProviderUpdate = upd(ProviderCreate);
export const LocationUpdate = upd(LocationCreate, { siteKind: true, siteId: true });

export const Tombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });
export const Reassign = z.strictObject({ shipId: Uuid, commandId: Uuid, effectiveFrom: UtcTimestamp, reason: Text(500) });
