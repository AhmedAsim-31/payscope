import { z } from 'zod';

export type ScenarioDef = {
  id: string;
  number: number;
  title: string;
  simulates: string;
  recordsChanged: string;
  expectedOutcome: string;
  evidence: string;
};

export const SCENARIOS = [
  {
    id: 'successful-payment',
    number: 1,
    title: 'Successful payment',
    simulates: 'A provider reports a succeeded payment through a signed webhook.',
    recordsChanged: 'provider event, job, payment record',
    expectedOutcome: 'Event processed and a succeeded payment record exists.',
    evidence: 'event, job, payment',
  },
  {
    id: 'failed-payment',
    number: 2,
    title: 'Failed payment',
    simulates: 'A provider reports a payment that failed.',
    recordsChanged: 'provider event, job, payment record',
    expectedOutcome: 'Event processed and the payment record is failed.',
    evidence: 'event, job, payment',
  },
  {
    id: 'subscription-lifecycle',
    number: 3,
    title: 'Subscription lifecycle transition',
    simulates: 'A subscription is created, goes past due, then ends.',
    recordsChanged: 'provider events, jobs, subscription record, entitlement',
    expectedOutcome: 'Subscription ends expired and the granted entitlement is no longer active.',
    evidence: 'events, jobs, subscription, entitlement',
  },
  {
    id: 'refund',
    number: 4,
    title: 'Refund',
    simulates: 'A succeeded payment is later fully refunded.',
    recordsChanged: 'provider events, jobs, payment record',
    expectedOutcome: 'Payment is refunded with the full amount recorded as refunded.',
    evidence: 'events, jobs, payment',
  },
  {
    id: 'duplicate-webhook',
    number: 5,
    title: 'Duplicate webhook',
    simulates: 'The same signed webhook is delivered twice over HTTP.',
    recordsChanged: 'provider event, job, payment record',
    expectedOutcome:
      'Second delivery is acknowledged as duplicate; one event and one payment exist.',
    evidence: 'event, job, payment, HTTP responses',
  },
  {
    id: 'out-of-order-webhook',
    number: 6,
    title: 'Out-of-order webhook',
    simulates: 'A refund event arrives before the payment event it refers to.',
    recordsChanged: 'provider events, jobs, payment record',
    expectedOutcome:
      'Early refund waits for its payment event; the payment keeps its real amount, ends refunded.',
    evidence: 'events, jobs, payment',
  },
  {
    id: 'provider-api-failure',
    number: 7,
    title: 'Provider API failure',
    simulates: 'The provider API is unreachable during a provider-mode reconciliation run.',
    recordsChanged: 'reconciliation run, finding',
    expectedOutcome:
      'Run finishes partial with a low-severity provider_unavailable finding, not a crash.',
    evidence: 'run, finding, payment',
  },
  {
    id: 'processing-failure',
    number: 8,
    title: 'Processing failure',
    simulates: 'A verified event carries a malformed payload the processor cannot apply.',
    recordsChanged: 'provider event, job, processing attempt',
    expectedOutcome: 'Event needs attention, the job is dead, and the failed attempt is recorded.',
    evidence: 'event, job',
  },
  {
    id: 'payment-inactive-entitlement',
    number: 9,
    title: 'Successful payment with inactive entitlement',
    simulates: 'A customer paid and has an active subscription but no entitlement was granted.',
    recordsChanged: 'events, jobs, payment, subscription, reconciliation run, finding',
    expectedOutcome: 'Local reconciliation raises an entitlement_missing_or_stale finding.',
    evidence: 'events, payment, subscription, run, finding',
  },
  {
    id: 'expired-active-entitlement',
    number: 10,
    title: 'Expired subscription with active entitlement',
    simulates: 'A subscription ended but its entitlement was never revoked.',
    recordsChanged: 'events, jobs, subscription, entitlement, reconciliation run, finding',
    expectedOutcome: 'Local reconciliation raises an expired_externally_active_locally finding.',
    evidence: 'events, subscription, entitlement, run, finding',
  },
  {
    id: 'invalid-signature',
    number: 11,
    title: 'Invalid signature',
    simulates: 'A webhook arrives signed with the wrong secret.',
    recordsChanged: 'none (request rejected)',
    expectedOutcome: 'HTTP 400 WEBHOOK_SIGNATURE_INVALID and no event is stored.',
    evidence: 'HTTP response',
  },
  {
    id: 'cross-tenant-access',
    number: 12,
    title: 'Cross-tenant access attempt',
    simulates: 'A member of this organization requests another organization by id.',
    recordsChanged: 'none (requests rejected)',
    expectedOutcome: 'HTTP 404 on every attempt, with no hint that the other organization exists.',
    evidence: 'HTTP responses',
  },
  {
    id: 'retry-exhaustion',
    number: 13,
    title: 'Retry exhaustion and dead letter',
    simulates: 'The provider stays unavailable for every processing attempt.',
    recordsChanged: 'provider event, job, processing attempts',
    expectedOutcome: 'Three attempts fail, the job is dead and the event needs attention.',
    evidence: 'event, job',
  },
  {
    id: 'reconciliation-mismatch',
    number: 14,
    title: 'Reconciliation mismatch',
    simulates: 'The provider reports a different payment status than the local record.',
    recordsChanged: 'reconciliation run, finding',
    expectedOutcome: 'Provider-mode run raises a status_mismatch finding for the payment.',
    evidence: 'run, finding, payment',
  },
  {
    id: 'recovery-after-failure',
    number: 15,
    title: 'Recovery after simulated failure',
    simulates: 'The provider is down for the first attempt and recovers before the retry.',
    recordsChanged: 'provider event, job, processing attempts, payment record',
    expectedOutcome: 'First attempt fails, the retry succeeds and the payment is recorded.',
    evidence: 'event, job, payment',
  },
  {
    id: 'concurrent-duplicate-processing',
    number: 16,
    title: 'Concurrent duplicate processing',
    simulates: 'Two workers process two jobs for the same event at the same moment.',
    recordsChanged: 'provider event, two jobs, payment record',
    expectedOutcome: 'The event is applied exactly once: one payment, one successful attempt.',
    evidence: 'event, jobs, payment',
  },
  {
    id: 'worker-crash-recovery',
    number: 17,
    title: 'Worker crash and expired lease recovery',
    simulates: 'A worker claims a job and dies before finishing it.',
    recordsChanged: 'provider event, job, payment record',
    expectedOutcome:
      'The lease expires, recovery requeues the job and a different worker completes it.',
    evidence: 'event, job, payment, worker ids',
  },
] as const satisfies readonly ScenarioDef[];

