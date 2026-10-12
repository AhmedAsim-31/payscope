'use client';

import { useRouter } from 'next/navigation';
import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createClient } from '@/lib/supabase/browser';

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget.elements;
    const email = form.namedItem('email') as HTMLInputElement;
    const password = form.namedItem('password') as HTMLInputElement;
    setIsSubmitting(true);
    setError(null);
    try {
      const { error: signInError } = await createClient().auth.signInWithPassword({
        email: email.value,
        password: password.value,
      });
      if (signInError) {
        setError(signInError.message);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <CardContent>
      <form
        onSubmit={(event) => {
          handleSubmit(event).catch(() => setError('Something went wrong. Try again.'));
        }}
        className="grid gap-4"
        aria-busy={isSubmitting}
      >
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <p role="alert" aria-live="polite" className="text-destructive min-h-5 text-sm">
          {error}
        </p>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign in'}
        </Button>
      </form>
    </CardContent>
  );
}
