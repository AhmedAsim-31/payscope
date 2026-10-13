import type { ProviderAdapter } from '../adapter';
import { createCertificateFetcher, type CertificateFetcher } from './paypal-cert-fetcher';
import {
  fetchPayPalPayment,
  fetchPayPalSubscription,
  validatePayPalCredentials,
} from './paypal-client';
import { PayPalEnvelopeSchema } from './paypal-envelope';
import { normalizePayPalEvent } from './paypal-normalize';
import { verifyPayPalSignature } from './paypal-signature';

/** secrets[0] is the PayPal webhook id. */
export function createPayPalAdapter(getCertificate: CertificateFetcher): ProviderAdapter {
  return {
    provider: 'paypal',
    capabilities: {
      webhookVerification: 'supported_tested',
      eventNormalization: 'implemented_unverified',
      authoritativeFetch: 'implemented_unverified',
      credentialValidation: 'implemented_unverified',
      reconciliation: 'implemented_unverified',
      idMapping: 'unsupported',
    },
    async verifyWebhook(req, secrets, now) {
      const result = await verifyPayPalSignature({
        rawBody: req.rawBody,
        headers: req.headers,
        webhookId: secrets[0] ?? '',
        now,
        getCertificate,
      });
      if (!result.ok) return result;
      try {
        const envelope = PayPalEnvelopeSchema.parse(JSON.parse(req.rawBody.toString('utf8')));
        return {
          ok: true,
          providerEventId: envelope.id,
          occurredAt: new Date(envelope.create_time),
        };
      } catch {
        return { ok: false, reason: 'malformed' };
      }
    },
    normalizeEvent: normalizePayPalEvent,
    fetchPayment: fetchPayPalPayment,
    fetchSubscription: fetchPayPalSubscription,
    validateCredentials: validatePayPalCredentials,
  };
}

export const paypalAdapter = createPayPalAdapter(createCertificateFetcher());
