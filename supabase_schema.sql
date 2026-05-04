-- ─────────────────────────────────────────────────────────────────────────────
-- Rsend — Email-based schema (no Supabase Auth required)
-- Run this ONCE in Supabase → SQL Editor → paste all → Run
-- ─────────────────────────────────────────────────────────────────────────────

-- Clean slate: drop everything old
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP TABLE IF EXISTS reports      CASCADE;
DROP TABLE IF EXISTS alerts       CASCADE;
DROP TABLE IF EXISTS data_sources CASCADE;
DROP TABLE IF EXISTS user_config  CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;

-- 1. User profiles (email = identifier, password_hash for auth)
CREATE TABLE user_profiles (
  email             text PRIMARY KEY,
  name              text NOT NULL,
  password_hash     text NOT NULL,
  emailjs_config    jsonb,
  cloudinary_config jsonb,
  updated_at        timestamptz DEFAULT now()
);

-- 2. Connected sheets / CSV data sources
CREATE TABLE data_sources (
  id           text PRIMARY KEY,
  user_email   text NOT NULL,
  name         text,
  type         text,
  url          text,
  data         jsonb DEFAULT '[]',
  columns      jsonb DEFAULT '[]',
  sheets       jsonb DEFAULT '[]',
  active_sheet text,
  last_sync    timestamptz,
  sub_sheets   jsonb DEFAULT '[]',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- 3. Alerts
CREATE TABLE alerts (
  id             text PRIMARY KEY,
  user_email     text NOT NULL,
  name           text,
  data_source_id text,
  column_name    text,
  condition      text,
  threshold      numeric,
  schedule       text,
  custom_day     text,
  enabled        boolean DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

-- 4. Reports
CREATE TABLE reports (
  id             text PRIMARY KEY,
  user_email     text NOT NULL,
  name           text,
  prompt         text,
  charts         jsonb DEFAULT '[]',
  data_source_id text,
  created_at     timestamptz DEFAULT now()
);

-- RLS: allow all (demo app — no Supabase Auth)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources  ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all" ON user_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON data_sources  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON alerts        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON reports       FOR ALL USING (true) WITH CHECK (true);
