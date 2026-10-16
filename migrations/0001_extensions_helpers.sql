-- collective-asset-core 0001 — schema `core`, extensions, the uuidv7() guard, database roles, default
-- privileges, trigger functions and session helpers (schema-design v2 §1.2, §4.1, §4.5, §7.1).
-- Runs inside one transaction (asset-core migrate). Every statement is idempotent so a half-provisioned
-- cluster (roles already created by an operator) migrates cleanly.

CREATE SCHEMA IF NOT EXISTS core;
COMMENT ON SCHEMA core IS 'Collective asset core (collective-asset-core package, ADR-0010): tenancy, identity, asset hierarchy, parties, asset items, documents, cross-tenant grants. Never altered by app migrations (D-153).';

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- uuidv7() is built into PostgreSQL 18 (pg_catalog). Older servers get a compatible SQL implementation in
-- `public` so that column defaults read `uuidv7()` on every version (D-152: uuidv7 primary keys).
DO $guard$
BEGIN
  IF current_setting('server_version_num')::int < 180000
     AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'uuidv7' AND pronargs = 0) THEN
    EXECUTE $fn$
      CREATE FUNCTION public.uuidv7() RETURNS uuid LANGUAGE sql VOLATILE PARALLEL SAFE AS $body$
        SELECT encode(
          set_bit(set_bit(
            overlay(uuid_send(gen_random_uuid()) PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3) FROM 1 FOR 6),
            52, 1), 53, 1), 'hex')::uuid
      $body$
    $fn$;
    COMMENT ON FUNCTION public.uuidv7() IS 'collective-asset-core guard: RFC 9562 UUIDv7 for PostgreSQL < 18 (PG 18 ships pg_catalog.uuidv7()).';
  END IF;
END
$guard$;

-- Database roles (schema-design §4.5). NOLOGIN group roles: deployments grant them to login users.
--   gp_owner     owns schemas, runs migrations
--   gp_app       the application: DML only, NOBYPASSRLS — row-level security applies to every statement
--   gp_platform  BYPASSRLS: platform admin surface, identity lookups, cross-tenant jobs; also owns the
--                SECURITY DEFINER helpers so policies never recurse
--   gp_reporting read-only exports/BI, RLS applies (sets app.tenant_id per export)
DO $roles$
DECLARE
  spec text[];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY ARRAY[['gp_owner', 'NOLOGIN'], ['gp_app', 'NOLOGIN NOBYPASSRLS'],
                                      ['gp_platform', 'NOLOGIN BYPASSRLS'], ['gp_reporting', 'NOLOGIN NOBYPASSRLS']] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = spec[1]) THEN
      BEGIN
        EXECUTE format('CREATE ROLE %I %s', spec[1], spec[2]);
      EXCEPTION WHEN duplicate_object OR unique_violation THEN
        NULL; -- created concurrently by another database's migration on the same cluster
      END;
    END IF;
  END LOOP;
  -- The migrating role must be able to hand SECURITY DEFINER helpers to gp_platform (0007).
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    IF NOT pg_has_role(current_user, 'gp_platform', 'MEMBER') THEN
      EXECUTE format('GRANT gp_platform TO %I', current_user);
    END IF;
    IF NOT pg_has_role(current_user, 'gp_owner', 'MEMBER') THEN
      EXECUTE format('GRANT gp_owner TO %I', current_user);
    END IF;
  END IF;
END
$roles$;

GRANT USAGE ON SCHEMA core TO gp_app, gp_platform, gp_reporting;
-- Default privileges for objects the migrating role creates later in `core` (0002+); 0007 also grants
-- explicitly so the result does not depend on who ran which migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gp_app, gp_platform;
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT ON TABLES TO gp_reporting;
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT EXECUTE ON FUNCTIONS TO gp_app, gp_platform, gp_reporting;

-- ---------------------------------------------------------------------------------------------------------
-- Session helpers (schema-design §4.5). `app.tenant_id` / `app.actor_id` are set with SET LOCAL by
-- withTenant()/withTx(); missing or empty → NULL → no tenant row is visible.
CREATE OR REPLACE FUNCTION core.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
COMMENT ON FUNCTION core.current_tenant_id() IS 'The tenant of the current transaction (SET LOCAL app.tenant_id), or NULL.';

