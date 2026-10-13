import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import { PROCESS_EVENT_JOB_KIND } from '../webhooks/ingest-event';
import { createProcessProviderEventHandler } from './handlers/process-provider-event';
import {
  RUN_RECONCILIATION_JOB_KIND,
  createRunReconciliationHandler,
} from './handlers/run-reconciliation';
import type { JobHandlers } from './worker';

export function createDefaultHandlers(
  adapters: AdapterRegistry,
  cipher?: CredentialsCipher,
): JobHandlers {
  return {
    [PROCESS_EVENT_JOB_KIND]: createProcessProviderEventHandler(adapters),
    [RUN_RECONCILIATION_JOB_KIND]: createRunReconciliationHandler(adapters, cipher),
  };
}
