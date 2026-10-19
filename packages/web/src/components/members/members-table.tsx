'use client';

import { Crown, Trash2 } from 'lucide-react';
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
  canTransfer,
  busyUserId,
  onChangeRole,
  onRemove,
  onTransfer,
}: {
  members: readonly Member[];
  callerRole: Role;
  canManage: boolean;
  canTransfer: boolean;
  busyUserId: string | null;
  onChangeRole: (member: Member, role: Role) => void;
  onRemove: (member: Member) => void;
  onTransfer: (member: Member) => void;
}) {
  const roles = assignableRoles(callerRole);

  return (
    <Table>
      <caption className="sr-only">Organization members</caption>
      <TableHeader className="max-md:hidden">
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
            <TableRow key={member.userId} aria-busy={busy} className="max-md:block max-md:py-2">
              <TableCell className="font-medium max-md:flex max-md:items-center max-md:justify-between max-md:gap-4 max-md:py-1 max-md:whitespace-normal">
                <span className="text-muted-foreground text-xs font-normal md:hidden">Email</span>
                <span className="max-md:min-w-0 max-md:break-words max-md:text-right">
                  {member.email}
                </span>
              </TableCell>
              <TableCell
                className={`${member.displayName ? '' : 'text-muted-foreground'} max-md:flex max-md:items-center max-md:justify-between max-md:gap-4 max-md:py-1 max-md:whitespace-normal`}
              >
                <span className="text-muted-foreground text-xs md:hidden">Name</span>
                <span>{member.displayName ?? 'Not set'}</span>
              </TableCell>
              <TableCell className="max-md:flex max-md:items-center max-md:justify-between max-md:gap-4 max-md:py-1 max-md:whitespace-normal">
                <span className="text-muted-foreground text-xs md:hidden">Role</span>
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
                <TableCell className="max-md:flex max-md:items-center max-md:justify-between max-md:gap-4 max-md:py-1 max-md:whitespace-normal">
                  <span className="text-muted-foreground text-xs md:hidden">Actions</span>
                  {editable ? (
                    <span className="flex flex-wrap justify-end gap-1 md:justify-start">
                      {canTransfer && member.role !== 'OWNER' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => onTransfer(member)}
                          aria-label={`Make owner ${member.email}`}
                        >
                          <Crown aria-hidden="true" />
                          Make owner
                        </Button>
                      ) : null}
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
                    </span>
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
