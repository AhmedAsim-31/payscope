import type { ScenarioId } from '@payscope/shared/scenario-schemas';
import { failedPayment, outOfOrderWebhook, refund, successfulPayment } from './payment-scenarios';
import {
  processingFailure,
  providerApiFailure,
  reconciliationMismatch,
  recoveryAfterFailure,
  retryExhaustion,
} from './failure-scenarios';
import { crossTenantAccess, duplicateWebhook, invalidSignature } from './http-scenarios';
import type { Scenario } from './lab';
import {
  expiredWithActiveEntitlement,
  paymentWithInactiveEntitlement,
  subscriptionLifecycle,
} from './subscription-scenarios';
import { concurrentDuplicateProcessing, workerCrashRecovery } from './worker-scenarios';

export const SCENARIO_IMPLEMENTATIONS: Record<ScenarioId, Scenario> = {
  'successful-payment': successfulPayment,
  'failed-payment': failedPayment,
  'subscription-lifecycle': subscriptionLifecycle,
  refund,
  'duplicate-webhook': duplicateWebhook,
  'out-of-order-webhook': outOfOrderWebhook,
  'provider-api-failure': providerApiFailure,
  'processing-failure': processingFailure,
  'payment-inactive-entitlement': paymentWithInactiveEntitlement,
  'expired-active-entitlement': expiredWithActiveEntitlement,
  'invalid-signature': invalidSignature,
  'cross-tenant-access': crossTenantAccess,
  'retry-exhaustion': retryExhaustion,
  'reconciliation-mismatch': reconciliationMismatch,
  'recovery-after-failure': recoveryAfterFailure,
  'concurrent-duplicate-processing': concurrentDuplicateProcessing,
  'worker-crash-recovery': workerCrashRecovery,
};
