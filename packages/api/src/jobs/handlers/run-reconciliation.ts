import { z } from 'zod';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import type { CredentialsCipher } from '../../crypto/credentials-cipher';
import {
  DEFAULT_EXECUTOR_OPTIONS,
  executeRun,
  type ExecutorOptions,
} from '../../reconciliation/run-executor';
import { finishRun } from '../../reconciliation/run-store';
import { PermanentJobError, isRetryable, sanitizeError } from '../job-errors';
import type { JobHandler } from '../worker';

export const RUN_RECONCILIATION_JOB_KIND = 'run_reconciliation';

const payloadSchema = z.object({ runId: z.uuid() });

export function createRunReconciliationHandler(
  adapters: AdapterRegistry,
  cipher?: CredentialsCipher,
  options: Partial<ExecutorOptions> = {},
): JobHandler {
  return async (job, { db }) => {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success || !job.orgId) throw new PermanentJobError('invalid_job_payload');
    const orgId = job.orgId;
    const deps = { db, adapters, cipher, options: { ...DEFAULT_EXECUTOR_OPTIONS, ...options } };
    try {
      await executeRun(deps, orgId, parsed.data.runId);
    } catch (err) {
      if (!isRetryable(err) || job.attemptCount >= job.maxAttempts) {
        await finishRun(
          db,
          { id: parsed.data.runId, orgId },
          {
            status: 'failed',
            error: sanitizeError(err),
          },
        );
      }
      throw err;
    }
  };
}
