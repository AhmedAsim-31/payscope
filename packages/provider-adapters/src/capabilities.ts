export const CAPABILITY_STATUSES = [
  'supported_tested',
  'implemented_unverified',
  'unsupported',
  'simulated',
] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const CAPABILITY_NAMES = [
  'webhookVerification',
  'eventNormalization',
  'authoritativeFetch',
  'reconciliation',
  'credentialValidation',
  'idMapping',
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export type ProviderCapabilities = Readonly<Record<CapabilityName, CapabilityStatus>>;
