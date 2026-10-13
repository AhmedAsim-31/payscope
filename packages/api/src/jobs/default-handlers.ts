import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import { PROCESS_EVENT_JOB_KIND } from '../webhooks/ingest-event';
import { createProcessProviderEventHandler } from './handlers/process-provider-event';
import type { JobHandlers } from './worker';

export function createDefaultHandlers(adapters: AdapterRegistry): JobHandlers {
  return { [PROCESS_EVENT_JOB_KIND]: createProcessProviderEventHandler(adapters) };
}
