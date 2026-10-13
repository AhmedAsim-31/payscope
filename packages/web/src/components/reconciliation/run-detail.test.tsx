import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReconciliationRun } from '@payscope/shared/reconciliation-schemas';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { RunDetail } from './run-detail';
import { runColumns } from './runs-view';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const RUN = '99999999-9999-4999-8999-999999999999';
const NOW = '2026-03-05T14:07:09.000Z';

const run: ReconciliationRun = {
  id: RUN,
  connectionId: null,
  mode: 'local',
  trigger: 'manual',
  status: 'partial',
  counts: { examined: 12, matched: 9, mismatched: 3, unavailable: 0, failed: 1 },
  error: 'Provider timed out',
  startedAt: NOW,
  finishedAt: NOW,
  triggeredBy: null,
};
const finding = {
  id: '66666666-6666-4666-8666-666666666666',
  type: 'refund_inconsistent',
  severity: 'high',
  status: 'open',
  subjectType: 'payment',
  subjectId: '11111111-1111-4111-8111-111111111111',
  recommendedAction: 'review',
  firstSeenRunId: RUN,
  lastSeenRunId: RUN,
  createdAt: NOW,
  updatedAt: NOW,
};

describe('RunDetail', () => {
  it('shows run status, counts and findings scoped to the run', async () => {
    mockedFetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith(`/api/v1/orgs/${ORG}/reconciliation/runs/${RUN}`)
          ? { ...run, scope: {}, checkpoint: {} }
          : { items: [finding], nextCursor: 'next' },
      ),
    );
    renderWithQuery(<RunDetail orgId={ORG} runId={RUN} />);
    expect(await screen.findByText('Refund inconsistent')).toBeInTheDocument();
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(screen.getByText('Provider timed out')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    const findingsPath = mockedFetch.mock.calls
      .map(([p]) => String(p))
      .find((p) => p.startsWith(`/api/v1/orgs/${ORG}/reconciliation/findings?`));
    const q = new URLSearchParams(findingsPath?.split('?')[1]);
    expect(q.get('runId')).toBe(RUN);
    expect(q.get('limit')).toBe('5');
    expect(screen.getByRole('link', { name: 'View all findings' })).toHaveAttribute(
      'href',
      `/app/${ORG}/findings?runId=${RUN}`,
    );
  });
});

describe('runColumns', () => {
  it('links each run row to its detail page', () => {
    const [started] = runColumns(ORG);
    render(<>{started?.cell(run)}</>);
    expect(screen.getByRole('link')).toHaveAttribute('href', `/app/${ORG}/reconciliation/${RUN}`);
  });
});
