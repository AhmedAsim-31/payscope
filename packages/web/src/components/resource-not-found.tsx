'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function ResourceNotFound({ label, listPath }: { label: string; listPath: string }) {
  const { orgId } = useParams<{ orgId: string }>();
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-3 py-12">
      <h1 className="text-xl font-semibold">{label} not found</h1>
      <p className="text-muted-foreground text-sm">
        It does not exist, or it belongs to a different organization.
      </p>
      <Button asChild>
        <Link href={`/app/${orgId}/${listPath}`}>Back to {listPath}</Link>
      </Button>
    </div>
  );
}
