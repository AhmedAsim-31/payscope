-- Opt-in pg_cron tick for the hosted Supabase project, see docs/deployment.md.
-- Not a migration: local Postgres and CI have no pg_cron or pg_net.
-- Apply manually in the Supabase SQL editor after storing both Vault secrets:
--   select vault.create_secret('https://<render-service>.onrender.com', 'payscope_api_base_url');
--   select vault.create_secret('<INTERNAL_TICK_TOKEN value>', 'payscope_internal_tick_token');
-- Re-running is safe: cron.schedule replaces a job with the same name.
-- Remove with: select cron.unschedule('payscope-tick');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'payscope-tick',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'payscope_api_base_url') || '/internal/tick',
    headers := jsonb_build_object(
      'x-internal-token',
      (select decrypted_secret from vault.decrypted_secrets where name = 'payscope_internal_tick_token')
    ),
    -- A cold Render Free instance takes about a minute to wake.
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);
