import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createCredentialsCipher,
  decodeCredentialsKey,
  parsePreviousKeys,
  type Credentials,
} from './credentials-cipher';

const SECRET = 'whsec_super_secret_value';
const credentials: Credentials = { webhookSecrets: [SECRET], apiKey: 'sk_test_abc123' };
const AAD = 'connection-1';

describe('credentials cipher', () => {
  const cipher = createCredentialsCipher(randomBytes(32));

  it('round trips and uses a fresh IV each time', () => {
    const a = cipher.encrypt(credentials, AAD);
    const b = cipher.encrypt(credentials, AAD);
    expect(cipher.decrypt(a.ciphertext, AAD)).toEqual(credentials);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.keyVersion).toBe(1);
    expect(a.ciphertext[0]).toBe(1);
    expect(a.ciphertext.toString('latin1')).not.toContain(SECRET);
  });

  it('detects tampering in every region', () => {
    const { ciphertext } = cipher.encrypt(credentials, AAD);
    for (const index of [1, 13, ciphertext.length - 1]) {
      const tampered = Buffer.from(ciphertext);
      tampered[index] = (tampered[index] ?? 0) ^ 0xff;
      expect(() => cipher.decrypt(tampered, AAD)).toThrow('credentials decryption failed');
    }
    expect(() => cipher.decrypt(ciphertext.subarray(0, 10), AAD)).toThrow();
  });

  it('fails with a different key or a different row binding', () => {
    const { ciphertext } = cipher.encrypt(credentials, AAD);
    expect(() => createCredentialsCipher(randomBytes(32)).decrypt(ciphertext, AAD)).toThrow();
    expect(() => cipher.decrypt(ciphertext, 'connection-2')).toThrow();
  });

  it('never leaks plaintext in errors', () => {
    const { ciphertext } = cipher.encrypt(credentials, AAD);
    ciphertext[20] = (ciphertext[20] ?? 0) ^ 1;
    expect(() => cipher.decrypt(ciphertext, AAD)).toThrow(/^(?!.*whsec_)/);
  });

  it('rejects invalid credentials and keys', () => {
    expect(() => cipher.encrypt({ webhookSecrets: ['a', 'b', 'c'] }, AAD)).toThrow();
    expect(() => createCredentialsCipher(randomBytes(16))).toThrow();
    expect(decodeCredentialsKey(randomBytes(32).toString('base64'))).toHaveLength(32);
    expect(decodeCredentialsKey(randomBytes(16).toString('base64'))).toBeUndefined();
  });
});

describe('credentials key versions', () => {
  const k1 = randomBytes(32);
  const k2 = randomBytes(32);
  const v1 = createCredentialsCipher(k1, { version: 1 });
  const v2 = createCredentialsCipher(k2, { version: 2, previous: new Map([[1, k1]]) });

  it('decrypts old rows with the previous key and encrypts with the active one', () => {
    const old = v1.encrypt(credentials, AAD);
    expect(v2.decrypt(old.ciphertext, AAD)).toEqual(credentials);
    const fresh = v2.encrypt(credentials, AAD);
    expect(fresh.keyVersion).toBe(2);
    expect(fresh.ciphertext[0]).toBe(2);
    expect(v2.decrypt(fresh.ciphertext, AAD)).toEqual(credentials);
  });

  it('fails closed on an unknown version', () => {
    const { ciphertext } = v2.encrypt(credentials, AAD);
    expect(() => v1.decrypt(ciphertext, AAD)).toThrow('credentials decryption failed');
    const unknown = Buffer.from(ciphertext);
    unknown[0] = 9;
    expect(() => v2.decrypt(unknown, AAD)).toThrow('credentials decryption failed');
  });

  it('rejects a previous key that reuses the active version', () => {
    expect(() =>
      createCredentialsCipher(k2, { version: 2, previous: new Map([[2, k1]]) }),
    ).toThrow();
  });

  it('parses the previous-keys format strictly', () => {
    const a = k1.toString('base64');
    const b = k2.toString('base64');
    expect([...(parsePreviousKeys(`2:${a}, 1:${b}`)?.keys() ?? [])]).toEqual([2, 1]);
    for (const bad of [a, `0:${a}`, `256:${a}`, `1:${a},1:${b}`, '1:short', `1:${a}:x`, '']) {
      expect(parsePreviousKeys(bad)).toBeUndefined();
    }
  });
});
