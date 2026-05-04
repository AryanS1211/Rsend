-- ─────────────────────────────────────────────────────────────────────────────
-- Rsend: Background alert checking setup
-- Run this once in the Supabase SQL Editor
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Table to store last-seen data per alert (used as baseline for breach detection)
create table if not exists alert_baselines (
  alert_id        text primary key,
  user_email      text not null,
  baseline_data   jsonb not null default '[]',
  last_checked_at timestamptz not null default now()
);

-- 2. Enable required extensions (already on by Supabase; safe to re-run)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3. Schedule the check-alerts edge function to run every minute
--    The anon key below is safe to use here — the function uses its own
--    service role key internally for all DB access.
select cron.schedule(
  'rsend-check-alerts',          -- job name (unique)
  '* * * * *',                   -- every minute
  $$
  select net.http_post(
    url     := 'https://iboaiixyxwailpdoguhh.supabase.co/functions/v1/check-alerts',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlib2FpaXh5eHdhaWxwZG9ndWhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3MDU1NjQsImV4cCI6MjA5MzI4MTU2NH0.GgCFVBHc_0jOkfwE2AAgOx-jglaXSkQSiLFWFBBAXL0'
    ),
    body    := '{}'::jsonb
  ) as request_id;
  $$
);

-- Verify the job was created:
-- select * from cron.job where jobname = 'rsend-check-alerts';

-- To remove the schedule later:
-- select cron.unschedule('rsend-check-alerts');
