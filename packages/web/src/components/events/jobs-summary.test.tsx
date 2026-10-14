import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { JobsSummary } from './jobs-summary';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

const mockedFetch = vi.mocked(apiFetch);
const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';

describe('JobsSummary retry links', () => {
  it('links the retrying and dead cards to the matching events', async () => {
    mockedFetch.mockResolvedValue({
      counts: { queued: 3, running: 0, succeeded: 4, failed: 0, dead: 2 },
      retrying: 1,
      oldestQueuedAgeSeconds: null,
    });
    renderWithQuery(<JobsSummary orgId={ORG} />);
    expect(await screen.findByText('Retrying')).toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View events awaiting retry' })).toHaveAttribute(
      'href',
      `/app/${ORG}/events?status=failed`,
    );
    expect(screen.getByRole('link', { name: 'View events needing attention' })).toHaveAttribute(
      'href',
      `/app/${ORG}/events?status=needs_attention`,
    );
  });
});
