import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@payscope/shared/permissions';
import { ApiClientError, apiFetchBlob } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { ExportCsvButton } from './export-csv-button';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetchBlob: vi.fn(),
}));

let role: Role = 'OPERATOR';
vi.mock('@/hooks/use-current-org', () => ({ useCurrentOrg: () => ({ role }) }));

const mockedBlob = vi.mocked(apiFetchBlob);
const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const revokeObjectURL = vi.fn();

beforeEach(() => {
  role = 'OPERATOR';
  URL.createObjectURL = vi.fn(() => 'blob:csv');
  URL.revokeObjectURL = revokeObjectURL;
});

describe('ExportCsvButton', () => {
  it('downloads the export with the current filters as a blob', async () => {
    mockedBlob.mockResolvedValue(new Blob(['id\r\n']));
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    renderWithQuery(
      <ExportCsvButton
        orgId={ORG_ID}
        resource="payments"
        params={{ status: 'failed', currency: 'USD' }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(mockedBlob).toHaveBeenCalledWith(
      `/api/v1/orgs/${ORG_ID}/payments/export?status=failed&currency=USD`,
    );
    expect(downloads[0]).toMatch(/^payments-\d{4}-\d{2}-\d{2}\.csv$/);
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv'));
  });

  it('shows the API error when the export fails', async () => {
    mockedBlob.mockRejectedValue(new ApiClientError(429, 'RATE_LIMITED', 'Too many'));
    renderWithQuery(
      <ExportCsvButton orgId={ORG_ID} resource="reconciliation/findings" params={{}} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/Too many searches or exports/)).toHaveAttribute(
      'role',
      'alert',
    );
  });

  it('renders nothing for a viewer', () => {
    role = 'VIEWER';
    renderWithQuery(<ExportCsvButton orgId={ORG_ID} resource="payments" params={{}} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
