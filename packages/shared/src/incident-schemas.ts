import { z } from 'zod';
import { FINDING_SEVERITIES, FINDING_TYPES } from './reconciliation-schemas';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './records-schemas';

export const INCIDENT_STATUSES = ['open', 'investigating', 'resolved'] as const;
export const INCIDENT_ACTIONS = ['acknowledge', 'note', 'resolve'] as const;

const isoDate = z.iso.datetime();

export const incidentQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().max(512).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(FINDING_SEVERITIES).optional(),
  category: z.enum(FINDING_TYPES).optional(),
});

export const incidentSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  severity: z.enum(FINDING_SEVERITIES),
  status: z.enum(INCIDENT_STATUSES),
  title: z.string(),
  findingCount: z.number().int(),
  openedAt: isoDate,
  lastSeenAt: isoDate,
  resolvedAt: isoDate.nullable(),
});
export type Incident = z.infer<typeof incidentSchema>;

export const incidentActionSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid().nullable(),
  action: z.string(),
  note: z.string().nullable(),
  createdAt: isoDate,
});

export const incidentDetailSchema = incidentSchema.extend({
  related: z.record(z.string(), z.unknown()),
  resolutionNotes: z.string().nullable(),
  actions: z.array(incidentActionSchema),
});
export type IncidentDetail = z.infer<typeof incidentDetailSchema>;

export const incidentPageSchema = z.object({
  items: z.array(incidentSchema),
  nextCursor: z.string().nullable(),
});

export const incidentActionBodySchema = z.object({
  action: z.enum(INCIDENT_ACTIONS),
  note: z.string().trim().min(1).max(1000),
});
