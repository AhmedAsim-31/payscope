import { z } from 'zod';

export const PayPalEnvelopeSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  create_time: z.iso.datetime({ offset: true }),
  resource_type: z.string().nullish(),
  summary: z.string().nullish(),
  resource: z.record(z.string(), z.unknown()),
});

export type PayPalEnvelope = z.infer<typeof PayPalEnvelopeSchema>;
