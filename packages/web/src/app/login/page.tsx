import { Card, CardDescription, CardHeader } from '@/components/ui/card';
import { safeNextPath } from '@/lib/safe-redirect';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 data-slot="card-title" className="text-2xl leading-none font-semibold">
            Sign in
          </h1>
          <CardDescription>Use your PayScope account.</CardDescription>
        </CardHeader>
        <LoginForm nextPath={nextPath} />
      </Card>
    </main>
  );
}
