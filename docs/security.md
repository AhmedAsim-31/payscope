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
