import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { PaymentsList } from './payments-list';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/app/org/payments',
  useSearchParams: () => new URLSearchParams(search),
}));

const mockedFetch = vi.mocked(apiFetch);
const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';

const payment = {
  id: '11111111-1111-4111-8111-111111111111',
  provider: 'stripe',
  connectionId: '22222222-2222-4222-8222-222222222222',
  providerPaymentId: 'pi_123',
  status: 'partially_refunded',
  amount: { amountMinor: '9007199254740993123', currency: 'USD' },
  amountRefunded: { amountMinor: '100', currency: 'USD' },
  customer: null,
  providerCreatedAt: null,
  createdAt: '2026-03-05T14:07:09.000Z',
};

beforeEach(() => {
  search = '';
});

describe('PaymentsList', () => {
  it('renders an empty state that says what populates the list', async () => {
    mockedFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithQuery(<PaymentsList orgId={ORG_ID} />);
    expect(await screen.findByText('No payments yet')).toBeInTheDocument();
    expect(screen.getByText(/webhook events, or when seed data is loaded/)).toBeInTheDocument();
  });

  it('says filters matched nothing when filtered, and sends them to the API', async () => {
    search = 'status=failed&currency=usd&from=2026-03-01';
    mockedFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithQuery(<PaymentsList orgId={ORG_ID} />);
    expect(await screen.findByText('No payments match these filters')).toBeInTheDocument();
    const path = String(mockedFetch.mock.calls[0]?.[0]);
    expect(path).toContain('status=failed');
    expect(path).toContain('currency=USD');
    expect(path).toContain('from=2026-03-01T00%3A00%3A00.000Z');
  });

  it('sends a valid amount range and drops a non-integer amount', async () => {
    search = 'minAmount=500&maxAmount=1.5';
    mockedFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithQuery(<PaymentsList orgId={ORG_ID} />);
    await screen.findByText('No payments match these filters');
    const path = String(mockedFetch.mock.calls[0]?.[0]);
    expect(path).toContain('minAmount=500');
    expect(path).not.toContain('maxAmount');
  });

  it('applies an amount filter typed into the bar', async () => {
    mockedFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithQuery(<PaymentsList orgId={ORG_ID} />);
    await screen.findByText('No payments yet');
    await userEvent.type(screen.getByLabelText('Min amount (minor units)'), '250');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(replace).toHaveBeenCalledWith('/app/org/payments?minAmount=250');
  });

  it('writes a changed filter to the URL', async () => {
    mockedFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithQuery(<PaymentsList orgId={ORG_ID} />);
    await screen.findByText('No payments yet');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed');
    expect(replace).toHaveBeenCalledWith('/app/org/payments?status=failed');
  });

  it('renders exact amounts and status text, and loads more with the cursor', async () => {
    mockedFetch
      .mockResolvedValueOnce({ items: [payment], nextCursor: 'abc' })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    renderWithQuery(<PaymentsList orgId={ORG_ID} />);
    expect(await screen.findByText('90071992547409931.23 USD')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('Partially refunded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    expect(String(mockedFetch.mock.calls[1]?.[0])).toContain('cursor=abc');
  });
});
