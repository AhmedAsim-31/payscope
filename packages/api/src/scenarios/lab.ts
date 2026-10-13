import { and, eq, inArray } from 'drizzle-orm';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import type { ScenarioEvidence } from '@payscope/shared/scenario-schemas';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { providerEventsTable } from '../db/schema/events';
import { backgroundJobsTable } from '../db/schema/jobs';
import { reconciliationFindingsTable, reconciliationRunsTable } from '../db/schema/reconciliation';
import { createRunReconciliationHandler } from '../jobs/handlers/run-reconciliation';
import { RUN_RECONCILIATION_JOB_KIND } from '../jobs/handlers/run-reconciliation';
import { createProcessProviderEventHandler } from '../jobs/handlers/process-provider-event';
import { enqueueJob } from '../jobs/job-queue';
import { createWorker, type Worker } from '../jobs/worker';
import {
  identifyEvent,
  ingestVerifiedEvent,
  PROCESS_EVENT_JOB_KIND,
} from '../webhooks/ingest-event';
import type { EventIdentity } from '../webhooks/ingest-event';
import {
  createLabCustomer,
  ensureLabConnection,
  type LabConnection,
  type LabCustomer,
} from './lab-setup';
import { createMirrorFetch, type ProviderOverride } from './mirror-fetch';
import type { Obj } from './stripe-payloads';

export type ScenarioEnv = {
  db: Db;
  cipher: CredentialsCipher;
  adapters: AdapterRegistry;
  orgId: string;
  runId: string;
  startedBy: string | null;
};

export type Ingested = { eventId: string; jobId: string; duplicate: boolean };
export type Check = { label: string; passed: boolean; detail?: string };

const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };

export type Lab = Awaited<ReturnType<typeof createLab>>;
export type Scenario = (lab: Lab) => Promise<void>;

