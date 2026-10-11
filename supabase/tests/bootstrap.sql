-- Only for an empty disposable PostgreSQL test database, never a Supabase project.
do $$ begin
 if exists(select 1 from information_schema.tables where table_schema='public' and table_name='firms') or exists(select 1 from information_schema.schemata where schema_name='auth') then raise exception 'Tests require a fresh empty database.'; end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create schema tests;
create function tests.assert(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAILED: %',label; end if; raise notice 'PASS: %',label; end $$;
create function tests.denied(stmt text,expected text,label text) returns void language plpgsql as $$
begin
 begin execute stmt; exception when others then
  if SQLSTATE=expected then raise notice 'PASS: %',label; return; else raise exception 'FAILED: % expected %, got % (%)',label,expected,SQLSTATE,SQLERRM; end if;
 end;
 raise exception 'FAILED: % was allowed',label;
end $$;
grant usage on schema tests to anon,authenticated;
grant execute on all functions in schema tests to anon,authenticated;
