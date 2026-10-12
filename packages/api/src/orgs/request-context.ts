import type { FastifyRequest } from 'fastify';
import type { Role } from '@payscope/shared/permissions';

export type RequestOrg = { id: string; role: Role };

declare module 'fastify' {
  interface FastifyRequest {
    org: RequestOrg | undefined;
  }
}

export function currentUserId(request: FastifyRequest): string {
  if (!request.auth) throw new Error('authenticate hook did not run');
  return request.auth.userId;
}

export function currentOrg(request: FastifyRequest): RequestOrg {
  if (!request.org) throw new Error('requireOrg preHandler did not run');
  return request.org;
}
