import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { OrgSwitcher } from './org-switcher';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';

describe('OrgSwitcher', () => {
  it('exposes the full org name when the trigger truncates it', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      orgs: [{ id: ORG, name: 'Acme Streaming (demo)', slug: 'acme', role: 'OWNER' }],
    });
    renderWithQuery(<OrgSwitcher orgId={ORG} />);

    const trigger = await screen.findByRole('button', { name: /Switch organization/ });
    expect(trigger).toHaveAttribute('title', 'Acme Streaming (demo)');
    expect(trigger).toHaveAccessibleName(/Acme Streaming \(demo\)/);
  });
});
