import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './records-schemas';

export const AUDIT_ACTOR_TYPES = ['user', 'system'] as const;
export const AUDIT_OUTCOMES = ['success', 'failure'] as const;

export const AUDIT_SEARCH_MAX = 200;

export const auditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
    cursor: z.string().max(512).optional(),
    action: z.string().min(1).max(100).optional(),
    actor: z.uuid().optional(),
    targetType: z.string().min(1).max(100).optional(),
    targetId: z.string().min(1).max(100).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    q: z.string().trim().min(1).max(AUDIT_SEARCH_MAX).optional(),
  })
  .refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), {
    message: 'from must not be after to',
    path: ['to'],
  });

export const auditEntrySchema = z.object({
  id: z.uuid(),
  actorId: z.uuid().nullable(),
  actorType: z.enum(AUDIT_ACTOR_TYPES),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
  previousState: z.record(z.string(), z.unknown()).nullable(),
  resultingState: z.record(z.string(), z.unknown()).nullable(),
  outcome: z.enum(AUDIT_OUTCOMES),
  requestId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

export const auditPageSchema = z.object({
  items: z.array(auditEntrySchema),
  nextCursor: z.string().nullable(),
});
