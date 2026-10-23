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
const Priority = z.enum(['low', 'normal', 'high', 'urgent']);
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'not a real date');
const Hours = z.number().min(0).max(10_000_000).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'at most 2 decimal places');

export const Tombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

const Checklist = z.array(z.string().trim().min(1).max(200)).max(60);
export const TemplateCreate = z.strictObject({
  code: Code, name: Name, description: Text(2000), checklist: Checklist.default([]), estimatedMinutes: z.number().int().min(1).max(100000).nullable().optional(),
  classificationId: Uuid.nullable().optional(), priority: Priority.optional(), status: z.enum(['active', 'inactive']).optional(),
});
export const TemplateUpdate = z.strictObject({
  expectedVersion: Version, name: Name.optional(), description: Text(2000), checklist: Checklist.optional(), estimatedMinutes: z.number().int().min(1).max(100000).nullable().optional(),
  classificationId: Uuid.nullable().optional(), priority: Priority.optional(), status: z.enum(['active', 'inactive']).optional(),
});

export const MeterCreate = z.strictObject({ assetId: Uuid, name: Name, kind: z.enum(['running_hours', 'counter']).default('running_hours'), unit: z.string().trim().min(1).max(12).optional() });
export const MeterUpdate = z.strictObject({ expectedVersion: Version, name: Name.optional(), unit: z.string().trim().min(1).max(12).optional(), status: z.enum(['active', 'inactive']).optional() });
export const Reading = z.strictObject({ meterId: Uuid, reading: Hours, occurredAt: UtcTimestamp.optional(), note: Text(300) });
export const Replacement = z.strictObject({ meterId: Uuid, startReading: Hours, occurredAt: UtcTimestamp.optional(), note: Text(300) });

export const PlanCreate = z.strictObject({
  code: Code, title: Name, templateId: Uuid.nullable().optional(), assetId: Uuid.optional(), positionId: Uuid.optional(),
  triggerKind: z.enum(['calendar', 'running_hours']), intervalDays: z.number().int().min(1).max(36500).optional(), intervalHours: z.number().min(1).max(1_000_000).optional(), meterId: Uuid.optional(),
  leadDays: z.number().int().min(0).max(365).optional(), leadHours: z.number().min(0).max(100000).optional(), priority: Priority.optional(), startAt: UtcTimestamp.optional(),
}).refine((v) => (v.assetId === undefined) !== (v.positionId === undefined), { message: 'give exactly one of assetId or positionId' })
  .refine((v) => v.triggerKind !== 'calendar' || v.intervalDays !== undefined, { message: 'a calendar plan needs intervalDays', path: ['intervalDays'] })
  .refine((v) => v.triggerKind !== 'running_hours' || (v.intervalHours !== undefined && v.meterId !== undefined), { message: 'a running-hours plan needs intervalHours and meterId', path: ['intervalHours'] });
export const PlanUpdate = z.strictObject({
  expectedVersion: Version, title: Name.optional(), templateId: Uuid.nullable().optional(), intervalDays: z.number().int().min(1).max(36500).optional(), intervalHours: z.number().min(1).max(1_000_000).optional(),
  leadDays: z.number().int().min(0).max(365).optional(), leadHours: z.number().min(0).max(100000).optional(), priority: Priority.optional(), status: z.enum(['active', 'suspended']).optional(),
});
export const PlanComplete = z.strictObject({ doneAt: UtcTimestamp.optional(), doneHours: Hours.optional(), note: Text(300) });
export const Generate = z.strictObject({ planId: Uuid.optional() });

export const Calibration = z.strictObject({
  assetId: Uuid, result: z.enum(['pass', 'fail', 'adjusted']), nextDueOn: LocalDate.nullable().optional(), calibratedAt: UtcTimestamp.optional(),
  certificateNo: Text(80), calibratedBy: Text(120), note: Text(500),
});
