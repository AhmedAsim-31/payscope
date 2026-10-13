import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@payscope/shared/permissions';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import type { Connection } from '@/lib/connection-queries';
import { renderWithQuery } from '@/test/render';
import { ConnectionsView } from './connections-view';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found');
  },
}));
vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.test');
vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'pk');

const mockedFetch = vi.mocked(apiFetch);
const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const SANDBOX_ID = '11111111-1111-4111-8111-111111111111';

const connection = (over: Partial<Connection>): Connection => ({
  id: SANDBOX_ID,
  provider: 'stripe',
  mode: 'sandbox',
  status: 'unverified',
  displayName: 'Stripe sandbox',
  externalAccountId: 'acct_123',
  hasWebhookSecret: true,
  hasApiKey: false,
  webhookUrl: `/webhooks/stripe/${SANDBOX_ID}`,
  capabilities: { webhookVerification: 'supported_tested', credentialValidation: 'unsupported' },
  lastVerifiedAt: null,
  lastError: null,
  ...over,
});

const CONNECTIONS = [
  connection({}),
  connection({
    id: '22222222-2222-4222-8222-222222222222',
    mode: 'simulation',
    status: 'active',
    displayName: 'Paddle simulation (demo)',
    provider: 'paddle',
  }),
];

function serve(role: Role) {
  mockedFetch.mockImplementation((path, init) => {
    if (init?.method) return Promise.resolve(connection({ status: 'active' }));
    if (path === '/api/v1/orgs') {
      return Promise.resolve({ orgs: [{ id: ORG_ID, name: 'Acme', slug: 'acme', role }] });
    }
    return Promise.resolve({ connections: CONNECTIONS });
  });
}

describe('ConnectionsView', () => {
  beforeEach(() => {
    mockedFetch.mockReset();
  });

  it('shows status, credential state, and the webhook URL without any secret', async () => {
    serve('OWNER');
    renderWithQuery(<ConnectionsView orgId={ORG_ID} />);

    expect(await screen.findByText('Stripe sandbox')).toBeInTheDocument();
    expect(
      screen.getByText(`https://api.example.test/webhooks/stripe/${SANDBOX_ID}`),
    ).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
    expect(screen.getByText('Never verified')).toBeInTheDocument();
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Webhook verification')[0]).toBeInTheDocument();
  });

  it('labels simulated connections and never offers to test them', async () => {
    serve('OWNER');
    renderWithQuery(<ConnectionsView orgId={ORG_ID} />);

    await screen.findByText('Paddle simulation (demo)');
    expect(screen.getByText(/^Simulated Paddle connection/)).toBeInTheDocument();
    expect(screen.getByText('Simulated connections have no provider account.')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Test credentials' })) {
      expect(button).toBeDisabled();
    }
  });

  it('rotates credentials through PATCH for managers', async () => {
    serve('ADMIN');
    renderWithQuery(<ConnectionsView orgId={ORG_ID} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Edit credentials' }));
    await userEvent.type(screen.getByLabelText('Sandbox API key'), 'sk_test_new');
    await userEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    expect(mockedFetch).toHaveBeenCalledWith(
      `/api/v1/orgs/${ORG_ID}/connections/${SANDBOX_ID}`,
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ apiKey: 'sk_test_new' }) }),
    );
  });

  it('removes a configured credential only after confirmation', async () => {
    serve('ADMIN');
    renderWithQuery(<ConnectionsView orgId={ORG_ID} />);

    expect(screen.queryByRole('button', { name: 'Remove API key' })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove webhook secret' }));
    const dialog = await screen.findByRole('dialog');
    expect(mockedFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/credentials/'),
      expect.anything(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove webhook secret' }));

    expect(mockedFetch).toHaveBeenCalledWith(
      `/api/v1/orgs/${ORG_ID}/connections/${SANDBOX_ID}/credentials/webhookSecret`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('gives a VIEWER a read-only page', async () => {
    serve('VIEWER');
    renderWithQuery(<ConnectionsView orgId={ORG_ID} />);

    expect(await screen.findByText('Stripe sandbox')).toBeInTheDocument();
    expect(screen.queryByText('Add a connection')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test credentials' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit credentials' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });
});
