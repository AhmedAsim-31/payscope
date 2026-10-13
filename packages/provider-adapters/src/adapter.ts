import type { ProviderCapabilities } from './capabilities';
import type { NormalizedEvent } from './normalized-event';
import type { ProviderContext } from './provider-context';
import type { ProviderName } from './provider-name';
import type { ListWindow, ProviderObjectPage, ProviderObjectSnapshot } from './provider-object';
import type { VerificationResult, WebhookRequest } from './webhook';

export type ProviderAdapter = {
  provider: ProviderName;
  capabilities: ProviderCapabilities;
  verifyWebhook(
    req: WebhookRequest,
    secrets: readonly string[],
    now: Date,
  ): Promise<VerificationResult>;
  normalizeEvent(payload: unknown): NormalizedEvent;
  fetchPayment?(ctx: ProviderContext, id: string): Promise<ProviderObjectSnapshot>;
  fetchPaymentSubscription?(ctx: ProviderContext, paymentId: string): Promise<string | null>;
  fetchSubscription?(ctx: ProviderContext, id: string): Promise<ProviderObjectSnapshot>;
  listPayments?(
    ctx: ProviderContext,
    window: ListWindow,
    cursor: string | null,
  ): Promise<ProviderObjectPage>;
  validateCredentials?(ctx: ProviderContext): Promise<void>;
};
