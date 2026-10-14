import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { AuditList } from './audit-list';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

const replace = vi.fn();
let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  usePathname: () => '/app/org/audit',
  useSearchParams: () => new URLSearchParams(search),
}));

const mockedFetch = vi.mocked(apiFetch);
const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';

beforeEach(() => {
  search = '';
  mockedFetch.mockResolvedValue({ items: [], nextCursor: null });
});

describe('AuditList', () => {
  it('sends the date range and search text from the URL to the API', async () => {
    search = 'from=2026-03-01&to=2026-03-31&q=refund';
    renderWithQuery(<AuditList orgId={ORG_ID} />);
    expect(await screen.findByText('No entries match these filters')).toBeInTheDocument();
    const path = String(mockedFetch.mock.calls[0]?.[0]);
    expect(path).toContain('from=2026-03-01T00%3A00%3A00.000Z');
    expect(path).toContain('to=2026-04-01T00%3A00%3A00.000Z');
    expect(path).toContain('q=refund');
    expect(screen.getByLabelText('Search')).toHaveValue('refund');
  });

  it('writes a date to the URL', async () => {
    renderWithQuery(<AuditList orgId={ORG_ID} />);
    await screen.findByText('No audit entries yet');
    await userEvent.type(screen.getByLabelText('From'), '2026-03-01');
    expect(replace).toHaveBeenLastCalledWith('/app/org/audit?from=2026-03-01');
  });

  it('debounces search typing into one trimmed URL update', async () => {
    renderWithQuery(<AuditList orgId={ORG_ID} />);
    await screen.findByText('No audit entries yet');
    await userEvent.type(screen.getByLabelText('Search'), ' refund ');
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/org/audit?q=refund'));
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('shows the actor email and links each target to its detail page', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const entry = (action: string, targetType: string, actorEmail: string | null = null) => ({
      id: crypto.randomUUID(),
      actorId: actorEmail ? id : null,
      actorEmail,
      actorType: actorEmail ? 'user' : 'system',
      action,
      targetType,
      targetId: id,
      reason: null,
      previousState: null,
      resultingState: null,
      outcome: 'success',
      requestId: null,
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    const targets: [string, string][] = [
      ['payment', `/app/${ORG_ID}/payments/${id}`],
      ['subscription', `/app/${ORG_ID}/subscriptions/${id}`],
      ['customer', `/app/${ORG_ID}/customers/${id}`],
      ['entitlement', `/app/${ORG_ID}/entitlements/${id}`],
      ['incident', `/app/${ORG_ID}/incidents/${id}`],
      ['finding', `/app/${ORG_ID}/findings/${id}`],
      ['reconciliation_run', `/app/${ORG_ID}/reconciliation/${id}`],
      ['event', `/app/${ORG_ID}/events/${id}`],
      ['connection', `/app/${ORG_ID}/connections`],
    ];
    mockedFetch.mockResolvedValue({
      items: [
        entry('member.add', 'member', 'ops@example.test'),
        entry('member.remove', 'member', null),
        ...targets.map(([type]) => entry(`touch.${type}`, type)),
      ],
      nextCursor: null,
    });
    renderWithQuery(<AuditList orgId={ORG_ID} />);
    expect(await screen.findByText('ops@example.test')).toBeInTheDocument();
    expect(screen.getAllByText('System')).toHaveLength(targets.length + 1);
    for (const [type, href] of targets) {
      const link = screen.getByRole('link', { name: `${type}:11111111` });
      expect(link).toHaveAttribute('href', href);
    }
    expect(screen.queryByRole('link', { name: 'member:11111111' })).toBeNull();
    expect(screen.getAllByText('member:11111111')).toHaveLength(2);
  });
});
