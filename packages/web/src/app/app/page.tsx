import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/server';

export default async function AppPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect('/login?next=%2Fapp');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Signed in</CardTitle>
          <CardDescription>{data.claims.email ?? 'Unknown email'}</CardDescription>
        </CardHeader>
        <form action="/auth/sign-out" method="post" className="px-6">
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </Card>
    </main>
  );
}