export async function createLab(env: ScenarioEnv) {
  const { db, adapters, orgId } = env;
  const tag = env.runId.replaceAll('-', '').slice(0, 8);
  const connection: LabConnection = await ensureLabConnection(db, env.cipher, orgId);
  const checks: Check[] = [];
  const ids = {
    eventIds: new Set<string>(),
    jobIds: new Set<string>(),
    findingIds: new Set<string>(),
    runIds: new Set<string>(),
    paymentIds: new Set<string>(),
    subscriptionIds: new Set<string>(),
    entitlementIds: new Set<string>(),
  };
  const http: ScenarioEvidence['http'] = [];
  const notes: string[] = [];
  const faults = new Map<string, number>();
  const overrides = new Map<string, ProviderOverride>();

  const base = adapters.get('stripe');
  const faulty: AdapterRegistry = {
    get: (provider) => {
      const adapter = adapters.get(provider);
      return {
        ...adapter,
        normalizeEvent(payload) {
          const normalized = adapter.normalizeEvent(payload);
          const remaining = faults.get(normalized.providerEventId) ?? 0;
          if (remaining > 0) {
            faults.set(normalized.providerEventId, remaining - 1);
            throw new ProviderError('unavailable', 'Simulated provider outage');
          }
          return normalized;
        },
      };
    },
  };
  const handlers = {
    [PROCESS_EVENT_JOB_KIND]: createProcessProviderEventHandler(faulty),
    [RUN_RECONCILIATION_JOB_KIND]: createRunReconciliationHandler(adapters, env.cipher, {
      fetch: createMirrorFetch(db, overrides),
    }),
  };

  function worker(workerId = `scenario-lab-${tag}`): Worker {
    return createWorker({ db, handlers, logger: quiet, workerId, concurrency: 5 });
  }
  const defaultWorker = worker();

  async function lookup(providerEventId: string): Promise<Ingested['eventId'] | undefined> {
    const [event] = await db
      .select({ id: providerEventsTable.id })
      .from(providerEventsTable)
      .where(
        and(
          eq(providerEventsTable.connectionId, connection.id),
          eq(providerEventsTable.providerEventId, providerEventId),
        ),
      );
    return event?.id;
  }

  async function ingestWith(
    providerEventId: string,
    payload: object,
    identity: EventIdentity,
  ): Promise<Ingested> {
    const { duplicate } = await ingestVerifiedEvent(db, {
      orgId,
      connectionId: connection.id,
      provider: 'stripe',
      providerEventId,
      payload,
      identity,
    });
    const eventId = await lookup(providerEventId);
    if (!eventId) throw new Error('ingested event not found');
    const [job] = await db
      .select({ id: backgroundJobsTable.id })
      .from(backgroundJobsTable)
      .where(eq(backgroundJobsTable.idempotencyKey, `event:${eventId}`));
    if (!job) throw new Error('ingested event has no job');
    ids.eventIds.add(eventId);
    ids.jobIds.add(job.id);
    return { eventId, jobId: job.id, duplicate };
  }

  const lab = {
    env,
    tag,
    connection,
    http,
    worker,
    overrides,
    findEventId: lookup,
    check(label: string, passed: boolean, detail?: string) {
      checks.push({ label, passed, ...(detail === undefined ? {} : { detail }) });
    },
    note(text: string) {
      notes.push(text);
    },
    track(kind: keyof typeof ids, ...values: string[]) {
      for (const value of values) ids[kind].add(value);
    },
    customer(key: string): Promise<LabCustomer> {
      return createLabCustomer(db, orgId, connection.id, tag, key);
    },
    ingest(payload: Obj): Promise<Ingested> {
      const adapter = base;
      const { providerEventId } = adapter.normalizeEvent(payload);
      return ingestWith(
        providerEventId,
        payload,
        identifyEvent(adapter, payload, null, new Date()),
      );
    },
    ingestUnprocessable(providerEventId: string, payload: Obj, occurredAt: Date) {
      return ingestWith(providerEventId, payload, {
        eventType: 'payment_intent.succeeded',
        normalizedType: null,
        occurredAt,
        objectRef: null,
      });
    },
    async drain(jobIds: string[], w: Worker = defaultWorker): Promise<void> {
      await w.drainOnce(jobIds);
    },
    async deliver(payload: Obj): Promise<Ingested> {
      const ingested = await lab.ingest(payload);
      await lab.drain([ingested.jobId]);
      return ingested;
    },
    failNext(providerEventId: string, times: number) {
      faults.set(providerEventId, times);
    },
    async event(eventId: string) {
      const [row] = await db
        .select()
        .from(providerEventsTable)
        .where(eq(providerEventsTable.id, eventId));
      if (!row) throw new Error('event not found');
      return row;
    },
    async job(jobId: string) {
      const [row] = await db
        .select()
        .from(backgroundJobsTable)
        .where(eq(backgroundJobsTable.id, jobId));
      if (!row) throw new Error('job not found');
      return row;
    },
    async reconcile(mode: 'local' | 'provider') {
      const [run] = await db
        .insert(reconciliationRunsTable)
        .values({
          orgId,
          connectionId: connection.id,
          mode,
          scope: { connectionId: connection.id },
          triggeredBy: env.startedBy,
        })
        .returning({ id: reconciliationRunsTable.id });
      if (!run) throw new Error('run insert returned no row');
      const job = await enqueueJob(db, {
        kind: RUN_RECONCILIATION_JOB_KIND,
        payload: { runId: run.id },
        orgId,
        idempotencyKey: `run:${run.id}`,
      });
      if (!job) throw new Error('run job not enqueued');
      await lab.drain([job.id]);
      ids.runIds.add(run.id);
      ids.jobIds.add(job.id);
      const [done] = await db
        .select()
        .from(reconciliationRunsTable)
        .where(eq(reconciliationRunsTable.id, run.id));
      return done;
    },
    async findings(runId: string, subjectIds: string[]) {
      if (subjectIds.length === 0) return [];
      const rows = await db
        .select()
        .from(reconciliationFindingsTable)
        .where(
          and(
            eq(reconciliationFindingsTable.orgId, orgId),
            eq(reconciliationFindingsTable.lastSeenRunId, runId),
            inArray(reconciliationFindingsTable.subjectId, subjectIds),
          ),
        );
      for (const row of rows) ids.findingIds.add(row.id);
      return rows;
    },
    result() {
      const sets = Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, [...v]])) as Pick<
        ScenarioEvidence,
        keyof typeof ids
      >;
      return { checks, evidence: { ...sets, http, notes } };
    },
  };
  return lab;
}
