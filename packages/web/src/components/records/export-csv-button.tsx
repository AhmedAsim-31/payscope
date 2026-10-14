'use client';

import { useMutation } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { can } from '@payscope/shared/permissions';
import { Button } from '@/components/ui/button';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { apiFetchBlob } from '@/lib/api-client';
import { describeError } from '@/lib/api-messages';
import type { RecordResource } from '@/lib/records-queries';

type Props = {
  orgId: string;
  resource: RecordResource;
  params: Readonly<Record<string, string>>;
};

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Deferred so the browser has started reading the blob before the URL dies.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportCsvButton({ orgId, resource, params }: Props) {
  const org = useCurrentOrg(orgId);
  const download = useMutation({
    mutationFn: async () => {
      const query = new URLSearchParams(params);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      const blob = await apiFetchBlob(`/api/v1/orgs/${orgId}/${resource}/export${suffix}`);
      const name = resource.split('/').at(-1) ?? 'export';
      saveBlob(blob, `${name}-${new Date().toISOString().slice(0, 10)}.csv`);
    },
  });

  if (!can(org.role, 'records:export')) return null;

  return (
    <div className="grid justify-items-end gap-1">
      <Button variant="outline" disabled={download.isPending} onClick={() => download.mutate()}>
        <Download aria-hidden="true" />
        {download.isPending ? 'Exporting' : 'Export CSV'}
      </Button>
      <p role="alert" className="text-destructive text-sm empty:hidden">
        {download.isError ? describeError(download.error, 'export-csv') : null}
      </p>
    </div>
  );
}
