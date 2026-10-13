'use client';

import { useState, type SubmitEvent } from 'react';
import type { Role } from '@payscope/shared/permissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api-messages';
import { RoleSelect } from './role-select';
import type { useMemberMutations } from './use-member-mutations';

export function AddMemberForm({
  roles,
  add,
}: {
  roles: readonly Role[];
  add: ReturnType<typeof useMemberMutations>['add'];
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('VIEWER');

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (add.isPending) return;
    add.mutate({ email: email.trim(), role }, { onSuccess: () => setEmail('') });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded-lg border p-4"
      aria-busy={add.isPending}
    >
      <h2 className="text-sm font-semibold">Add a member</h2>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 flex-1 gap-2">
          <Label htmlFor="member-email">Email</Label>
          <Input
            id="member-email"
            type="email"
            autoComplete="off"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-role">Role</Label>
          <RoleSelect
            id="member-role"
            label="Role"
            value={role}
            roles={roles}
            onChange={setRole}
            disabled={add.isPending}
          />
        </div>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? 'Adding...' : 'Add member'}
        </Button>
      </div>
      <p role="alert" className="text-destructive min-h-5 text-sm">
        {add.isError ? describeError(add.error, 'add-member') : null}
      </p>
    </form>
  );
}
