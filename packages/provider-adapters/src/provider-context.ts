export const ALLOWED_BASE_URLS = [
  'https://api.stripe.com',
  'https://api-m.paypal.com',
  'https://api-m.sandbox.paypal.com',
  'https://api.paddle.com',
  'https://sandbox-api.paddle.com',
  'https://api.revenuecat.com',
] as const;

export type AllowedBaseUrl = (typeof ALLOWED_BASE_URLS)[number];

export type ProviderContext = {
  credentials: { apiKey: string };
  baseUrl: AllowedBaseUrl;
  fetch: typeof fetch;
};
