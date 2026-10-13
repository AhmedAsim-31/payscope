import { z } from 'zod';

export const PaddleEnvelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.iso.datetime({ offset: true }),
  notification_id: z.string().min(1).nullish(),
  data: z.record(z.string(), z.unknown()),
});

export type PaddleEnvelope = z.infer<typeof PaddleEnvelopeSchema>;
