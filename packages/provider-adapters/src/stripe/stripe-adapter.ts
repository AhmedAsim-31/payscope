import type { ProviderAdapter } from '../adapter';
import type { VerificationResult } from '../webhook';
import { fetchPayment, fetchSubscription, validateCredentials } from './stripe-client';
import { normalizeStripeEvent } from './stripe-normalize';
import { verifyStripeSignature } from './stripe-signature';

function findHeader(headers: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? undefined : headers[key];
}

function readEventId(rawBody: Buffer): string | undefined {
  try {
    const body: unknown = JSON.parse(rawBody.toString('utf8'));
    const id =
      typeof body === 'object' && body !== null ? (body as { id?: unknown }).id : undefined;
    return typeof id === 'string' && id ? id : undefined;
  } catch {
    return undefined;
  }
}

export const stripeAdapter: ProviderAdapter = {
  provider: 'stripe',
  capabilities: {
    webhookVerification: 'supported_tested',
    eventNormalization: 'supported_tested',
    authoritativeFetch: 'implemented_unverified',
    reconciliation: 'implemented_unverified',
    credentialValidation: 'implemented_unverified',
    idMapping: 'unsupported',
  },
  verifyWebhook(req, secrets, now): Promise<VerificationResult> {
    const result = verifyStripeSignature(
      req.rawBody,
      findHeader(req.headers, 'stripe-signature'),
      secrets,
      now,
    );
    if (!result.ok) return Promise.resolve(result);
    const providerEventId = readEventId(req.rawBody);
    if (!providerEventId) return Promise.resolve({ ok: false, reason: 'malformed' });
    return Promise.resolve({ ok: true, providerEventId, occurredAt: result.timestamp });
  },
  normalizeEvent: normalizeStripeEvent,
  fetchPayment,
  fetchSubscription,
  validateCredentials,
};
