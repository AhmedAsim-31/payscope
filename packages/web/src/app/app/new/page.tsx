import Link from 'next/link';
import { CreateOrgForm } from '@/components/orgs/create-org-form';
import { SignOutForm } from '@/components/shell/sign-out-form';

export default function NewOrgPage() {
  return (
    <>
      <header className="flex h-14 items-center justify-between border-b px-4">
        <Link href="/app" className="font-semibold tracking-tight">
          PayScope
        </Link>
        <SignOutForm />
      </header>
      <main className="mx-auto max-w-md p-6 pt-12">
        <h1 className="text-2xl font-semibold tracking-tight">Create an organization</h1>
        <p className="text-muted-foreground mt-1 mb-6 text-sm">
          An organization holds your members, connections, and records. You become its owner.
        </p>
        <CreateOrgForm />
      </main>
    </>
  );
}
