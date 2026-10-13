import type { NormalizedEvent } from '@payscope/provider-adapters/normalized-event';
import type { Db } from '../db/client';

export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export type ApplyContext = {
  tx: Tx;
  orgId: string;
  connectionId: string;
  event: NormalizedEvent;
};

export type ApplyOutcome =
  { kind: 'applied' } | { kind: 'stale' } | { kind: 'noted'; note: string };
