import { randomUUID } from 'node:crypto';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTPayload,
} from 'jose';

export const TEST_ISSUER = 'https://test-project.supabase.co/auth/v1';
export const TEST_AUDIENCE = 'authenticated';

const KID = 'test-key-1';

export function generateTestKeyPair() {
  return generateKeyPair('ES256');
}

const { publicKey, privateKey } = await generateTestKeyPair();

export const localKeySet = createLocalJWKSet({
  keys: [{ ...(await exportJWK(publicKey)), kid: KID, alg: 'ES256', use: 'sig' }],
});

export type SignTestTokenOptions = {
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
  signingKey?: CryptoKey;
};

export function signTestToken(claims: JWTPayload = {}, opts: SignTestTokenOptions = {}) {
  return new SignJWT({
    email: 'user@example.test',
    role: 'authenticated',
    session_id: randomUUID(),
    ...claims,
  })
    .setProtectedHeader({ alg: 'ES256', kid: KID, typ: 'JWT' })
    .setSubject(claims.sub ?? randomUUID())
    .setIssuer(opts.issuer ?? TEST_ISSUER)
    .setAudience(opts.audience ?? TEST_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '1h')
    .sign(opts.signingKey ?? privateKey);
}
