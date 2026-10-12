import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { can, type Action } from '@payscope/shared/permissions';
import type { Db } from '../db/client';
import { membershipsTable } from '../db/schema/identity';
import { ApiHttpError } from '../http-error';
import { currentUserId } from './request-context';

const paramsSchema = z.object({ orgId: z.uuid() });

const notFound = () => new ApiHttpError(404, 'NOT_FOUND', 'Organization not found');

export function requireOrg(db: Db, action: Action) {
  return async (request: FastifyRequest): Promise<void> => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) throw notFound();
    const [membership] = await db
      .select({ role: membershipsTable.role })
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.orgId, params.data.orgId),
          eq(membershipsTable.userId, currentUserId(request)),
        ),
      )
      .limit(1);
    if (!membership) throw notFound();
    if (!can(membership.role, action)) {
      throw new ApiHttpError(403, 'FORBIDDEN', 'Insufficient permissions');
    }
    request.org = { id: params.data.orgId, role: membership.role };
  };
}