CREATE OR REPLACE FUNCTION core.current_actor_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.actor_id', true), '')::uuid $$;
COMMENT ON FUNCTION core.current_actor_id() IS 'The acting core.user_account of the current transaction (SET LOCAL app.actor_id), or NULL.';

-- ---------------------------------------------------------------------------------------------------------
-- Trigger functions (schema-design §4.1, §4.9)

-- BEFORE UPDATE: keep updated_at current on every row change.
CREATE OR REPLACE FUNCTION core.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- BEFORE UPDATE OR DELETE: append-only tables (⟲). With an argument (a column name such as `valid_to`
-- or `effective_to`), an UPDATE that only closes an open row (sets that column, plus updated_at/updated_by)
-- is allowed once; everything else raises SQLSTATE P0001 with a `core.append_only` message prefix.
CREATE OR REPLACE FUNCTION core.deny_mutation() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
DECLARE
  close_col text := CASE WHEN TG_NARGS > 0 THEN TG_ARGV[0] END;
BEGIN
  IF TG_OP = 'UPDATE' AND close_col IS NOT NULL
     AND to_jsonb(OLD) ->> close_col IS NULL
     AND to_jsonb(NEW) ->> close_col IS NOT NULL
     AND (to_jsonb(OLD) - close_col - 'updated_at' - 'updated_by') = (to_jsonb(NEW) - close_col - 'updated_at' - 'updated_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'core.append_only: %.% is append-only (% refused)', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END
$$;

-- BEFORE INSERT on effective-dated / period tables (schema-design §4.1):
--   TG_ARGV[0] = comma-separated partition columns (e.g. 'setting_id' or 'tenant_id,setting_id')
--   TG_ARGV[1] = start column (effective_from | valid_from), TG_ARGV[2] = end column (effective_to | valid_to)
-- Closes the open row of the same partition that starts before NEW (sets its end = NEW start) and, when a
-- later row already exists, ends NEW at that row's start. Runs as the table owner's view of the rows
-- (SECURITY DEFINER) so a tenant cannot leave another partition's row open by not seeing it.
CREATE OR REPLACE FUNCTION core.close_previous_period() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
AS $$
DECLARE
  parts text[] := string_to_array(TG_ARGV[0], ',');
  start_col text := TG_ARGV[1];
  end_col text := TG_ARGV[2];
  new_row jsonb := to_jsonb(NEW);
  cond text := '';
  col text;
  next_start text;
  start_type text := (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
                       WHERE a.attrelid = TG_RELID AND a.attname = TG_ARGV[1] AND NOT a.attisdropped);
BEGIN
  FOREACH col IN ARRAY parts LOOP
    cond := cond || format(' AND %1$I IS NOT DISTINCT FROM ($1 ->> %2$L)::%3$s', col, col,
      (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
        WHERE a.attrelid = TG_RELID AND a.attname = col AND NOT a.attisdropped));
  END LOOP;
  EXECUTE format('UPDATE %I.%I SET %I = ($1 ->> %L)::%s WHERE %I IS NULL AND %I < ($1 ->> %L)::%s %s',
                 TG_TABLE_SCHEMA, TG_TABLE_NAME, end_col, start_col, start_type, end_col, start_col, start_col,
                 start_type, cond)
    USING new_row;
  IF new_row ->> end_col IS NULL THEN
    EXECUTE format('SELECT min(%I)::text FROM %I.%I WHERE %I > ($1 ->> %L)::%s %s',
                   start_col, TG_TABLE_SCHEMA, TG_TABLE_NAME, start_col, start_col, start_type, cond)
      INTO next_start USING new_row;
    IF next_start IS NOT NULL THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object(end_col, next_start));
    END IF;
  END IF;
  RETURN NEW;
END
$$;
COMMENT ON FUNCTION core.close_previous_period() IS 'BEFORE INSERT trigger for versioned/period tables: closes the previous open row of the partition (schema-design §4.1).';
