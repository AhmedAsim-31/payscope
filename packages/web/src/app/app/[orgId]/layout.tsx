import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { AppShell } from '@/components/shell/app-shell';
import { createClient } from '@/lib/supabase/server';

export default async function OrgLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  if (!z.uuid().safeParse(orgId).success) notFound();

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect(`/login?next=${encodeURIComponent(`/app/${orgId}`)}`);

  return (
    <AppShell orgId={orgId} email={data.claims.email ?? 'Unknown email'}>
      {children}
    </AppShell>
  );
}
