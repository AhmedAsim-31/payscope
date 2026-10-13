import { z } from 'zod';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './records-schemas';

export const RUN_STATUSES = ['running', 'completed', 'failed', 'partial'] as const;
export const RUN_MODES = ['local', 'provider'] as const;
export const FINDING_TYPES = [
  'provider_payment_missing_locally',
  'status_mismatch',
  'refund_inconsistent',
  'expired_externally_active_locally',
  'entitlement_missing_or_stale',
  'provider_object_not_found',
  'provider_unavailable',
  'mapping_missing_or_ambiguous',
] as const;
export const FINDING_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const FINDING_STATUSES = ['open', 'reviewed', 'resolved', 'dismissed'] as const;

const isoDate = z.iso.datetime();

export const startRunBodySchema = z.object({
  connectionId: z.uuid().optional(),
  mode: z.enum(RUN_MODES),
});

export const runCountsSchema = z.object({
  examined: z.number().int(),
  matched: z.number().int(),
  mismatched: z.number().int(),
  unavailable: z.number().int(),
  failed: z.number().int(),
});

export const runSchema = z.object({
  id: z.uuid(),
  connectionId: z.uuid().nullable(),
  mode: z.enum(RUN_MODES),
  status: z.enum(RUN_STATUSES),
  counts: runCountsSchema,
  error: z.string().nullable(),
  startedAt: isoDate,
  finishedAt: isoDate.nullable(),
  triggeredBy: z.uuid().nullable(),
});
export type ReconciliationRun = z.infer<typeof runSchema>;

export const runDetailSchema = runSchema.extend({
  scope: z.record(z.string(), z.unknown()),
  checkpoint: z.record(z.string(), z.unknown()),
});

const pageQuery = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().max(512).optional(),
};

export const runQuerySchema = z.object({ ...pageQuery });
export const runPageSchema = z.object({
  items: z.array(runSchema),
  nextCursor: z.string().nullable(),
});

export const findingQuerySchema = z.object({
  ...pageQuery,
  type: z.enum(FINDING_TYPES).optional(),
  status: z.enum(FINDING_STATUSES).optional(),
  severity: z.enum(FINDING_SEVERITIES).optional(),
});

export const findingSchema = z.object({
  id: z.uuid(),
  type: z.enum(FINDING_TYPES),
  severity: z.enum(FINDING_SEVERITIES),
  status: z.enum(FINDING_STATUSES),
  subjectType: z.string(),
  subjectId: z.uuid(),
  recommendedAction: z.string(),
  firstSeenRunId: z.uuid(),
  lastSeenRunId: z.uuid(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Finding = z.infer<typeof findingSchema>;

export const findingDetailSchema = findingSchema.extend({
  fingerprint: z.string(),
  evidence: z.record(z.string(), z.unknown()),
  resolvedAt: isoDate.nullable(),
  resolutionNote: z.string().nullable(),
});
export const findingPageSchema = z.object({
  items: z.array(findingSchema),
  nextCursor: z.string().nullable(),
});

export const updateFindingBodySchema = z.object({
  status: z.enum(['reviewed', 'dismissed']),
  note: z.string().trim().min(1).max(1000),
});
