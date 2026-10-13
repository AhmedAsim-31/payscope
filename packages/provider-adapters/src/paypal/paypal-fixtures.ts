import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function loadPayPalFixture(name: string): Record<string, unknown> {
  const text = readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

let cached: { certPem: string; keyPem: string } | undefined;

/** Generates a throwaway self-signed 100-year RSA cert with openssl so no private key is committed. */
export function loadTestCert(): { certPem: string; keyPem: string } {
  if (cached) return cached;
  const dir = mkdtempSync(join(tmpdir(), 'payscope-paypal-'));
  const keyFile = join(dir, 'key.pem');
  const certFile = join(dir, 'cert.pem');
  const args = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '36500'];
  args.push('-subj', '/CN=payscope-test-paypal', '-keyout', keyFile, '-out', certFile);
  execFileSync('openssl', args, { stdio: 'ignore' });
  cached = { certPem: readFileSync(certFile, 'utf8'), keyPem: readFileSync(keyFile, 'utf8') };
  return cached;
}
