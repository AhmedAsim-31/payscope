import { ApiClientError } from '@/lib/api-client';

export type ErrorContext =
  | 'create-org'
  | 'add-member'
  | 'change-role'
  | 'remove-member'
  | 'retry-event'
  | 'start-run'
  | 'triage-finding'
  | 'incident-action'
  | 'repair';

const CONFLICT_MESSAGES: Record<string, string> = {
  RUN_IN_PROGRESS: 'A reconciliation run is already running. Wait for it to finish.',
  FINDING_CLOSED: 'This finding is already resolved or dismissed. Refresh to see its state.',
  STILL_DETECTED:
    'The inconsistency is still detected locally, so the finding cannot be resolved yet. Fix the underlying data or use a correction.',
  ALREADY_CONSISTENT:
    'Nothing to correct: the data already matches. Refresh and resolve the finding.',
  SUBSCRIPTION_NOT_ACTIVE:
    'The subscription is no longer active, so the entitlement cannot be granted.',
  EVENT_IN_FLIGHT: 'This event is already pending or processing. Wait for it to finish.',
  INVALID_TRANSITION:
    'That action is no longer allowed for this incident. Refresh to see its state.',
};

const UNPROCESSABLE_MESSAGES: Record<string, string> = {
  IDEMPOTENCY_KEY_REUSED:
    'This request was already submitted with different details. Close the dialog and start again.',
  PLAN_UNMAPPED:
    'The subscription plan has no entitlement mapping. Map it on the connection first.',
  NOT_LOCALLY_VERIFIABLE: 'This finding came from the provider and cannot be re-checked locally.',
  NOT_CORRECTABLE: 'This finding type has no entitlement correction.',
  PROVIDER_MODE_UNAVAILABLE: 'This connection does not support provider-mode runs.',
};

const TARGET_CONTEXTS: readonly ErrorContext[] = [
  'start-run',
  'triage-finding',
  'incident-action',
  'repair',
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
  if (error.status === 403) return error.message || 'You do not have permission to do that.';
  if (error.status === 404 && TARGET_CONTEXTS.includes(context)) {
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
  }
  if (error.status === 400 || error.status === 422) return 'Check the values and try again.';
  return FALLBACK;
}
