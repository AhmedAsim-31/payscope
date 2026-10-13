import type { ProviderAdapter } from '../adapter';
import type { VerificationResult, WebhookRequest } from '../webhook';
import {
  fetchPaddlePayment,
  fetchPaddleSubscription,
  validatePaddleCredentials,
} from './paddle-client';
import { PaddleEnvelopeSchema } from './paddle-envelope';
import { normalizePaddleEvent } from './paddle-normalize';
import { verifyPaddleSignature } from './paddle-signature';

function signatureHeader(headers: WebhookRequest['headers']): string | undefined {
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'paddle-signature') return value;
  }
  return undefined;
}

function verifyWebhookSync(
  req: WebhookRequest,
  secrets: readonly string[],
  now: Date,
): VerificationResult {
  const result = verifyPaddleSignature(req.rawBody, signatureHeader(req.headers), secrets, now);
  if (!result.ok) return result;
  try {
    const envelope = PaddleEnvelopeSchema.parse(JSON.parse(req.rawBody.toString('utf8')));
    return {
      ok: true,
      providerEventId: envelope.event_id,
      occurredAt: new Date(envelope.occurred_at),
    };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export const paddleAdapter: ProviderAdapter = {
  provider: 'paddle',
  capabilities: {
    webhookVerification: 'supported_tested',
    eventNormalization: 'supported_tested',
    authoritativeFetch: 'implemented_unverified',
    credentialValidation: 'implemented_unverified',
    reconciliation: 'implemented_unverified',
    idMapping: 'unsupported',
  },
  verifyWebhook: (req, secrets, now) => Promise.resolve(verifyWebhookSync(req, secrets, now)),
  normalizeEvent: normalizePaddleEvent,
  fetchPayment: fetchPaddlePayment,
  fetchSubscription: fetchPaddleSubscription,
  validateCredentials: validatePaddleCredentials,
};
