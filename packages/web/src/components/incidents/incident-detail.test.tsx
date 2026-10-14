import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { IncidentDetail } from './incident-detail';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const INCIDENT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-03-05T14:07:09.000Z';

function renderIncident(related: Record<string, unknown>) {
  mockedFetch.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/api/v1/orgs'
        ? { orgs: [{ id: ORG, name: 'Acme', slug: 'acme', role: 'VIEWER' }] }
        : {
            id: INCIDENT,
            category: 'status_mismatch',
            severity: 'high',
            status: 'open',
            title: 'Unresolved status mismatch findings',
            findingCount: 3,
            openedAt: NOW,
            lastSeenAt: NOW,
            resolvedAt: null,
            related,
            resolutionNotes: null,
            actions: [],
          },
    ),
  );
  renderWithQuery(<IncidentDetail orgId={ORG} incidentId={INCIDENT} />);
}

describe('IncidentDetail findings link', () => {
  it('links the finding count to the findings of this incident run', async () => {
    renderIncident({ findingType: 'status_mismatch', lastRunId: RUN });
    expect(await screen.findByRole('link', { name: 'View findings' })).toHaveAttribute(
      'href',
      `/app/${ORG}/findings?type=status_mismatch&runId=${RUN}`,
    );
  });

  it('falls back to the type filter when the incident has no run id', async () => {
    renderIncident({ findingType: 'status_mismatch', lastRunId: 'not-a-uuid' });
    expect(await screen.findByRole('link', { name: 'View findings' })).toHaveAttribute(
      'href',
      `/app/${ORG}/findings?type=status_mismatch`,
    );
  });

  it('omits the link when the incident has no finding type', async () => {
    renderIncident({});
    expect(await screen.findByText('Active findings')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View findings' })).not.toBeInTheDocument();
  });
});
