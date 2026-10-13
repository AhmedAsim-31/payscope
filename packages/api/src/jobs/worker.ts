import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { computeBackoffMs } from './backoff';
import { isRetryable, sanitizeError } from './job-errors';
import { PermanentJobError } from './permanent-job-error';
import {
  claimJobs,
  completeJob,
  extendLease,
  failJob,
  recoverExpiredLeases,
  type Job,
} from './job-queue';

export type JobLogger = {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
};

export type JobContext = { db: Db; logger: JobLogger; workerId: string };
export type JobHandler = (job: Job, ctx: JobContext) => Promise<void>;
export type JobHandlers = Record<string, JobHandler>;

export type WorkerOptions = {
  db: Db;
  handlers: JobHandlers;
  logger: JobLogger;
  workerId?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  leaseSeconds?: number;
  stopTimeoutMs?: number;
  recoverEveryPolls?: number;
  now?: () => Date;
  random?: () => number;
};

export type Worker = ReturnType<typeof createWorker>;

export function createWorker(opts: WorkerOptions) {
  const { db, handlers, logger } = opts;
  const workerId = opts.workerId ?? `worker-${randomUUID()}`;
  const concurrency = opts.concurrency ?? 4;
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;
  const leaseSeconds = opts.leaseSeconds ?? 60;
  const stopTimeoutMs = opts.stopTimeoutMs ?? 10_000;
  const recoverEveryPolls = opts.recoverEveryPolls ?? 30;
  const now = opts.now ?? (() => new Date());
  const ctx: JobContext = { db, logger, workerId };

  const inFlight = new Set<Promise<unknown>>();
  let loop: Promise<void> | undefined;
  let stopping = false;
  let wake: (() => void) | undefined;

  function track<T>(promise: Promise<T>): Promise<T> {
    inFlight.add(promise);
    const forget = () => inFlight.delete(promise);
    promise.then(forget, forget);
    return promise;
  }

  async function withHeartbeat(job: Job, run: () => Promise<void>): Promise<void> {
    const timer = setInterval(
      () => {
        extendLease(db, job.id, workerId, leaseSeconds).then(
          (held) => {
            if (!held) logger.warn({ jobId: job.id, kind: job.kind }, 'job_lease_lost');
          },
          (err: unknown) => logger.error({ jobId: job.id, err }, 'job_heartbeat_failed'),
        );
      },
      Math.max(10, (leaseSeconds * 1000) / 2),
    );
    try {
      await run();
    } finally {
      clearInterval(timer);
    }
  }

  async function finalize(job: Job, err: unknown, started: number): Promise<void> {
    const fields = { jobId: job.id, kind: job.kind, attempt: job.attemptCount };
    const durationMs = Math.round(performance.now() - started);
    const handler = handlers[job.kind];
    let applied: boolean;
    let outcome: string;
    if (err === undefined) {
      applied = await completeJob(db, job.id, workerId);
      outcome = 'succeeded';
    } else {
      const retryable = handler !== undefined && isRetryable(err);
      const backoff = computeBackoffMs(job.attemptCount, opts.random);
      applied = await failJob(db, job.id, workerId, {
        error: sanitizeError(err),
        retryable,
        nextAvailableAt: new Date(now().getTime() + backoff),
      });
      outcome = retryable && job.attemptCount < job.maxAttempts ? 'retry_scheduled' : 'dead';
    }
    if (!applied) logger.warn({ ...fields, durationMs }, 'job_lease_lost');
    else logger.info({ ...fields, durationMs, outcome }, 'job_finished');
  }

  async function runJob(job: Job): Promise<void> {
    const started = performance.now();
    try {
      const handler = handlers[job.kind];
      let err: unknown;
      if (!handler) {
        err = new PermanentJobError('unsupported_job_kind');
      } else {
        try {
          await withHeartbeat(job, () => handler(job, ctx));
        } catch (thrown) {
          err = thrown ?? new Error('unknown_error');
        }
      }
      await finalize(job, err, started);
    } catch (err) {
      logger.error({ jobId: job.id, kind: job.kind, err }, 'job_finalize_failed');
    }
  }

  async function drainOnce(onlyJobIds?: string[]): Promise<{ claimed: number }> {
    const jobs = await claimJobs(db, {
      workerId,
      limit: concurrency,
      leaseSeconds,
      ...(onlyJobIds ? { onlyJobIds } : {}),
    });
    await track(Promise.all(jobs.map((job) => runJob(job))));
    return { claimed: jobs.length };
  }

  function recover(): Promise<number> {
    return recoverExpiredLeases(db);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async function run(): Promise<void> {
    let polls = 0;
    while (!stopping) {
      try {
        if (polls % recoverEveryPolls === 0) {
          const recovered = await recover();
          if (recovered > 0) logger.warn({ recovered }, 'jobs_recovered');
        }
        polls += 1;
        const { claimed } = await drainOnce();
        if (claimed === 0 && !stopping) await sleep(pollIntervalMs);
      } catch (err) {
        logger.error({ err }, 'worker_poll_failed');
        if (!stopping) await sleep(pollIntervalMs);
      }
    }
  }

  function start(): void {
    if (loop) return;
    stopping = false;
    loop = run();
  }

  async function stop(): Promise<void> {
    stopping = true;
    wake?.();
    let timeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timeout = setTimeout(() => resolve('timeout'), stopTimeoutMs);
    });
    const settled = Promise.all([loop, ...inFlight]).then(() => 'done' as const);
    const result = await Promise.race([settled, timedOut]);
    clearTimeout(timeout);
    if (result === 'timeout') logger.warn({ inFlight: inFlight.size }, 'worker_stop_timed_out');
    loop = undefined;
  }

  return { workerId, start, stop, drainOnce, recover };
}
