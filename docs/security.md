# Security

## Audit guarantees

- Audit rows are written in the same transaction as the mutation they describe, so a change cannot commit without its row and a rolled-back change leaves none.
- `audit_logs` is append-only. A trigger rejects every `UPDATE` and `DELETE`, including from the API role. The only allowed delete is the cascade that removes an organization together with all its data.
- Failures are recorded: a request that reached authorization and was then rejected writes an entry with outcome `failure` and the error code.
- Each entry carries actor, actor type, action, target, reason, previous and resulting state, and the request id for correlation with API logs.
- Secrets never enter audit state. Credential rotations log only that a rotation happened.
- Reading the log needs `audit:read` (all roles); there is no write endpoint.
- Row level security lets org members select audit, incident, and incident action rows. Writes go through the API only.

## Repairs

- Repairs need `repairs:execute` (OPERATOR and above), a reason, and an idempotency key.
- Repairs change PayScope records only. No repair calls a provider or sends credentials anywhere.
- A repair is rejected rather than applied when its precondition no longer holds.

## Threat model

| Asset                             | Threat                                                      | Control                                                                                                                                                                                                                                     | Test                                                                                          |
| --------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Provider credentials at rest      | Database leak exposes webhook secrets and API keys          | AES-256-GCM with the connection id as AAD; versioned keys; fail closed on unknown version                                                                                                                                                   | `crypto/credentials-cipher.test.ts`, `crypto/rotate-credentials.integration.test.ts`          |
| Credential key                    | Long-lived key compromise                                   | Key rotation with `credentials:rotate`; previous keys are decrypt-only                                                                                                                                                                      | `crypto/rotate-credentials.integration.test.ts`, `config.test.ts`                             |
| Tenant data                       | One org reads or writes another org's rows                  | Org-scoped queries, role checks, Postgres row level security                                                                                                                                                                                | `security/tenant-isolation.integration.test.ts`, `security/rls-isolation.integration.test.ts` |
| Tenant data in transit and caches | Shared caches or browsers retain tenant responses           | `Cache-Control: no-store` on every `/api/v1` response                                                                                                                                                                                       | `security/api-hardening.test.ts`                                                              |
| Browser sessions                  | Clickjacking, MIME sniffing, referrer leakage               | API: Helmet (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS in production). Web: `next.config.ts` headers (CSP, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production) | `security/api-hardening.test.ts`, `web/src/lib/security-headers.test.ts`                      |
| API origin                        | Cross-origin reads from a hostile site                      | Strict CORS allow-list; preflight from other origins gets no allow headers                                                                                                                                                                  | `security/api-hardening.test.ts`                                                              |
| API availability                  | Oversized or deeply nested JSON                             | 64 KiB body limit on API routes, 20 level depth limit, bodies rejected on GET                                                                                                                                                               | `security/api-hardening.test.ts`                                                              |
| Webhook ingress                   | Forged deliveries                                           | Per-provider signature verification against the connection's secrets                                                                                                                                                                        | `webhooks/webhook-ingress.integration.test.ts`                                                |
| Webhook ingress                   | Replay of a captured delivery                               | Timestamp tolerance rejects old signed deliveries; unique event ids dedupe replays inside the window                                                                                                                                        | `webhooks/webhook-replay.integration.test.ts`                                                 |
| Outbound provider calls           | SSRF through a crafted base or certificate URL              | Base URLs checked against `ALLOWED_BASE_URLS` before any fetch; PayPal certificate URLs checked against an allow-list                                                                                                                       | `provider-adapters/src/ssrf-base-url.test.ts`, `paypal-signature.test.ts`                     |
| Logs                              | Secrets, tokens, PII, or raw payloads leak into log storage | Redaction paths for auth and signature headers; handlers log ids and codes, never bodies                                                                                                                                                    | `security/log-redaction.integration.test.ts`, `webhooks/webhook-logging.integration.test.ts`  |
| Audit trail                       | Tampering after the fact                                    | Append-only trigger on `audit_logs`                                                                                                                                                                                                         | `audit` integration tests                                                                     |

## Credential key rotation runbook

- `CREDENTIALS_ENCRYPTION_KEY` is always the active key.
- `CREDENTIALS_ENCRYPTION_KEY_VERSION` is the active key's version, an integer from 1 to 255, default 1.
- `CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS` lists retired keys as comma-separated `version:base64` entries, for example `2:<base64>,1:<base64>`.
- Each retired key must decode to 32 bytes, and no version may repeat or equal the active version.
- Encryption always uses the active key and stamps its version into the blob and into `credentials_key_version`.
- Decryption reads the version byte from the blob and picks the matching key.
- A blob whose version has no configured key fails to decrypt, and the caller treats the credentials as unavailable.

To rotate:

1. Generate a new key with `openssl rand -base64 32`.
2. Move the current key into `CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS` under its current version.
3. Set `CREDENTIALS_ENCRYPTION_KEY` to the new key and `CREDENTIALS_ENCRYPTION_KEY_VERSION` to the next integer.
4. Deploy the API and the worker with the same values.
5. Run `pnpm --filter @payscope/api credentials:rotate` with the same environment.
6. The script re-encrypts rows with an older version in batches, with the connection id as AAD.
7. Each update is conditional on the row still holding the old version, so concurrent edits are never overwritten and re-running is safe.
8. The script prints a JSON summary and exits non-zero if any row could not be decrypted, naming the connection ids.
9. Fix those rows, then run the script again until `failed` is empty.
10. Once every row reports the new version, remove the retired key from `CREDENTIALS_ENCRYPTION_KEYS_PREVIOUS` and deploy.

Verify completion with `select credentials_key_version, count(*) from provider_connections where credentials_ciphertext is not null group by 1`.

## CSRF

- The API authenticates with a bearer token in the `Authorization` header and never reads cookies for authentication.
- A browser does not attach that header on its own, so a hostile site cannot make an authenticated request on the user's behalf.
- CSRF tokens would add state without closing any attack, so none are used.
- CORS only allows the configured web origin, which also stops other origins from reading responses.
- The web app's cookie-backed sign-out route checks the `Origin` header, because it is the one place a cookie triggers a state change.
- Webhook endpoints are unauthenticated by design and are protected by signatures instead.

## Logging rules

- Never log request or response bodies, webhook payloads, or provider objects.
- Never log secrets, tokens, signatures, API keys, customer emails, or decrypted credentials.
- Log identifiers and codes instead: provider, connection id, event id, job id, reason, and error code.
- Authorization, cookie, and provider signature headers are redacted in request logs.
- Worker errors are reduced to a short sanitized string before logging.
- Database error messages can echo an offending input value, so do not pass user-supplied secrets through query parameters that can fail type validation.
- Every new log call that touches request or provider data needs a case in `security/log-redaction.integration.test.ts`.
