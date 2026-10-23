import { z } from 'zod';
import { EntityRef, UtcTimestamp, Uuid } from '../../platform/contracts.js';
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

const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,31}$/, 'use A-Z, 0-9, _ . - (max 32 characters)');
const Name = z.string().trim().min(1).max(120);
const Text = (max: number) => z.string().trim().max(max).nullable().optional();
const Version = z.number().int().min(1);
const ActiveStatus = z.enum(['active', 'inactive']);
export const Username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/, '3-32 characters: a-z, 0-9, . _ -');
const Password = z.string().min(1).max(256);
const Gate = z.string().regex(/^[a-z]{2,4}\.[a-z0-9_]+\.[a-z0-9_]+$/, 'gate codes look like wrk.job_card.approve');

export const Tombstone = z.strictObject({ expectedVersion: Version, reason: z.string().trim().min(1).max(500) });

export const UserCreate = z.strictObject({ displayName: Name, rank: Text(60), serviceNumber: Text(40), status: ActiveStatus.optional() });
export const UserUpdate = z.strictObject({ expectedVersion: Version, displayName: Name.optional(), rank: Text(60), serviceNumber: Text(40), status: ActiveStatus.optional() });

export const RoleCreate = z.strictObject({ code: Code, name: Name, description: Text(500), status: ActiveStatus.optional() });
export const RoleUpdate = z.strictObject({ expectedVersion: Version, name: Name.optional(), description: Text(500), status: ActiveStatus.optional() });
export const RolePermissionCreate = z.strictObject({ roleId: Uuid, permission: z.string().trim().min(1).max(64) });
export const RolePermissionSet = z.strictObject({ permissions: z.array(z.string().trim().min(1).max(64)).max(1000) });

export const AssignmentCreate = z.strictObject({
  userId: Uuid, roleId: Uuid,
  scopeKind: z.enum(['fleet', 'command', 'ship', 'workshop', 'department']),
  scopeId: Uuid.nullable().optional(),
  validFrom: UtcTimestamp.optional(),
  validUntil: UtcTimestamp.nullable().optional(),
});
export const AssignmentUpdate = z.strictObject({ expectedVersion: Version, validFrom: UtcTimestamp.optional(), validUntil: UtcTimestamp.nullable().optional() });

export const OfflineGrantCreate = z.strictObject({ installationId: Uuid.nullable().optional(), roleId: Uuid.nullable().optional(), leaseDays: z.number().int().min(1).max(365) });
export const OfflineGrantUpdate = z.strictObject({ expectedVersion: Version, leaseDays: z.number().int().min(1).max(365) });

const Mode = z.enum(['mandatory_prior', 'review_pending_allowed', 'none']);
const Offline = z.enum(['allow', 'provisional', 'deny']);
export const GatePolicyCreate = z.strictObject({ gateCode: Gate, mode: Mode, offlinePolicy: Offline.optional() });
export const GatePolicyUpdate = z.strictObject({ expectedVersion: Version, mode: Mode.optional(), offlinePolicy: Offline.optional() });

export const UserInstallationCreate = z.strictObject({ userId: Uuid, installationId: Uuid, leaseExpiresAt: UtcTimestamp.nullable().optional() });
export const UserInstallationUpdate = z.strictObject({ expectedVersion: Version, leaseExpiresAt: UtcTimestamp.nullable().optional() });

export const CredentialSet = z.strictObject({ username: Username, password: Password, expectedVersion: Version.optional() });
export const Login = z.strictObject({ username: z.string().trim().toLowerCase().min(1).max(64), password: Password });
export const ChangePassword = z.strictObject({ currentPassword: Password, newPassword: Password });
export const ResetLocal = z.strictObject({ password: Password });

export const ApprovalCreate = z.strictObject({
  gateCode: Gate,
  subject: EntityRef,
  decision: z.enum(['approved', 'rejected']),
  decidedAt: UtcTimestamp.optional(),
  comment: Text(1000),
});
export const Ratify = z.strictObject({ comment: Text(1000) });
export const RevocationCreate = z.strictObject({
  userId: Uuid,
  roleAssignmentId: Uuid.nullable().optional(),
  kind: z.enum(['revoke', 'reinstate']).optional(),
  effectiveAt: UtcTimestamp.optional(),
  reason: z.string().trim().min(1).max(500),
});
export const ClockReset = z.strictObject({ reason: z.string().trim().min(1).max(500) });
