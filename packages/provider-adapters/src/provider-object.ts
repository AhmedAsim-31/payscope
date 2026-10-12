import type { ProviderName } from './provider-name';

export type ProviderObjectSnapshot = {
  provider: ProviderName;
  objectId: string;
  status: string;
  amountMinor: bigint | null;
  currency: string | null;
  fetchedAt: Date;
  raw: Record<string, unknown>;
};
