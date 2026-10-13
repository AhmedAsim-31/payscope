import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SignOutForm() {
  return (
    <form action="/auth/sign-out" method="post">
      <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
        <LogOut aria-hidden="true" />
        <span className="hidden sm:inline">Sign out</span>
      </Button>
    </form>
  );
}
