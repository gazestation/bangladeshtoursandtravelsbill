-- Minimal auth schema shim for isolated PostgreSQL migration tests.
-- This is not a replacement for Supabase Auth and is used only by the ephemeral CI database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
