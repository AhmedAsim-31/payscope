import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@payscope/shared/permissions';
import { ApiClientError, apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { MembersView } from './members-view';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));

const mockedFetch = vi.mocked(apiFetch);

const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const member = (n: number, role: Role, email: string) => ({
  userId: `00000000-0000-4000-8000-00000000000${n}`,
  email,
  displayName: null,
  role,
});
const MEMBERS = [
  member(1, 'OWNER', 'owner@example.com'),
  member(2, 'VIEWER', 'viewer@example.com'),
];

function serve(callerRole: Role) {
  mockedFetch.mockImplementation((path, init) => {
    if (init?.method) return Promise.resolve(undefined);
    if (path === '/api/v1/orgs') {
      return Promise.resolve({
        orgs: [{ id: ORG_ID, name: 'Acme', slug: 'acme', role: callerRole }],
      });
    }
    return Promise.resolve({ members: MEMBERS });
  });
}

describe('MembersView permission gating', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('gives a VIEWER a read-only table', async () => {
    serve('VIEWER');
    renderWithQuery(<MembersView orgId={ORG_ID} />);

    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Add a member')).not.toBeInTheDocument();
    expect(screen.getAllByText('Viewer').length).toBeGreaterThan(0);
  });

  it('never offers Owner to an ADMIN and locks owner rows', async () => {
    serve('ADMIN');
    renderWithQuery(<MembersView orgId={ORG_ID} />);

    const select = await screen.findByLabelText('Role for viewer@example.com');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Admin', 'Operator', 'Viewer']);
    expect(
      within(screen.getByLabelText('Role', { selector: '#member-role' })).queryByText('Owner'),
    ).toBeNull();
    expect(screen.queryByLabelText('Role for owner@example.com')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove owner@example.com' }),
    ).not.toBeInTheDocument();
  });

  it('offers Owner to an OWNER and confirms before removal', async () => {
    serve('OWNER');
    const user = userEvent.setup();
    renderWithQuery(<MembersView orgId={ORG_ID} />);

    const select = await screen.findByLabelText('Role for viewer@example.com');
    expect(within(select).getByRole('option', { name: 'Owner' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove viewer@example.com' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'viewer@example.com will lose access',
    );
  });

  it('explains LAST_OWNER inline', async () => {
    serve('OWNER');
    const lastOwner = new ApiClientError(
      409,
      'LAST_OWNER',
      'An organization must keep at least one owner',
    );
    const read = mockedFetch.getMockImplementation();
    mockedFetch.mockImplementation((path, init) =>
      init?.method ? Promise.reject(lastOwner) : (read?.(path, init) ?? Promise.resolve(undefined)),
    );
    const user = userEvent.setup();
    renderWithQuery(<MembersView orgId={ORG_ID} />);

    await user.click(await screen.findByRole('button', { name: 'Remove owner@example.com' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove member' }),
    );

    expect(await screen.findByText(/must keep at least one owner/)).toBeInTheDocument();
  });
});
