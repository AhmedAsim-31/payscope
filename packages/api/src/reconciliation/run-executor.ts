import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import type { Db } from '../db/client';
import { providerConnectionsTable } from '../db/schema/providers';
import { paymentRecordsTable as pay, subscriptionRecordsTable as sub } from '../db/schema/records';
import { LOCAL_RULES } from './local-rules';
import {
  checkBatch,
  resolveProviderTarget,
  type LocalObject,
  type ObjectKind,
  type ProviderTarget,
} from './provider-checks';
import {
  commitBatch,
  finishRun,
  loadRun,
  parseCheckpoint,
  RunNotRunningError,
  type Checkpoint,
  type Outcome,
} from './run-store';

export type ExecutorOptions = {
  batchSize: number;
  concurrency: number;
  requestCap: number;
  onBatchCommitted?: () => Promise<void> | void;
};

export const DEFAULT_EXECUTOR_OPTIONS: ExecutorOptions = {
  batchSize: 100,
  concurrency: 3,
  requestCap: 200,
};

export type ExecutorDeps = {
  db: Db;
  adapters: AdapterRegistry;
  cipher: CredentialsCipher | undefined;
  options: ExecutorOptions;
};

type RunRef = { id: string; orgId: string; connectionId: string | null };
type PhaseEnd = 'done' | Outcome;

async function runLocalPhase(
  deps: ExecutorDeps,
  run: RunRef,
  rule: (typeof LOCAL_RULES)[number],
  state: Checkpoint,
): Promise<void> {
  const { db, options } = deps;
  for (;;) {
    const candidates = await rule.find(db, {
      orgId: run.orgId,
      connectionId: run.connectionId,
      after: state.after,
      limit: options.batchSize,
    });
    const last = candidates.at(-1);
    if (!last) return;
    state.after = last.cursor;
    const n = candidates.length;
    const delta = { examined: n, matched: 0, mismatched: n, unavailable: 0, failed: 0 };
    await commitBatch(
      db,
      run,
      candidates.map((c) => c.draft),
      delta,
      state,
    );
    await options.onBatchCommitted?.();
  }
}

async function loadObjects(
  db: Db,
  run: RunRef,
  kind: ObjectKind,
  after: string | null,
  limit: number,
): Promise<LocalObject[]> {
  const t = kind === 'payment' ? pay : sub;
  const where: SQL | undefined = and(
    eq(t.orgId, run.orgId),
    run.connectionId ? eq(t.connectionId, run.connectionId) : undefined,
    after ? gt(t.id, after) : undefined,
  );
  if (kind === 'payment') {
    const rows = await db.select().from(pay).where(where).orderBy(asc(pay.id)).limit(limit);
    return rows.map((p) => ({
      id: p.id,
      providerObjectId: p.providerPaymentId,
      status: p.status,
      amountMinor: p.amountMinor,
      currency: p.currency,
    }));
  }
  const rows = await db.select().from(sub).where(where).orderBy(asc(sub.id)).limit(limit);
  return rows.map((s) => ({
    id: s.id,
    providerObjectId: s.providerSubscriptionId,
    status: s.status,
    amountMinor: null,
    currency: null,
  }));
}

async function runProviderPhase(
  deps: ExecutorDeps,
  run: RunRef,
  target: ProviderTarget,
  kind: ObjectKind,
  state: Checkpoint,
): Promise<PhaseEnd> {
  const { db, options } = deps;
  for (;;) {
    const remaining = options.requestCap - state.requests;
    const rows = await loadObjects(db, run, kind, state.after, options.batchSize);
    if (rows.length === 0) return 'done';
    const capped = rows.length > remaining;
    const objects = capped ? rows.slice(0, Math.max(remaining, 0)) : rows;
    if (objects.length > 0) {
      const result = await checkBatch(target, kind, objects, options.concurrency);
      state.after = objects[objects.length - 1]?.id ?? state.after;
      state.requests += result.delta.examined;
      await commitBatch(db, run, result.drafts, result.delta, state);
      await options.onBatchCommitted?.();
      if (result.authFailed) return { status: 'partial', error: 'provider_auth_failed' };
    }
    if (capped) return { status: 'partial', error: 'request_cap_reached' };
  }
}

async function resolveTarget(deps: ExecutorDeps, run: RunRef) {
  if (!run.connectionId) return { ok: false, reason: 'connection_required' } as const;
  const [connection] = await deps.db
    .select({
      id: providerConnectionsTable.id,
      provider: providerConnectionsTable.provider,
      credentialsCiphertext: providerConnectionsTable.credentialsCiphertext,
    })
    .from(providerConnectionsTable)
    .where(
      and(
        eq(providerConnectionsTable.orgId, run.orgId),
        eq(providerConnectionsTable.id, run.connectionId),
      ),
    );
  if (!connection) return { ok: false, reason: 'connection_not_found' } as const;
  return resolveProviderTarget(connection, deps.adapters, deps.cipher);
}

export async function executeRun(deps: ExecutorDeps, orgId: string, runId: string): Promise<void> {
  const { db } = deps;
  const run = await loadRun(db, orgId, runId);
  if (!run || run.status !== 'running') return;
  const ref: RunRef = { id: run.id, orgId, connectionId: run.connectionId };
  const saved = parseCheckpoint(run.checkpoint);

  const phases: { name: string; go: (state: Checkpoint) => Promise<PhaseEnd> }[] = [];
  if (run.mode === 'local') {
    for (const rule of LOCAL_RULES) {
      phases.push({
        name: rule.phase,
        go: async (state) => {
          await runLocalPhase(deps, ref, rule, state);
          return 'done';
        },
      });
    }
  } else {
    const resolved = await resolveTarget(deps, ref);
    if (!resolved.ok) {
      await finishRun(db, ref, { status: 'failed', error: resolved.reason });
      return;
    }
    const { target } = resolved;
    const kinds: [ObjectKind, boolean][] = [
      ['payment', target.adapter.fetchPayment !== undefined],
      ['subscription', target.adapter.fetchSubscription !== undefined],
    ];
    for (const [kind, supported] of kinds) {
      if (supported) {
        phases.push({
          name: `provider_${kind}`,
          go: (s) => runProviderPhase(deps, ref, target, kind, s),
        });
      }
    }
  }

  const startIndex = Math.max(
    0,
    phases.findIndex((p) => p.name === saved?.phase),
  );
  let requests = saved?.requests ?? 0;
  let forced: Outcome;
  try {
    for (const [i, phase] of phases.entries()) {
      if (i < startIndex) continue;
      const state: Checkpoint = {
        phase: phase.name,
        after: i === startIndex ? (saved?.after ?? null) : null,
        requests,
      };
      const end = await phase.go(state);
      requests = state.requests;
      if (end !== 'done') {
        forced = end;
        break;
      }
    }
  } catch (err) {
    if (err instanceof RunNotRunningError) return;
    throw err;
  }
  await finishRun(db, ref, forced);
}
