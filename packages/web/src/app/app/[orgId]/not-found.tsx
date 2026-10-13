import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function OrgNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-3 py-12">
      <h1 className="text-xl font-semibold">Organization not found</h1>
      <p className="text-muted-foreground text-sm">
        It does not exist, or you are not a member of it.
      </p>
      <Button asChild>
        <Link href="/app">Choose an organization</Link>
      </Button>
    </div>
  );
}
