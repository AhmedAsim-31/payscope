import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { RefreshRecordForm } from './refresh-record-form';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

const mockedFetch = vi.mocked(apiFetch);
const ORG = '11111111-1111-4111-8111-111111111111';
const PAYMENT = '22222222-2222-4222-8222-222222222222';

async function submit(kind: 'payment' | 'subscription' = 'payment') {
  const user = userEvent.setup();
  renderWithQuery(<RefreshRecordForm orgId={ORG} kind={kind} />);
  await user.type(
    screen.getByLabelText(kind === 'payment' ? 'Payment id' : 'Subscription id'),
    PAYMENT,
  );
  await user.click(screen.getByRole('button', { name: 'Refresh from provider' }));
  await user.type(screen.getByLabelText('Reason'), 'Provider shows it settled');
  const buttons = screen.getAllByRole('button', { name: 'Refresh from provider' });
  await user.click(buttons[buttons.length - 1]!);
}

describe('RefreshRecordForm', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('posts the payment id and shows the resulting state', async () => {
    mockedFetch.mockResolvedValue({
      action: 'refresh_from_provider',
      targetId: PAYMENT,
      previousState: { status: 'pending' },
      resultingState: { status: 'succeeded' },
    });
    await submit();

    await waitFor(() =>
      expect(screen.getByText('Payment refreshed: now succeeded.')).toBeInTheDocument(),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      `/api/v1/orgs/${ORG}/repairs/refresh-from-provider`,
      expect.objectContaining({
        body: JSON.stringify({ paymentId: PAYMENT, reason: 'Provider shows it settled' }),
      }),
    );
  });

  it('posts a subscription id and shows the resolved finding count', async () => {
    mockedFetch.mockResolvedValue({
      action: 'refresh_from_provider',
      targetId: PAYMENT,
      previousState: { status: 'active' },
      resultingState: { status: 'canceled', resolvedFindingIds: [ORG] },
    });
    await submit('subscription');

    await waitFor(() =>
      expect(
        screen.getByText('Subscription refreshed: now canceled. Resolved 1 finding.'),
      ).toBeInTheDocument(),
    );
    expect(mockedFetch).toHaveBeenCalledWith(
      `/api/v1/orgs/${ORG}/repairs/refresh-from-provider`,
      expect.objectContaining({
        body: JSON.stringify({ subscriptionId: PAYMENT, reason: 'Provider shows it settled' }),
      }),
    );
  });

  it('explains an unverified connection', async () => {
    mockedFetch.mockImplementation(() =>
      Promise.reject(
        new ApiClientError(
          409,
          'CONNECTION_NOT_VERIFIED',
          'The provider connection is not verified',
        ),
      ),
    );
    await submit();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('connection is not verified'),
    );
  });
});
