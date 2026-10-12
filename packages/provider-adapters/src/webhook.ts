export type WebhookRequest = {
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
  receivedAt: Date;
};

export type VerificationFailureReason =
  'missing_signature' | 'invalid_signature' | 'timestamp_out_of_tolerance' | 'malformed';

export type VerificationResult =
  | { ok: true; providerEventId: string; occurredAt: Date | null }
  | { ok: false; reason: VerificationFailureReason };
