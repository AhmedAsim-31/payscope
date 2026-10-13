import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Role } from '@payscope/shared/permissions';
import { StatusBadge } from '@/components/records/status-badge';
import { ApiClientError, apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { PayloadViewer } from './payload-viewer';
import { RetryEventButton } from './retry-event-button';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

const mockedFetch = vi.mocked(apiFetch);
const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const EVENT_ID = '11111111-1111-4111-8111-111111111111';

function renderButton(role: Role, status: string) {
  renderWithQuery(
    <RetryEventButton orgId={ORG_ID} eventId={EVENT_ID} status={status} role={role} />,
  );
}

describe('RetryEventButton gating', () => {
  it.each([
    ['OPERATOR', 'failed', true],
    ['ADMIN', 'needs_attention', true],
    ['VIEWER', 'failed', false],
    ['OPERATOR', 'processed', false],
    ['OPERATOR', 'pending', false],
  ] as const)('%s on %s event: visible=%s', (role, status, visible) => {
    renderButton(role, status);
    expect(screen.queryByRole('button', { name: 'Retry processing' }) !== null).toBe(visible);
  });
});

describe('RetryEventButton flow', () => {
  it('confirms, posts the retry, and stays busy until it settles', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mockedFetch.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderButton('OPERATOR', 'failed');
    await userEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
    expect(screen.getByText(/goes back to pending/)).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Retry processing' }),
    );
    expect(await screen.findByRole('button', { name: 'Working...' })).toBeDisabled();
    expect(mockedFetch.mock.calls[0]?.[0]).toBe(`/api/v1/orgs/${ORG_ID}/events/${EVENT_ID}/retry`);
    finish({ eventId: EVENT_ID, status: 'pending' });
    await waitFor(() => expect(screen.queryByText(/goes back to pending/)).not.toBeInTheDocument());
  });

  it('explains a 409', async () => {
    mockedFetch.mockRejectedValue(new ApiClientError(409, 'NOT_RETRYABLE', 'nope'));
    renderButton('OPERATOR', 'failed');
    await userEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Retry processing' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('can no longer be retried');
  });
});

describe('PayloadViewer', () => {
  it('renders redacted placeholders as text', () => {
    renderWithQuery(<PayloadViewer payload={{ id: 'evt_1', receipt_email: '[REDACTED]' }} />);
    expect(screen.getByText(/"receipt_email": "\[REDACTED\]"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy payload' })).toBeInTheDocument();
  });
});

describe('event status badges', () => {
  it.each([
    ['needs_attention', 'Needs attention'],
    ['dead', 'Dead'],
    ['skipped', 'Skipped'],
  ])('shows %s as text', (status, text) => {
    renderWithQuery(<StatusBadge status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
