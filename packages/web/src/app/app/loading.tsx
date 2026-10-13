import { Skeleton } from '@/components/ui/skeleton';

export default function AppLoading() {
  return (
    <main className="mx-auto max-w-md p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-4 h-4 w-72" />
    </main>
  );
}
