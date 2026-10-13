'use client';

import { Trash2 } from 'lucide-react';
import type { Member } from '@payscope/shared/org-schemas';
import type { Role } from '@payscope/shared/permissions';
import { RoleBadge } from '@/components/role-badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { assignableRoles, canModifyMember } from './assignable-roles';
import { RoleSelect } from './role-select';

export function MembersTable({
  members,
  callerRole,
  canManage,
  busyUserId,
  onChangeRole,
  onRemove,
}: {
  members: readonly Member[];
  callerRole: Role;
  canManage: boolean;
  busyUserId: string | null;
  onChangeRole: (member: Member, role: Role) => void;
  onRemove: (member: Member) => void;
}) {
  const roles = assignableRoles(callerRole);

  return (
    <Table>
      <caption className="sr-only">Organization members</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Email</TableHead>
          <TableHead scope="col">Name</TableHead>
          <TableHead scope="col">Role</TableHead>
          {canManage ? <TableHead scope="col">Actions</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => {
          const editable = canManage && canModifyMember(callerRole, member.role);
          const busy = busyUserId === member.userId;
          return (
            <TableRow key={member.userId} aria-busy={busy}>
              <TableCell className="font-medium">{member.email}</TableCell>
              <TableCell className={member.displayName ? undefined : 'text-muted-foreground'}>
                {member.displayName ?? 'Not set'}
              </TableCell>
              <TableCell>
                {editable ? (
                  <RoleSelect
                    label={`Role for ${member.email}`}
                    value={member.role}
                    roles={roles}
                    disabled={busy}
                    onChange={(role) => onChangeRole(member, role)}
                  />
                ) : (
                  <RoleBadge role={member.role} />
                )}
              </TableCell>
              {canManage ? (
                <TableCell>
                  {editable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => onRemove(member)}
                      aria-label={`Remove ${member.email}`}
                    >
                      <Trash2 aria-hidden="true" />
                      Remove
                    </Button>
                  ) : (
                    <span className="text-muted-foreground text-sm">Owner only</span>
                  )}
                </TableCell>
              ) : null}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
