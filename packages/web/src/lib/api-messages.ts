import { ApiClientError } from '@/lib/api-client';

export type ErrorContext = 'create-org' | 'add-member' | 'change-role' | 'remove-member';

const FALLBACK = 'Something went wrong. Try again.';

export function describeError(error: unknown, context: ErrorContext): string {
  if (!(error instanceof ApiClientError)) return FALLBACK;
  if (error.code === 'LAST_OWNER') {
    return 'An organization must keep at least one owner. Make another member an owner first.';
  }
  if (error.status === 403) return error.message || 'You do not have permission to do that.';
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
