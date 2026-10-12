import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Sandbox demo, fictional data
          </p>
          <CardTitle className="text-2xl">PayScope</CardTitle>
          <CardDescription>
            Payment operations console for webhook reliability, reconciliation, and entitlement
            consistency.
          </CardDescription>
        </CardHeader>
      </Card>
    </main>
  );
}
