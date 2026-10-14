import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { EventDetail } from './event-detail';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const EVENT = '55555555-5555-4555-8555-555555555555';
const PAYMENT = '11111111-1111-4111-8111-111111111111';
const SUB = '44444444-4444-4444-8444-444444444444';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const NOW = '2026-03-05T14:07:09.000Z';

function renderEvent(over: Record<string, unknown>) {
  mockedFetch.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/api/v1/orgs'
        ? { orgs: [{ id: ORG, name: 'Acme', slug: 'acme', role: 'VIEWER' }] }
        : {
            id: EVENT,
            provider: 'stripe',
            connectionId: '22222222-2222-4222-8222-222222222222',
            providerEventId: 'evt_1',
            eventType: 'payment_intent.succeeded',
            normalizedType: 'payment.succeeded',
            status: 'processed',
            attemptCount: 1,
            occurredAt: NOW,
            receivedAt: NOW,
            processedAt: NOW,
            signatureVerified: true,
            objectRef: 'pi_1',
            related: { paymentId: null, subscriptionId: null, customerId: null },
            payload: {},
            attempts: [],
            job: null,
            ...over,
          },
    ),
  );
  renderWithQuery(<EventDetail orgId={ORG} eventId={EVENT} />);
}

describe('EventDetail', () => {
  it('links the related payment, subscription and customer', async () => {
    renderEvent({ related: { paymentId: PAYMENT, subscriptionId: SUB, customerId: CUSTOMER } });
    expect(await screen.findByRole('link', { name: 'View payment' })).toHaveAttribute(
      'href',
      `/app/${ORG}/payments/${PAYMENT}`,
    );
    expect(screen.getByRole('link', { name: 'View subscription' })).toHaveAttribute(
      'href',
      `/app/${ORG}/subscriptions/${SUB}`,
    );
    expect(screen.getByRole('link', { name: 'View customer' })).toHaveAttribute(
      'href',
      `/app/${ORG}/customers/${CUSTOMER}`,
    );
    expect(screen.getByText('pi_1')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('shows unverified signatures and missing related records', async () => {
    renderEvent({ signatureVerified: false, objectRef: null });
    expect(await screen.findByText('Unverified')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View (payment|subscription|customer)/ })).toBeNull();
    expect(screen.getAllByText('None')).toHaveLength(4);
  });
});
