import { z } from 'zod';
import { ROLES } from './permissions';

export const orgSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(ROLES),
});
export type Org = z.infer<typeof orgSchema>;

export const orgListSchema = z.object({ orgs: z.array(orgSchema) });

export const createOrgBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().regex(/^[a-z0-9-]{3,48}$/),
});

export const memberSchema = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string().nullable(),
  role: z.enum(ROLES),
});
export type Member = z.infer<typeof memberSchema>;

export const memberListSchema = z.object({ members: z.array(memberSchema) });
