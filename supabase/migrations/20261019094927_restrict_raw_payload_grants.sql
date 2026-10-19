REVOKE SELECT ON public.provider_events, public.background_jobs, public.audit_logs FROM authenticated;
--> statement-breakpoint
GRANT SELECT (id, org_id, connection_id, provider, provider_event_id, event_type, normalized_type, occurred_at, received_at, processed_at, status, attempt_count, signature_verified, object_ref, payload_pruned_at) ON public.provider_events TO authenticated;
--> statement-breakpoint
GRANT SELECT (id, org_id, kind, status, attempt_count, max_attempts, available_at, lease_expires_at, locked_by, idempotency_key, created_at, updated_at) ON public.background_jobs TO authenticated;
--> statement-breakpoint
GRANT SELECT (id, org_id, actor_id, actor_type, action, target_type, target_id, reason, outcome, request_id, created_at) ON public.audit_logs TO authenticated;