export type ScenarioId = (typeof SCENARIOS)[number]['id'];
export const SCENARIO_IDS = SCENARIOS.map((s) => s.id) as [ScenarioId, ...ScenarioId[]];

export const SCENARIO_RUN_STATUSES = ['running', 'passed', 'failed', 'errored'] as const;

const idList = z.array(z.uuid());

export const scenarioEvidenceSchema = z.object({
  eventIds: idList,
  jobIds: idList,
  findingIds: idList,
  runIds: idList,
  paymentIds: idList,
  subscriptionIds: idList,
  entitlementIds: idList,
  http: z.array(z.object({ request: z.string(), status: z.number(), code: z.string().nullable() })),
  notes: z.array(z.string()),
});
export type ScenarioEvidence = z.infer<typeof scenarioEvidenceSchema>;

export const scenarioResultSchema = z.object({
  checks: z.array(
    z.object({ label: z.string(), passed: z.boolean(), detail: z.string().nullish() }),
  ),
  evidence: scenarioEvidenceSchema,
});
export type ScenarioResult = z.infer<typeof scenarioResultSchema>;

export const scenarioRunSchema = z.object({
  id: z.uuid(),
  scenarioId: z.string(),
  status: z.enum(SCENARIO_RUN_STATUSES),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  error: z.string().nullable(),
  result: scenarioResultSchema.nullable(),
});
export type ScenarioRun = z.infer<typeof scenarioRunSchema>;

export const scenarioCatalogItemSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  simulates: z.string(),
  recordsChanged: z.string(),
  expectedOutcome: z.string(),
  evidence: z.string(),
  mode: z.literal('Local simulation'),
  lastRun: scenarioRunSchema.nullable(),
});
export const scenarioCatalogSchema = z.object({ data: z.array(scenarioCatalogItemSchema) });
export type ScenarioCatalogItem = z.infer<typeof scenarioCatalogItemSchema>;

export const resetResultSchema = z.object({ deletedRuns: z.number() });
