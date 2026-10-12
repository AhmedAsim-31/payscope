export const PROVIDER_NAMES = ['stripe', 'paddle', 'paypal', 'revenuecat'] as const;

export type ProviderName = (typeof PROVIDER_NAMES)[number];
