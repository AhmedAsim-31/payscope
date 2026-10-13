import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { CreateOrgForm } from './create-org-form';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const mockedFetch = vi.mocked(apiFetch);

describe('CreateOrgForm', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('suggests a slug from the name until the slug is edited by hand', async () => {
    const user = userEvent.setup();
    renderWithQuery(<CreateOrgForm />);
    const slug = screen.getByLabelText('Slug');

    await user.type(screen.getByLabelText('Name'), 'Acme Payments');
    expect(slug).toHaveValue('acme-payments');

    await user.clear(slug);
    await user.type(slug, 'custom');
    await user.type(screen.getByLabelText('Name'), ' Inc');
    expect(slug).toHaveValue('custom');
  });

  it('shows the slug-taken message inline on a 409', async () => {
    mockedFetch.mockImplementation(() =>
      Promise.reject(new ApiClientError(409, 'CONFLICT', 'Resource already exists')),
    );
    const user = userEvent.setup();
    renderWithQuery(<CreateOrgForm />);

    await user.type(screen.getByLabelText('Name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Create organization' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('That slug is already taken'),
    );
    expect(screen.getByRole('button', { name: 'Create organization' })).toBeEnabled();
  });
});
