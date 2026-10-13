'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { Member } from '@payscope/shared/org-schemas';
import { can, type Role } from '@payscope/shared/permissions';
import { roleLabel } from '@/components/role-badge';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { describeError } from '@/lib/api-messages';
import { membersQueryOptions } from '@/lib/queries';
import { AddMemberForm } from './add-member-form';
import { assignableRoles } from './assignable-roles';
import { ConfirmDialog } from './confirm-dialog';
import { MembersTable } from './members-table';
import { useMemberMutations } from './use-member-mutations';

type RoleChange = { member: Member; role: Role };

export function MembersView({ orgId }: { orgId: string }) {
  const org = useCurrentOrg(orgId);
  const { data: members } = useSuspenseQuery(membersQueryOptions(orgId));
  const { add, changeRole, remove } = useMemberMutations(orgId);
  const [pendingChange, setPendingChange] = useState<RoleChange | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Member | null>(null);

  const canManage = can(org.role, 'members:manage');
  const busyUserId = changeRole.isPending
    ? changeRole.variables.userId
    : remove.isPending
      ? remove.variables.userId
      : null;

  function applyRoleChange(change: RoleChange) {
    remove.reset();
    changeRole.mutate(
      { userId: change.member.userId, role: change.role },
      { onSettled: () => setPendingChange(null) },
    );
  }

  function requestRoleChange(member: Member, role: Role) {
    if (role === member.role) return;
    const change = { member, role };
    if (member.role === 'OWNER' || role === 'OWNER') setPendingChange(change);
    else applyRoleChange(change);
  }

  function confirmRemoval(member: Member) {
    changeRole.reset();
    remove.mutate({ userId: member.userId }, { onSettled: () => setPendingRemoval(null) });
  }

  const actionError = changeRole.isError
    ? describeError(changeRole.error, 'change-role')
    : remove.isError
      ? describeError(remove.error, 'remove-member')
      : null;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {canManage
            ? `People with access to ${org.name}.`
            : `People with access to ${org.name}. Only owners and admins can change membership.`}
        </p>
      </div>

      {canManage ? <AddMemberForm roles={assignableRoles(org.role)} add={add} /> : null}

      <p role="alert" className="text-destructive empty:hidden text-sm">
        {actionError}
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <MembersTable
          members={members}
          callerRole={org.role}
          canManage={canManage}
          busyUserId={busyUserId}
          onChangeRole={requestRoleChange}
          onRemove={setPendingRemoval}
        />
      </div>

      <ConfirmDialog
        open={pendingChange !== null}
        title="Change owner access?"
        description={
          pendingChange
            ? `${pendingChange.member.email} will change from ${roleLabel(pendingChange.member.role)} to ${roleLabel(pendingChange.role)}.`
            : ''
        }
        confirmLabel="Change role"
        isPending={changeRole.isPending}
        onConfirm={() => pendingChange && applyRoleChange(pendingChange)}
        onCancel={() => setPendingChange(null)}
      />
      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Remove member?"
        description={
          pendingRemoval
            ? `${pendingRemoval.email} will lose access to ${org.name} immediately.`
            : ''
        }
        confirmLabel="Remove member"
        destructive
        isPending={remove.isPending}
        onConfirm={() => pendingRemoval && confirmRemoval(pendingRemoval)}
        onCancel={() => setPendingRemoval(null)}
      />
    </div>
  );
}
