import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { OverviewView } from './overview-view';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

let search = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search),
}));

const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
vi.mock('@/hooks/use-current-org', () => ({
  useCurrentOrg: () => ({ id: ORG_ID, name: 'Acme', role: 'owner' }),
}));

const mockedFetch = vi.mocked(apiFetch);

const statuses = (over: Record<string, number> = {}) => ({
  pending: 0,
  succeeded: 0,
  failed: 0,
  refunded: 0,
  partially_refunded: 0,
  disputed: 0,
  canceled: 0,
  ...over,
});

const base = {
  range: '30d',
  since: '2026-03-01T00:00:00.000Z',
  payments: [],
  subscriptions: { trialing: 0, active: 0, past_due: 0, canceled: 0, expired: 0, paused: 0 },
  entitlements: { active: 0, expired: 0, revoked: 0, inconsistent: 0 },
  events: {
    pending: 0,
    processing: 0,
    processed: 0,
    failed: 0,
    duplicate: 0,
    needs_attention: 0,
    ignored: 0,
  },
  processing: { processed: 0, attempted: 0, successRate: null },
  jobs: { queued: 0, running: 0, dead: 0, oldestQueuedAgeSeconds: null },
  findings: { open: 0, bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } },
  recentEvents: [],
};

beforeEach(() => {
  search = '';
});

describe('OverviewView', () => {
  it('shows an honest empty state when nothing was recorded', async () => {
    mockedFetch.mockResolvedValue(base);
    renderWithQuery(<OverviewView orgId={ORG_ID} />);
    expect(await screen.findByText('No activity yet')).toBeInTheDocument();
  });

  it('keeps currencies in separate cards with exact amounts and text counts', async () => {
    mockedFetch.mockResolvedValue({
      ...base,
      payments: [
        {
          currency: 'JPY',
          total: 1,
          byStatus: statuses({ succeeded: 1 }),
          succeededAmountMinor: '700',
          refundedAmountMinor: '0',
        },
        {
          currency: 'USD',
          total: 3,
          byStatus: statuses({ succeeded: 2, failed: 1 }),
          succeededAmountMinor: '9007199254741003',
          refundedAmountMinor: '200',
        },
      ],
      processing: { processed: 39, attempted: 40, successRate: 0.975 },
    });
    renderWithQuery(<OverviewView orgId={ORG_ID} />);
    const usd = await screen.findByLabelText('USD payments');
    expect(within(usd).getByText('90071992547410.03 USD')).toBeInTheDocument();
    expect(within(usd).getByRole('list', { name: 'USD payments by status' })).toHaveTextContent(
      'Failed1',
    );
    expect(within(screen.getByLabelText('JPY payments')).getByText(/700 JPY/)).toBeInTheDocument();
    expect(screen.getByText('97.5%')).toBeInTheDocument();
    expect(screen.getByText('39 processed of 40 attempted')).toBeInTheDocument();
  });

  it('marks the selected range and links jobs to their page', async () => {
    search = 'range=7d';
    mockedFetch.mockResolvedValue({
      ...base,
      jobs: { queued: 2, running: 1, dead: 0, oldestQueuedAgeSeconds: 90 },
      events: { ...base.events, processed: 1 },
    });
    renderWithQuery(<OverviewView orgId={ORG_ID} />);
    expect(await screen.findByRole('link', { name: 'Jobs' })).toHaveAttribute(
      'href',
      `/app/${ORG_ID}/jobs`,
    );
    expect(screen.getByRole('link', { name: '7d' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('link', { name: '30d' })).not.toHaveAttribute('aria-current');
    expect(mockedFetch).toHaveBeenCalledWith(`/api/v1/orgs/${ORG_ID}/overview?range=7d`);
  });

  it('shows no data for a null success rate', async () => {
    mockedFetch.mockResolvedValue({ ...base, events: { ...base.events, pending: 3 } });
    renderWithQuery(<OverviewView orgId={ORG_ID} />);
    expect(await screen.findByText('No data')).toBeInTheDocument();
  });
});
