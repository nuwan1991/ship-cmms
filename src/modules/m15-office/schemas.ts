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

// ---- common office fields
const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'not a real date');
const OptDate = LocalDate.nullable().optional();
export const Priority = z.enum(['immediate', 'high', 'normal', 'low']);
const OptUser = UserId.nullable().optional();
const OptUuid = z.uuid().nullable().optional();
export const ListParams = {
  limit: z.coerce.number().int().min(1).max(1000).default(100), offset: z.coerce.number().int().min(0).default(0),
  q: z.string().trim().min(1).max(80).optional(), sort: z.string().max(30).optional(), dir: z.enum(['asc', 'desc']).optional(),
};
const Bool = z.enum(['true', 'false']).transform((v) => v === 'true');

// ---- matters
export const MatterCreate = z.strictObject({ commandId: z.uuid(), title: Name, fileRef: Text(80), unitId: OptUuid, remarks: Text(2000) });
export const MatterUpdate = z.strictObject({ expectedVersion: Version, title: Name.optional(), fileRef: Text(80), unitId: OptUuid, status: z.enum(['open', 'closed']).optional(), remarks: Text(2000), reason: Text(500) });

// ---- correspondence
export const CORR_KINDS = ['incoming', 'outgoing', 'minute', 'signal', 'other'] as const;
export const CORR_STATUS: Record<(typeof CORR_KINDS)[number], readonly string[]> = {
  incoming: ['received', 'under_action', 'replied', 'filed', 'cancelled'],
  outgoing: ['draft', 'signed', 'dispatched', 'acknowledged', 'cancelled'],
  minute: ['open', 'filed', 'cancelled'],
  signal: ['received', 'under_action', 'replied', 'filed', 'cancelled'],
  other: ['open', 'filed', 'cancelled'],
};
const corrFields = {
  officialRef: Text(80), fileRef: Text(80), letterDate: OptDate, receivedDate: OptDate, sentDate: OptDate,
  originator: Text(200), recipients: Text(500), subject: z.string().trim().min(1).max(300),
  classification: z.enum(['unclassified', 'restricted']).optional(), priority: Priority.optional(),
  replyRequired: z.boolean().optional(), replyDue: OptDate, actionUserId: OptUser, unitId: OptUuid,
  dispatchMode: Text(60), matterId: OptUuid, remarks: Text(4000),
};
export const CorrCreate = z.strictObject({
  commandId: z.uuid(), kind: z.enum(CORR_KINDS), ...corrFields, replyToId: OptUuid,
  status: z.string().optional(), originalRef: Text(80),
  /** Register even when a letter with the same official reference and date exists (FR-C9). */
  allowDuplicate: z.boolean().optional(),
});
export const CorrUpdate = z.strictObject({ expectedVersion: Version, ...corrFields, subject: corrFields.subject.optional(), reason: Text(500) });
export const CorrStatus = z.strictObject({ expectedVersion: Version, status: z.string().min(1).max(20), note: Text(1000), reason: Text(500) });
export const CorrNoReply = z.strictObject({ expectedVersion: Version, reason: Reason });
export const CorrList = z.strictObject({
  ...ListParams, commandId: z.uuid(), kind: z.enum(CORR_KINDS).optional(), status: z.string().max(20).optional(), matterId: z.uuid().optional(),
  actionUserId: UserId.optional(), unitId: z.uuid().optional(), priority: Priority.optional(), pending: Bool.optional(), overdue: Bool.optional(),
  from: LocalDate.optional(), to: LocalDate.optional(),
});

// ---- handover
export const HOV_CATEGORIES = ['responsibility', 'project', 'pending_work', 'unresolved', 'correspondence', 'equipment', 'other'] as const;
export const HOI_STATUS = ['open', 'in_progress', 'completed', 'not_applicable'] as const;
export const PacketCreate = z.strictObject({
  commandId: z.uuid(), appointment: Name, unitId: OptUuid, fromName: Name, fromUserId: OptUser, toName: Name, toUserId: OptUser,
  handoverDate: OptDate, takeoverDate: OptDate, documentRef: Text(120), remarks: Text(4000),
});
export const PacketUpdate = z.strictObject({
  expectedVersion: Version, appointment: Name.optional(), unitId: OptUuid, fromName: Name.optional(), fromUserId: OptUser, toName: Name.optional(), toUserId: OptUser,
  handoverDate: OptDate, takeoverDate: OptDate, documentRef: Text(120), status: z.enum(['draft', 'signed', 'in_progress', 'completed']).optional(), remarks: Text(4000), reason: Text(500),
});
const itemFields = {
  annexRef: Text(80), category: z.enum(HOV_CATEGORIES), subject: z.string().trim().min(1).max(300), description: Text(4000), previousStatus: Text(1000),
  status: z.enum(HOI_STATUS).optional(), priority: Priority.optional(), urgent: z.boolean().optional(), responsibleUserId: OptUser, unitId: OptUuid,
  targetDate: OptDate, remarks: Text(4000), originalRef: Text(80),
};
export const ItemCreate = z.strictObject(itemFields);
export const ItemUpdate = z.strictObject({ expectedVersion: Version, ...itemFields, category: itemFields.category.optional(), subject: itemFields.subject.optional(), reason: Text(500) });
export const ItemAction = z.strictObject({ note: z.string().trim().min(1).max(4000), status: z.enum(HOI_STATUS).optional(), expectedVersion: Version });
export const ItemBulk = z.strictObject({ rows: z.array(z.unknown()).min(1).max(2000), commit: z.boolean().default(false) });
export const ItemList = z.strictObject({
  ...ListParams, status: z.enum(HOI_STATUS).optional(), category: z.enum(HOV_CATEGORIES).optional(), responsibleUserId: UserId.optional(),
  priority: Priority.optional(), urgent: Bool.optional(), overdue: Bool.optional(), open: Bool.optional(),
});
