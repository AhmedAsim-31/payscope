import { z } from 'zod';
import { RECORD_PROVIDERS, pageQuerySchema } from './records-schemas';

export const EVENT_STATUSES = [
  'pending',
  'processing',
  'processed',
  'failed',
  'duplicate',
  'needs_attention',
  'ignored',
] as const;
export const ATTEMPT_OUTCOMES = ['succeeded', 'failed', 'skipped'] as const;
export const FAILURE_CATEGORIES = [
  'transient',
  'permanent',
  'invalid_input',
  'provider_auth',
  'unsupported_event',
  'state_conflict',
] as const;
export const JOB_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const;
export const RETRYABLE_EVENT_STATUSES = ['failed', 'needs_attention'] as const;

const isoDate = z.iso.datetime();
const nullableDate = isoDate.nullable();

export const eventSummarySchema = z.object({
  id: z.uuid(),
  provider: z.enum(RECORD_PROVIDERS),
  connectionId: z.uuid(),
  providerEventId: z.string(),
  eventType: z.string(),
  normalizedType: z.string().nullable(),
  status: z.enum(EVENT_STATUSES),
  attemptCount: z.number().int(),
  occurredAt: isoDate,
  receivedAt: isoDate,
});
export type EventSummary = z.infer<typeof eventSummarySchema>;

export const eventPageSchema = z.object({
  items: z.array(eventSummarySchema),
  nextCursor: z.string().nullable(),
});

export const eventAttemptSchema = z.object({
  id: z.uuid(),
  attemptNumber: z.number().int(),
  startedAt: isoDate,
  endedAt: nullableDate,
  durationMs: z.number().int().nullable(),
  outcome: z.enum(ATTEMPT_OUTCOMES).nullable(),
  failureCategory: z.enum(FAILURE_CATEGORIES).nullable(),
  errorMessage: z.string().nullable(),
  retryable: z.boolean().nullable(),
});
export type EventAttempt = z.infer<typeof eventAttemptSchema>;

export const eventJobSchema = z.object({
  status: z.enum(JOB_STATUSES),
  attemptCount: z.number().int(),
  maxAttempts: z.number().int(),
  availableAt: isoDate,
  lastError: z.string().nullable(),
});
export type EventJob = z.infer<typeof eventJobSchema>;

export const eventDetailSchema = eventSummarySchema.extend({
  processedAt: nullableDate,
  signatureVerified: z.boolean(),
  payload: z.unknown(),
  attempts: z.array(eventAttemptSchema),
  job: eventJobSchema.nullable(),
});
export type EventDetail = z.infer<typeof eventDetailSchema>;

export const eventQuerySchema = pageQuerySchema.extend({
  status: z.enum(EVENT_STATUSES).optional(),
  provider: z.enum(RECORD_PROVIDERS).optional(),
  connectionId: z.uuid().optional(),
  normalizedType: z.string().trim().min(1).max(100).optional(),
  objectRef: z.string().min(1).max(255).optional(),
  customerId: z.uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const retryResultSchema = z.object({ eventId: z.uuid(), status: z.literal('pending') });

export const jobSummarySchema = z.object({
  counts: z.object({
    queued: z.number().int(),
    running: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    dead: z.number().int(),
  }),
  oldestQueuedAgeSeconds: z.number().int().nullable(),
});
export type JobSummary = z.infer<typeof jobSummarySchema>;
