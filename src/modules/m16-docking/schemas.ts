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
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'not a real date');
/** Decimal sizes may arrive as numbers or as text typed into a form ("18.5"). */
const decimal = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v), z.number().positive().max(max)).nullable().optional();
const Metres = decimal(1000);

export const DOCK_KINDS = ['graving_dock', 'floating_dock', 'slipway', 'shiplift'] as const;
export const DOCKING_TYPES = ['routine', 'emergency', 'refit', 'survey', 'other'] as const;
export const DOCKING_STATUSES = ['planned', 'in_dock', 'undocked', 'completed', 'cancelled'] as const;
export const ITEM_CATEGORIES = ['hull', 'underwater_fittings', 'propulsion', 'rudder_steering', 'sea_valves', 'cathodic_protection', 'painting', 'sensors', 'other'] as const;
export const ITEM_STATUSES = ['open', 'in_progress', 'done', 'deferred', 'cancelled'] as const;
export const SURVEY_AREAS = ['hull_plating', 'propeller', 'shaft', 'rudder', 'sea_chest', 'anodes', 'paint_coating', 'stabilisers', 'echo_sounder_log', 'other'] as const;
export const CONDITIONS = ['good', 'fair', 'poor', 'defective'] as const;

export const Tombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

const dockFields = {
  name: Name, kind: z.enum(DOCK_KINDS), operator: Text(160), maxLengthM: Metres, maxBeamM: Metres, maxDraughtM: Metres,
  liftCapacityT: decimal(1_000_000), capacityShips: z.number().int().min(1).max(10).optional(), note: Text(1000),
  status: z.enum(['active', 'inactive']).optional(),
};
export const DockCreate = z.strictObject({ code: Code, ...dockFields });
export const DockUpdate = z.strictObject({ expectedVersion: Version, ...dockFields, name: Name.optional(), kind: z.enum(DOCK_KINDS).optional() });

const datesInOrder = (v: { plannedDockIn?: string | undefined; plannedUndock?: string | undefined }) => !v.plannedDockIn || !v.plannedUndock || v.plannedUndock >= v.plannedDockIn;
const DATE_ORDER = { message: 'the planned undocking date cannot be before the planned docking date', path: ['plannedUndock'] };

export const DockingCreate = z.strictObject({
  shipId: Uuid, dockId: Uuid.nullable().optional(), reference: z.string().trim().min(1).max(60).nullable().optional(), dockingType: z.enum(DOCKING_TYPES).optional(),
  purpose: Text(2000), authority: Text(160), plannedDockIn: LocalDate, plannedUndock: LocalDate, remarks: Text(2000),
}).refine(datesInOrder, DATE_ORDER);
export const DockingUpdate = z.strictObject({
  expectedVersion: Version, dockId: Uuid.nullable().optional(), reference: z.string().trim().min(1).max(60).nullable().optional(), dockingType: z.enum(DOCKING_TYPES).optional(),
  purpose: Text(2000), authority: Text(160), plannedDockIn: LocalDate.optional(), plannedUndock: LocalDate.optional(), remarks: Text(2000),
}).refine(datesInOrder, DATE_ORDER);
export const DockIn = z.strictObject({ expectedVersion: Version, dockedAt: UtcTimestamp.optional(), dockId: Uuid.optional() });
export const Undock = z.strictObject({ expectedVersion: Version, undockedAt: UtcTimestamp.optional() });
export const Complete = z.strictObject({
  expectedVersion: Version, nextDueOn: LocalDate.optional(), intervalMonths: z.number().int().min(1).max(120).optional(), completedAt: UtcTimestamp.optional(), remarks: Text(2000),
}).refine((v) => (v.nextDueOn === undefined) !== (v.intervalMonths === undefined), { message: 'give either nextDueOn or intervalMonths', path: ['nextDueOn'] });
export const Cancel = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

export const ItemCreate = z.strictObject({
  category: z.enum(ITEM_CATEGORIES), title: Name, description: Text(2000), assetId: Uuid.nullable().optional(), executedBy: Text(160), note: Text(1000),
});
export const ItemUpdate = z.strictObject({
  expectedVersion: Version, category: z.enum(ITEM_CATEGORIES).optional(), title: Name.optional(), description: Text(2000), assetId: Uuid.nullable().optional(),
  executedBy: Text(160), note: Text(1000), status: z.enum(ITEM_STATUSES).optional(), completedAt: UtcTimestamp.optional(),
});
export const ItemWorkOrder = z.strictObject({ priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), requestedDue: LocalDate.optional() });

export const Survey = z.strictObject({
  area: z.enum(SURVEY_AREAS), condition: z.enum(CONDITIONS), finding: z.string().trim().min(1).max(2000), measurement: Text(300), surveyedBy: Text(160),
  actionRequired: z.boolean().optional(), surveyedAt: UtcTimestamp.optional(),
});
