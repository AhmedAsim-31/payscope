import type { ProviderAdapter } from '@payscope/provider-adapters/adapter';
import { ProviderError } from '@payscope/provider-adapters/provider-error';
import type { ProviderName } from '@payscope/provider-adapters/provider-name';
import type { AllowedBaseUrl, ProviderContext } from '@payscope/provider-adapters/provider-context';
import type { AdapterRegistry } from '@payscope/provider-adapters/registry';
import type { CredentialsCipher } from '../crypto/credentials-cipher';
import { findAdapter } from '../providers/adapter-registry';
import type { FindingDraft } from './finding-upsert';
import type { BatchDelta } from './run-store';

export const BASE_URLS: Record<ProviderName, AllowedBaseUrl> = {
  stripe: 'https://api.stripe.com',
  paddle: 'https://sandbox-api.paddle.com',
  paypal: 'https://api-m.sandbox.paypal.com',
  revenuecat: 'https://api.revenuecat.com',
};

export type ProviderTarget = { adapter: ProviderAdapter; ctx: ProviderContext };
export type Resolved = { ok: true; target: ProviderTarget } | { ok: false; reason: string };

type ConnectionLike = {
  id: string;
  provider: ProviderName;
  credentialsCiphertext: Buffer | null;
};

export function resolveProviderTarget(
  connection: ConnectionLike,
  adapters: AdapterRegistry,
  cipher: CredentialsCipher | undefined,
  fetchImpl: typeof fetch = fetch,
): Resolved {
  const adapter = findAdapter(adapters, connection.provider);
  if (!adapter) return { ok: false, reason: 'no_adapter_for_provider' };
  if (adapter.capabilities.authoritativeFetch === 'unsupported') {
    return { ok: false, reason: 'authoritative_fetch_unsupported' };
  }
  if (!adapter.fetchPayment && !adapter.fetchSubscription) {
    return { ok: false, reason: 'authoritative_fetch_unsupported' };
  }
  if (!connection.credentialsCiphertext) return { ok: false, reason: 'no_credentials' };
  if (!cipher) return { ok: false, reason: 'credentials_unavailable' };
  let apiKey: string | undefined;
  try {
    apiKey = cipher.decrypt(connection.credentialsCiphertext, connection.id).apiKey;
  } catch {
    return { ok: false, reason: 'credentials_unavailable' };
  }
  if (!apiKey) return { ok: false, reason: 'no_api_key' };
  return {
    ok: true,
    target: {
      adapter,
      ctx: { credentials: { apiKey }, baseUrl: BASE_URLS[connection.provider], fetch: fetchImpl },
    },
  };
}

export type LocalObject = {
  id: string;
  providerObjectId: string;
  status: string;
  amountMinor: bigint | null;
  currency: string | null;
};

export type ObjectKind = 'payment' | 'subscription';

export type BatchResult = {
  drafts: FindingDraft[];
  delta: BatchDelta;
  authFailed: boolean;
};

const SETTLED_LOCALLY = new Set(['refunded', 'partially_refunded', 'disputed']);

function statusAgrees(local: string, remote: string): boolean {
  const r = remote.toLowerCase().replace('cancelled', 'canceled');
  return local === r || (SETTLED_LOCALLY.has(local) && r === 'succeeded');
}

type Fetched =
  | { kind: 'ok'; status: string; amountMinor: bigint | null; currency: string | null }
  | { kind: 'not_found' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'auth' }
  | { kind: 'failed' };

async function fetchOne(target: ProviderTarget, kind: ObjectKind, id: string): Promise<Fetched> {
  const { adapter, ctx } = target;
  try {
    const snap =
      kind === 'payment'
        ? await adapter.fetchPayment?.(ctx, id)
        : await adapter.fetchSubscription?.(ctx, id);
    if (!snap) return { kind: 'failed' };
    return {
      kind: 'ok',
      status: snap.status,
      amountMinor: snap.amountMinor,
      currency: snap.currency,
    };
  } catch (err) {
    if (!(err instanceof ProviderError)) return { kind: 'failed' };
    if (err.category === 'not_found') return { kind: 'not_found' };
    if (err.category === 'unavailable' || err.category === 'transient') {
      return { kind: 'unavailable', message: err.message.slice(0, 200) };
    }
    return err.category === 'provider_auth' ? { kind: 'auth' } : { kind: 'failed' };
  }
}

function classify(
  kind: ObjectKind,
  obj: LocalObject,
  res: Fetched,
): FindingDraft | 'match' | undefined {
  const base = { subjectType: kind, subjectId: obj.id };
  const local = {
    status: obj.status,
    amountMinor: obj.amountMinor?.toString() ?? null,
    currency: obj.currency,
  };
  switch (res.kind) {
    case 'not_found':
      return {
        ...base,
        type: 'provider_object_not_found',
        severity: 'high',
        recommendedAction:
          'Confirm the object was deleted at the provider before removing it locally.',
        evidence: { providerObjectId: obj.providerObjectId, local },
      };
    case 'unavailable':
      return {
        ...base,
        type: 'provider_unavailable',
        severity: 'low',
        recommendedAction:
          'Re-run reconciliation when the provider is reachable; existence is unverified.',
        evidence: { providerObjectId: obj.providerObjectId, reason: res.message },
      };
    case 'ok': {
      const amountDiffers =
        res.amountMinor !== null && obj.amountMinor !== null && res.amountMinor !== obj.amountMinor;
      const currencyDiffers =
        res.currency !== null && obj.currency !== null && res.currency !== obj.currency;
      if (statusAgrees(obj.status, res.status) && !amountDiffers && !currencyDiffers)
        return 'match';
      return {
        ...base,
        type: 'status_mismatch',
        severity: 'high',
        recommendedAction: 'Review the provider state and repair the local record if it is stale.',
        evidence: {
          providerObjectId: obj.providerObjectId,
          local,
          provider: {
            status: res.status,
            amountMinor: res.amountMinor?.toString() ?? null,
            currency: res.currency,
          },
        },
      };
    }
    default:
      return undefined;
  }
}

export async function checkBatch(
  target: ProviderTarget,
  kind: ObjectKind,
  objects: LocalObject[],
  concurrency: number,
): Promise<BatchResult> {
  const result: BatchResult = {
    drafts: [],
    delta: { examined: 0, matched: 0, mismatched: 0, unavailable: 0, failed: 0 },
    authFailed: false,
  };
  for (let i = 0; i < objects.length && !result.authFailed; i += concurrency) {
    const slice = objects.slice(i, i + concurrency);
    const fetched = await Promise.all(slice.map((o) => fetchOne(target, kind, o.providerObjectId)));
    slice.forEach((obj, idx) => {
      const res = fetched[idx];
      if (!res) return;
      result.delta.examined += 1;
      if (res.kind === 'auth') {
        result.authFailed = true;
        result.delta.failed += 1;
        return;
      }
      const outcome = classify(kind, obj, res);
      if (outcome === 'match') result.delta.matched += 1;
      else if (outcome === undefined) result.delta.failed += 1;
      else {
        result.drafts.push(outcome);
        if (outcome.type === 'provider_unavailable') result.delta.unavailable += 1;
        else result.delta.mismatched += 1;
      }
    });
  }
  return result;
}
