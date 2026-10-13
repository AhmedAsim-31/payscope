import type { ProviderAdapter } from '../adapter';
import type { VerificationResult, WebhookRequest } from '../webhook';
import { verifyRevenueCatRequest } from './revenuecat-auth';
import { fetchRevenueCatSubscription, validateRevenueCatCredentials } from './revenuecat-client';
import { RevenueCatEnvelopeSchema } from './revenuecat-envelope';
import { normalizeRevenueCatEvent } from './revenuecat-normalize';

function verifyWebhookSync(
  req: WebhookRequest,
  secrets: readonly string[],
  now: Date,
): VerificationResult {
  const auth = verifyRevenueCatRequest(req.rawBody, req.headers, secrets, now);
  if (!auth.ok) return auth;
  try {
    const { event } = RevenueCatEnvelopeSchema.parse(JSON.parse(req.rawBody.toString('utf8')));
    return { ok: true, providerEventId: event.id, occurredAt: new Date(event.event_timestamp_ms) };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export const revenueCatAdapter: ProviderAdapter = {
  provider: 'revenuecat',
  capabilities: {
    webhookVerification: 'supported_tested',
    eventNormalization: 'supported_tested',
    authoritativeFetch: 'implemented_unverified',
    credentialValidation: 'implemented_unverified',
    reconciliation: 'implemented_unverified',
    idMapping: 'unsupported',
  },
  verifyWebhook: (req, secrets, now) => Promise.resolve(verifyWebhookSync(req, secrets, now)),
  normalizeEvent: normalizeRevenueCatEvent,
  fetchSubscription: fetchRevenueCatSubscription,
  validateCredentials: validateRevenueCatCredentials,
};
