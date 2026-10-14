import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { IncidentsList } from './incidents-list';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

vi.mock('@/hooks/use-current-org', () => ({ useCurrentOrg: () => ({ role: 'OWNER' }) }));

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => '/app/org/incidents',
  useSearchParams: () => new URLSearchParams(search),
}));

const mockedFetch = vi.mocked(apiFetch);
const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';

beforeEach(() => {
  search = '';
});

describe('IncidentsList', () => {
  it('offers severity and category filters and sends them to the API', async () => {
    search = 'severity=critical&category=status_mismatch';
    mockedFetch.mockResolvedValue({ items: [], nextCursor: null });
    renderWithQuery(<IncidentsList orgId={ORG_ID} />);
    expect(await screen.findByText('No incidents match these filters')).toBeInTheDocument();
    const path = String(mockedFetch.mock.calls[0]?.[0]);
    expect(path).toContain('severity=critical');
    expect(path).toContain('category=status_mismatch');
    expect(screen.getByLabelText('Severity')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
  });
});
