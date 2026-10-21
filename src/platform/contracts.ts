/**
 * Canonical shapes shared by all modules and by sync. CONTRACTS.md explains the
 * rules; this file is the executable definition. Changing a shape here is a
 * contract change and needs a DECISIONS.md entry.
 */
import { z } from 'zod';
import { isLocalDate, isUtcIso } from './time.js';

export const Uuid = z.uuid();
export const UtcTimestamp = z.string().refine(isUtcIso, 'must be UTC ISO-8601 with ms, e.g. 2026-10-21T17:59:00.000Z');
export const LocalDateStr = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');

export const INSTALLATION_KINDS = ['hub', 'command', 'ship', 'workshop'] as const;
export type InstallationKind = (typeof INSTALLATION_KINDS)[number];

/** Who may change a record, and how it synchronizes (SYNC_RULES.md §2). */
export const RECORD_CLASSES = ['hub_reference', 'owner_mutable', 'event', 'derived', 'local'] as const;
export type RecordClass = (typeof RECORD_CLASSES)[number];

/** Reference to any org party: ownership, operating responsibility and executing provider are separate fields of this type. */
export const PartyRef = z.object({
  kind: z.enum(['command', 'ship', 'department', 'workshop', 'external_provider']),
  id: Uuid,
});
export type PartyRef = z.infer<typeof PartyRef>;

/** Generic pointer used instead of imports/foreign keys across module boundaries. */
export const EntityRef = z.object({ type: z.string().regex(/^[a-z]{2,4}\.[a-z0-9_]+$/), id: Uuid });
export type EntityRef = z.infer<typeof EntityRef>;

export const ScopeRef = z.object({
  kind: z.enum(['fleet', 'command', 'ship', 'workshop', 'department']),
  id: Uuid.optional(),
});
export type ScopeRef = z.infer<typeof ScopeRef>;

export const ActorSnapshot = z.object({
  displayName: z.string(),
  rank: z.string().optional(),
  serviceNumber: z.string().optional(),
  roles: z.array(z.string()).optional(),
});
export type ActorSnapshot = z.infer<typeof ActorSnapshot>;

/** Audit envelope. One row per business action; never updated or deleted. */
export const AuditEvent = z.object({
  id: Uuid,
  ownerInstallationId: Uuid,
  homeScopeId: Uuid.nullable(),
  occurredAt: UtcTimestamp, // actual time of the action (may precede recordedAt when entered later)
  recordedAt: UtcTimestamp,
  recordedBy: z.string(),
  action: z.string(), // e.g. create | update | tombstone | approve | login.failed
  entityType: z.string(),
  entityId: Uuid.nullable(),
  entityVersion: z.number().int().nullable(),
  actorUserId: z.string(), // immutable user id or 'system'; never a username
  actorSnapshot: ActorSnapshot.nullable(),
  correlationId: z.string(),
  reason: z.string().nullable(),
  authorityBasis: z.record(z.string(), z.unknown()).nullable(), // role assignment / offline grant used
  changes: z.record(z.string(), z.tuple([z.unknown(), z.unknown()])).nullable(), // field -> [old, new]
  outcome: z.enum(['success', 'denied', 'failed']),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/** One replicated change (state-based: payload is the full row snapshot). Idempotent by changeId. */
export const SyncChange = z.object({
  changeId: Uuid,
  originInstallationId: Uuid,
  entityType: z.string(),
  entityId: Uuid,
  op: z.enum(['upsert', 'tombstone', 'event']),
  version: z.number().int().min(1),
  ownerInstallationId: Uuid,
  homeScopeId: Uuid.nullable(),
  occurredAt: UtcTimestamp,
  schemaVersion: z.number().int().min(0), // owning module's schema version at origin
  payload: z.record(z.string(), z.unknown()),
  payloadHash: z.string().length(64),
});
export type SyncChange = z.infer<typeof SyncChange>;

/** Every list/report response that mixes synchronized data carries freshness per scope. */
export const Freshness = z.object({
  scope: ScopeRef,
  asOf: UtcTimestamp.nullable(), // last successful sync covering this scope; null = never
  stale: z.boolean(),
  pendingOutbound: z.number().int().min(0), // local changes not yet acknowledged by hub
});
export type Freshness = z.infer<typeof Freshness>;

export const Principal = z.object({
  userId: z.string(),
  installationId: Uuid,
  displayName: z.string(),
  snapshot: ActorSnapshot.optional(),
});
export type Principal = z.infer<typeof Principal>;

export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
    correlationId: z.string(),
  }),
});

/**
 * Four independent status axes for repair cases and work orders (implemented in M05).
 * They never collapse into one status field.
 */
export const STATUS_AXES = {
  progress: ['planned', 'in_progress', 'on_hold', 'work_complete'],
  approval: ['not_required', 'pending_review', 'approved', 'rejected'],
  returnToService: ['not_assessed', 'restricted', 'cleared', 'withheld'],
  closure: ['open', 'closed', 'reopened'],
} as const;
