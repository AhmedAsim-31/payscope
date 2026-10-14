import { ApiClientError } from '@/lib/api-client';

export type ErrorContext =
  | 'create-org'
  | 'add-member'
  | 'change-role'
  | 'remove-member'
  | 'transfer-ownership'
  | 'retry-event'
  | 'start-run'
  | 'triage-finding'
  | 'incident-action'
  | 'repair'
  | 'run-scenario'
  | 'reset-scenarios'
  | 'create-connection'
  | 'update-connection'
  | 'verify-connection'
  | 'remove-credential'
  | 'export-csv';

const CONFLICT_MESSAGES: Record<string, string> = {
  SCENARIO_RUNNING: 'A scenario is already running. Wait for it to finish.',
  RUN_IN_PROGRESS: 'A reconciliation run is already running. Wait for it to finish.',
  FINDING_CLOSED: 'This finding is already resolved or dismissed. Refresh to see its state.',
  STILL_DETECTED:
    'The inconsistency is still detected locally, so the finding cannot be resolved yet. Fix the underlying data or use a correction.',
  ALREADY_CONSISTENT:
    'Nothing to correct: the data already matches. Refresh and resolve the finding.',
  SUBSCRIPTION_NOT_ACTIVE:
    'The subscription is no longer active, so the entitlement cannot be granted.',
  EVENT_IN_FLIGHT: 'This event is already pending or processing. Wait for it to finish.',
  PAYLOAD_PRUNED:
    'The raw payload of this event was removed by retention, so it cannot be reprocessed.',
  CONNECTION_NOT_VERIFIED:
    'The provider connection is not verified. Verify its credentials on the connections page first.',
  PROVIDER_NOT_CONFIGURED:
    'This connection cannot read records from the provider. Add sandbox credentials first.',
  PROVIDER_OBJECT_NOT_FOUND: 'The provider has no record of this object. Nothing was changed.',
  CONCURRENT_UPDATE: 'The record changed while the provider was being read. Try again.',
  REFUND_EXCEEDS_AMOUNT:
    'The provider amount is below what was refunded locally. Review the payment by hand.',
  SIMULATED_CONNECTION: 'Simulated connections have no provider account to test.',
  ALREADY_OWNER: 'That member is already an owner.',
  OWNERSHIP_CHANGED:
    'You are no longer an owner of this organization. Refresh to see current roles.',
  INVALID_TRANSITION:
    'That action is no longer allowed for this incident. Refresh to see its state.',
};

const UNPROCESSABLE_MESSAGES: Record<string, string> = {
  SELF_TRANSFER: 'Choose another member to receive ownership.',
  IDEMPOTENCY_KEY_REUSED:
    'This request was already submitted with different details. Close the dialog and start again.',
  PLAN_UNMAPPED:
    'The subscription plan has no entitlement mapping. Map it on the connection first.',
  NOT_LOCALLY_VERIFIABLE: 'This finding came from the provider and cannot be re-checked locally.',
  NOT_CORRECTABLE: 'This finding type has no entitlement correction.',
  PROVIDER_FETCH_UNSUPPORTED:
    'This provider cannot be read for that record type yet. Nothing was changed.',
  PROVIDER_STATUS_UNMAPPED:
    'The provider reported a status PayScope cannot map. Nothing was changed.',
  PROVIDER_MODE_UNAVAILABLE: 'This connection does not support provider-mode runs.',
  LIVE_KEYS_NOT_ALLOWED: 'Only sandbox API keys are accepted. Use a test or sandbox key.',
  NO_API_KEY: 'Add a sandbox API key before testing credentials.',
  VALIDATION_UNSUPPORTED: 'This provider has no credential check yet.',
};

const TARGET_CONTEXTS: readonly ErrorContext[] = [
  'start-run',
  'triage-finding',
  'incident-action',
  'repair',
];

const CONNECTION_CONTEXTS: readonly ErrorContext[] = [
  'create-connection',
  'update-connection',
  'verify-connection',
  'remove-credential',
];

const FALLBACK = 'Something went wrong. Try again.';

export function describeError(error: unknown, context: ErrorContext): string {
  if (!(error instanceof ApiClientError)) return FALLBACK;
  if (error.code === 'LAST_OWNER') {
    return 'An organization must keep at least one owner. Make another member an owner first.';
  }
  if (error.status === 409 && CONFLICT_MESSAGES[error.code])
    return CONFLICT_MESSAGES[error.code] ?? FALLBACK;
  if (error.status === 422 && UNPROCESSABLE_MESSAGES[error.code]) {
    return UNPROCESSABLE_MESSAGES[error.code] ?? FALLBACK;
  }
  if (context === 'retry-event') {
    if (error.status === 409) {
      return 'This event can no longer be retried. It may already have been retried. Refresh to see its current state.';
    }
    if (error.status === 404) return 'That event no longer exists.';
  }
  if (error.status === 502 && context === 'repair') {
    return 'The provider could not be reached or rejected the request. Nothing was changed.';
  }
  if (error.status === 429 && CONNECTION_CONTEXTS.includes(context)) {
    return 'Too many credential changes or tests. Wait a minute and try again.';
  }
  if (error.status === 429 && context === 'export-csv') {
    return 'Too many searches or exports. Wait a minute and try again.';
  }
  if (error.status === 429) return 'Too many scenario runs. Wait a few minutes and try again.';
  if (error.status === 403) return error.message || 'You do not have permission to do that.';
  if (
    error.status === 404 &&
    (TARGET_CONTEXTS.includes(context) || CONNECTION_CONTEXTS.includes(context))
  ) {
    return 'That record no longer exists. Refresh and try again.';
  }
  if (error.status === 404) {
    return context === 'add-member'
      ? 'No user with that email. They need to sign in to PayScope once first.'
      : 'That member no longer exists. Refresh the list.';
  }
  if (error.status === 409) {
    if (context === 'create-org') return 'That slug is already taken. Choose another.';
    if (context === 'add-member') return 'That user is already a member.';
    if (context === 'create-connection') {
      return 'A connection for that provider account already exists.';
    }
  }
  if (error.status === 400 || error.status === 422) return 'Check the values and try again.';
  return FALLBACK;
}
