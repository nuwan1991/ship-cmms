import { z } from 'zod';
import { PartyRef, UtcTimestamp, Uuid } from '../../platform/contracts.js';
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
const Title = z.string().trim().min(1).max(160);
const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const Reason = z.string().trim().min(1).max(500);
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD');
export const SEVERITIES = ['minor', 'major', 'critical'] as const;
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const WORK_TYPES = ['corrective', 'preventive', 'inspection', 'modification'] as const;

export const Tombstone = z.strictObject({ expectedVersion: Version, reason: Reason });

export const DefectCreate = z.strictObject({
  title: Title, description: Text(2000), severity: z.enum(SEVERITIES).optional(),
  assetId: Uuid.nullable().optional(), positionId: Uuid.nullable().optional(), shipId: Uuid.nullable().optional(), reportedAt: UtcTimestamp.optional(),
});
export const DefectUpdate = z.strictObject({ expectedVersion: Version, title: Title.optional(), description: Text(2000), severity: z.enum(SEVERITIES).optional() });
export const DefectConvert = z.strictObject({ expectedVersion: Version, title: Title.optional(), priority: z.enum(PRIORITIES).optional(), repairCaseId: Uuid.optional() });
export const DefectDismiss = z.strictObject({ expectedVersion: Version, reason: Reason });

export const CaseUpdate = z.strictObject({ expectedVersion: Version, title: Title.optional(), description: Text(2000), priority: z.enum(PRIORITIES).optional() });
export const CaseCreate = z.strictObject({
  title: Title, description: Text(2000), priority: z.enum(PRIORITIES).optional(),
  assetId: Uuid.nullable().optional(), positionId: Uuid.nullable().optional(), shipId: Uuid.nullable().optional(),
});

export const WorkOrderCreate = z.strictObject({
  title: Title, description: Text(2000), workType: z.enum(WORK_TYPES).optional(), priority: z.enum(PRIORITIES).optional(),
  repairCaseId: Uuid.nullable().optional(), assetId: Uuid.nullable().optional(), positionId: Uuid.nullable().optional(), shipId: Uuid.nullable().optional(),
  operatingParty: PartyRef.nullable().optional(), executingParty: PartyRef.nullable().optional(), requestedDue: LocalDate.nullable().optional(),
});
export const WorkOrderUpdate = z.strictObject({
  expectedVersion: Version, title: Title.optional(), description: Text(2000), priority: z.enum(PRIORITIES).optional(),
  operatingParty: PartyRef.nullable().optional(), executingParty: PartyRef.nullable().optional(), requestedDue: LocalDate.nullable().optional(),
});

export const ProgressChange = z.strictObject({ to: z.enum(['in_progress', 'on_hold', 'work_complete']), note: Text(500), occurredAt: UtcTimestamp.optional() });
export const ReviewRequest = z.strictObject({ note: Text(500) });
export const ApprovalDecision = z.strictObject({ decision: z.enum(['approved', 'rejected']), comment: Text(500), decidedAt: UtcTimestamp.optional() });
export const Acceptance = z.strictObject({
  decision: z.enum(['accepted', 'rejected']), returnToService: z.enum(['restricted', 'cleared', 'withheld']).optional(),
  restrictions: Text(500), remarks: Text(1000), decidedAt: UtcTimestamp.optional(),
});
export const CloseRequest = z.strictObject({ note: Text(500) });
export const ReopenRequest = z.strictObject({ reason: Reason });

export const HandoverOffer = z.strictObject({ toParty: PartyRef, note: Text(500) });
export const HandoverRespond = z.strictObject({ offerId: Uuid, action: z.enum(['accept', 'decline', 'withdraw']), note: Text(500) });

export const JobCardCreate = z.strictObject({
  workOrderId: Uuid, title: Title, instructions: Text(4000), checklist: z.array(z.string().trim().min(1).max(200)).max(60).default([]),
});
export const JobCardUpdate = z.strictObject({
  expectedVersion: Version, title: Title.optional(), instructions: Text(4000),
  checklist: z.array(z.strictObject({ text: z.string().trim().min(1).max(200), done: z.boolean() })).max(60).optional(),
  status: z.enum(['issued', 'completed', 'void']).optional(),
});

export const LabourCreate = z.strictObject({
  workerName: z.string().trim().min(1).max(120), trade: Text(60), minutes: z.number().int().min(1).max(1440), note: Text(500), occurredAt: UtcTimestamp.optional(),
});
export const FindingCreate = z.strictObject({ kind: z.enum(['observation', 'cause', 'recommendation', 'additional_defect']), text: z.string().trim().min(1).max(2000), occurredAt: UtcTimestamp.optional() });
export const TestCreate = z.strictObject({
  testName: z.string().trim().min(1).max(160), result: z.enum(['pass', 'fail', 'not_applicable']), measuredValue: Text(120), note: Text(500), occurredAt: UtcTimestamp.optional(),
});

const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,31}$/, 'use A-Z, 0-9, _ . - (max 32 characters)');
export const AdvisoryCreate = z.strictObject({
  code: Code, title: Title, body: Text(4000), severity: z.enum(['info', 'caution', 'warning']).optional(), classificationId: Uuid.nullable().optional(),
  status: z.enum(['active', 'inactive']).optional(), issuedAt: UtcTimestamp.optional(),
});
export const AdvisoryUpdate = z.strictObject({
  expectedVersion: Version, title: Title.optional(), body: Text(4000), severity: z.enum(['info', 'caution', 'warning']).optional(),
  classificationId: Uuid.nullable().optional(), status: z.enum(['active', 'inactive']).optional(),
});
