import { readCapped } from './paypal-http';

const TIMEOUT_MS = 5_000;
const MAX_CERT_BYTES = 65_536;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type CertificateFetcher = (url: string) => Promise<string>;

export function createCertificateFetcher(
  fetchImpl: typeof fetch = fetch,
  nowMs: () => number = Date.now,
): CertificateFetcher {
  const cache = new Map<string, { pem: string; expiresAt: number }>();
  return async (url) => {
    const hit = cache.get(url);
    if (hit && hit.expiresAt > nowMs()) return hit.pem;
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Certificate fetch returned ${response.status}`);
    }
    const pem = await readCapped(response, MAX_CERT_BYTES);
    cache.set(url, { pem, expiresAt: nowMs() + CACHE_TTL_MS });
    return pem;
  };
}
