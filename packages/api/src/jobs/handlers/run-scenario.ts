import { z } from 'zod';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import { SCENARIO_IDS, type ScenarioId } from '@payscope/shared/scenario-schemas';
import type { CredentialsCipher } from '../../crypto/credentials-cipher';
import { createLab } from '../../scenarios/lab';
import { RUN_SCENARIO_JOB_KIND } from '../../scenarios/scenario-job';
import { SCENARIO_IMPLEMENTATIONS } from '../../scenarios/scenario-registry';
import { finishScenarioRun, getScenarioRun } from '../../scenarios/scenario-run-repo';
import { PermanentJobError, sanitizeError } from '../job-errors';
import type { JobHandler } from '../worker';

export { RUN_SCENARIO_JOB_KIND };

const payloadSchema = z.object({ runId: z.uuid() });

export function createRunScenarioHandler(
  adapters: AdapterRegistry,
  cipher?: CredentialsCipher,
): JobHandler {
  return async (job, { db }) => {
    const parsed = payloadSchema.safeParse(job.payload);
    if (!parsed.success || !job.orgId) throw new PermanentJobError('invalid_job_payload');
    if (!cipher) throw new PermanentJobError('credentials_unavailable');
    const run = await getScenarioRun(db, job.orgId, parsed.data.runId);
    if (!run || run.status !== 'running') return;
    const known = SCENARIO_IDS.find((id): id is ScenarioId => id === run.scenarioId);
    if (!known) {
      await finishScenarioRun(db, run.id, { status: 'errored', error: 'unknown_scenario' });
      return;
    }
    let lab: Awaited<ReturnType<typeof createLab>> | undefined;
    try {
      lab = await createLab({
        db,
        cipher,
        adapters,
        orgId: job.orgId,
        runId: run.id,
        startedBy: run.startedBy,
      });
      await SCENARIO_IMPLEMENTATIONS[known](lab);
      const result = lab.result();
      const passed = result.checks.length > 0 && result.checks.every((c) => c.passed);
      await finishScenarioRun(db, run.id, { status: passed ? 'passed' : 'failed', result });
    } catch (err) {
      await finishScenarioRun(db, run.id, {
        status: 'errored',
        error: sanitizeError(err),
        ...(lab ? { result: lab.result() } : {}),
      });
    }
  };
}
