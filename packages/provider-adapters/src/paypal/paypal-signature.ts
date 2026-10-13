import { createVerify, X509Certificate } from 'node:crypto';
import { withinTolerance } from '../signature-utils';
import type { VerificationFailureReason } from '../webhook';
import { paypalCrc32 } from './paypal-crc32';

const TOLERANCE_SECONDS = 300;
const AUTH_ALGO = 'SHA256withRSA';
const CERT_HOSTS: readonly string[] = [
  'api.paypal.com',
  'api.sandbox.paypal.com',
  'api-m.paypal.com',
  'api-m.sandbox.paypal.com',
];

export type PayPalSignatureInput = {
  rawBody: Buffer;
  headers: Record<string, string | undefined>;
  webhookId: string;
  now: Date;
  getCertificate: (url: string) => Promise<string>;
};

export type PayPalSignatureResult = { ok: true } | { ok: false; reason: VerificationFailureReason };

const fail = (reason: VerificationFailureReason): PayPalSignatureResult => ({ ok: false, reason });

function allowedCertUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const allowed =
    url.protocol === 'https:' &&
    CERT_HOSTS.includes(url.hostname) &&
    url.port === '' &&
    url.username === '' &&
    url.password === '';
  return allowed ? url.href : null;
}

export async function verifyPayPalSignature(
  input: PayPalSignatureInput,
): Promise<PayPalSignatureResult> {
  const h = new Map(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const id = h.get('paypal-transmission-id');
  const time = h.get('paypal-transmission-time');
  const sig = h.get('paypal-transmission-sig');
  const certUrl = h.get('paypal-cert-url');
  const algo = h.get('paypal-auth-algo');
  if (!id || !time || !sig || !certUrl || !algo || !input.webhookId) {
    return fail('missing_signature');
  }
  if (algo !== AUTH_ALGO) return fail('invalid_signature');
  const seconds = Date.parse(time) / 1000;
  if (Number.isNaN(seconds)) return fail('malformed');
  if (!withinTolerance(seconds, input.now, TOLERANCE_SECONDS)) {
    return fail('timestamp_out_of_tolerance');
  }
  const allowedUrl = allowedCertUrl(certUrl);
  if (!allowedUrl) return fail('invalid_signature');
  try {
    // Fetch the URL that was validated, so no second parser can resolve the raw header differently.
    const cert = new X509Certificate(await input.getCertificate(allowedUrl));
    if (input.now < new Date(cert.validFrom) || input.now > new Date(cert.validTo)) {
      return fail('invalid_signature');
    }
    const message = `${id}|${time}|${input.webhookId}|${paypalCrc32(input.rawBody)}`;
    const valid = createVerify('RSA-SHA256').update(message).verify(cert.publicKey, sig, 'base64');
    return valid ? { ok: true } : fail('invalid_signature');
  } catch {
    return fail('invalid_signature');
  }
}
