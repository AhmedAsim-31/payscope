import { ROLES, type Role } from '@payscope/shared/permissions';

export function assignableRoles(callerRole: Role): readonly Role[] {
  return callerRole === 'OWNER' ? ROLES : ROLES.filter((role) => role !== 'OWNER');
}

export function canModifyMember(callerRole: Role, targetRole: Role): boolean {
  return callerRole === 'OWNER' || targetRole !== 'OWNER';
}
