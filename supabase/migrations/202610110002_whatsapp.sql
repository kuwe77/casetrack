begin;
create table public.whatsapp_settings (
 firm_id uuid primary key references public.firms(id),
 account_id text not null default '' check(length(account_id)<=100),
 enabled boolean not null default false, dry_run boolean not null default true,
 auto_reply boolean not null default true,
 poll_seconds integer not null default 60 check(poll_seconds between 30 and 600),
 enabled_since timestamptz not null default now(),
 last_poll_at timestamptz, worker_status text not null default 'Not connected'
);
create unique index whatsapp_account_workspace on public.whatsapp_settings(account_id) where account_id<>'';
create table casetrack_private.whatsapp_tokens (
 firm_id uuid primary key references public.firms(id), token_hash text not null unique
);
revoke all on casetrack_private.whatsapp_tokens from public,anon,authenticated;
create table public.whatsapp_contacts (
 firm_id uuid not null references public.firms(id), agent_id uuid not null,
 phone text not null check(phone ~ '^\+[1-9][0-9]{7,14}$'),
 enabled boolean not null default false, consent boolean not null default false,
 primary key(firm_id,agent_id), unique(firm_id,phone),
 foreign key(agent_id,firm_id) references public.agents(id,firm_id)
);
create table public.whatsapp_rules (
 firm_id uuid not null references public.firms(id), case_id uuid not null,
 enabled boolean not null default false,
 mode text not null default 'request_update' check(mode in ('request_update','send_progress')),
 interval_hours integer not null default 72 check(interval_hours between 24 and 2160),
 next_due_at timestamptz not null default now(),
 shared_update text not null default '' check(length(shared_update)<=1000),
 template_name text not null default '' check(template_name ~ '^[a-z0-9_]*$' and length(template_name)<=100),
 template_language text not null default 'en_US' check(template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
 primary key(firm_id,case_id), foreign key(case_id,firm_id) references public.cases(id,firm_id)
);
create table public.whatsapp_events (
 id uuid primary key default gen_random_uuid(), firm_id uuid not null references public.firms(id),
 event_key text not null check(length(event_key)<=512),
 phone text not null check(length(phone)<=16), case_id uuid,
 kind text not null check(kind in ('reply','followup')),
 status text not null default 'processing' check(status in ('processing','preview','sent','blocked','failed','uncertain')),
 reason text not null default '' check(length(reason)<=120),
 response text not null default '' check(length(response)<=4000),
 created_at timestamptz not null default now(), completed_at timestamptz,
 unique(firm_id,event_key), foreign key(case_id,firm_id) references public.cases(id,firm_id)
);
create index whatsapp_events_recent on public.whatsapp_events(firm_id,created_at desc);
do $$ declare t text; begin
 foreach t in array array['whatsapp_settings','whatsapp_contacts','whatsapp_rules','whatsapp_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy owner_read on public.%I for select to authenticated using(firm_id=casetrack_private.my_firm() and casetrack_private.is_owner())',t);
 end loop;
 foreach t in array array['whatsapp_contacts','whatsapp_rules'] loop
 execute format('grant insert,update,delete on public.%I to authenticated',t);
 execute format('create policy owner_write on public.%I for all to authenticated using(firm_id=casetrack_private.my_firm() and casetrack_private.is_owner()) with check(firm_id=casetrack_private.my_firm() and casetrack_private.is_owner())',t);
 end loop;
end $$;

create function public.configure_whatsapp(settings jsonb) returns void language plpgsql security definer set search_path='' as $$
declare f uuid := casetrack_private.my_firm(); a text := btrim(settings->>'account_id');
begin
 if not casetrack_private.is_owner() or f is null then raise exception 'Owner access required'; end if;
 if a is null or a !~ '^[a-zA-Z0-9_-]{1,100}$' then raise exception 'Enter the verified Zernio WhatsApp account ID'; end if;
 insert into public.whatsapp_settings(firm_id,account_id,enabled,dry_run,auto_reply,poll_seconds)
 values(f,a,coalesce((settings->>'enabled')::boolean,false),coalesce((settings->>'dry_run')::boolean,true),coalesce((settings->>'auto_reply')::boolean,true),coalesce((settings->>'poll_seconds')::integer,60))
 on conflict(firm_id) do update set account_id=excluded.account_id,enabled=excluded.enabled,dry_run=excluded.dry_run,auto_reply=excluded.auto_reply,poll_seconds=excluded.poll_seconds,
 enabled_since=case when not whatsapp_settings.enabled and excluded.enabled or whatsapp_settings.account_id<>excluded.account_id then now() else whatsapp_settings.enabled_since end;
end $$;
create function public.rotate_whatsapp_worker(worker_token text) returns void language plpgsql security definer set search_path='' as $$
declare f uuid := casetrack_private.my_firm();
begin
 if not casetrack_private.is_owner() or f is null then raise exception 'Owner access required'; end if;
 if worker_token !~ '^[a-f0-9]{64}$' or worker_token is null then raise exception 'Invalid worker token'; end if;
 insert into casetrack_private.whatsapp_tokens values(f,encode(sha256(convert_to(worker_token,'UTF8')),'hex'))
 on conflict(firm_id) do update set token_hash=excluded.token_hash;
end $$;
create function casetrack_private.whatsapp_context(f uuid,p text) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('agent_id',a.id,'phone',wc.phone,'consent',wc.consent,'cases',coalesce((
 select jsonb_agg(jsonb_build_object('id',c.id,'ref',c.ref,'status',c.status,'due_date',c.due_date,'updated_at',c.updated_at,'shared_update',coalesce(r.shared_update,'')) order by c.ref)
 from public.cases c left join public.whatsapp_rules r on r.firm_id=c.firm_id and r.case_id=c.id
 where c.firm_id=f and c.agent_id=a.id),'[]'::jsonb))
 from public.whatsapp_contacts wc join public.agents a on a.id=wc.agent_id and a.firm_id=wc.firm_id
 where wc.firm_id=f and wc.phone=p and wc.enabled
 and regexp_replace(a.phone,'[ ()-]','','g')=wc.phone;
$$;
revoke all on function casetrack_private.whatsapp_context(uuid,text) from public,anon,authenticated;
-- The worker has only this capability. No service-role key or general table access.
create function public.whatsapp_worker(worker_token text,operation text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare f uuid; s public.whatsapp_settings; ctx jsonb; ev public.whatsapp_events; cid uuid; p text; result jsonb;
begin
 if worker_token is null or worker_token !~ '^[a-f0-9]{64}$' then raise exception 'Worker authentication failed'; end if;
 select firm_id into f from casetrack_private.whatsapp_tokens where token_hash=encode(sha256(convert_to(worker_token,'UTF8')),'hex');
 if f is null then raise exception 'Worker authentication failed'; end if;
 select * into s from public.whatsapp_settings where firm_id=f;
 if s.firm_id is null then raise exception 'Configure WhatsApp first'; end if;
 if operation='poll' then
  update public.whatsapp_settings set last_poll_at=now(),worker_status=case when enabled then 'Polling' else 'Paused' end where firm_id=f;
  return to_jsonb(s) || jsonb_build_object('rules',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('phone',wc.phone)) from public.whatsapp_rules r join public.cases c on c.id=r.case_id and c.firm_id=r.firm_id join public.whatsapp_contacts wc on wc.agent_id=c.agent_id and wc.firm_id=c.firm_id where r.firm_id=f and r.enabled and wc.enabled and wc.consent and c.status not in ('completed','on_hold') and r.next_due_at<=now()),'[]'::jsonb));
 end if;
 if operation='finish' then
  if payload->>'status' not in ('preview','sent','blocked','failed','uncertain') then raise exception 'Invalid result'; end if;
  update public.whatsapp_events set status=payload->>'status',reason=left(coalesce(payload->>'reason',''),120),response=left(coalesce(payload->>'response',''),4000),completed_at=now()
   where firm_id=f and id=(payload->>'id')::uuid and status='processing' returning * into ev;
  if ev.kind='followup' and ev.status in ('sent','preview','blocked','failed','uncertain') then
   update public.whatsapp_rules set next_due_at=now()+make_interval(hours=>interval_hours) where firm_id=f and case_id=ev.case_id;
  end if;
  return '{}'::jsonb;
 end if;
 if not s.enabled or payload->>'account_id' is distinct from s.account_id then return null; end if;
 p:=payload->>'phone';
 if p is null or p !~ '^\+[1-9][0-9]{7,14}$' then return null; end if;
 if operation='optout' then
  insert into public.whatsapp_events(firm_id,event_key,phone,kind,status,reason,completed_at) values(f,payload->>'event_key',p,'reply','blocked','Agent opted out',now()) on conflict(firm_id,event_key) do nothing returning id into cid;
  if cid is not null then update public.whatsapp_contacts set enabled=false,consent=false where firm_id=f and phone=p; end if;
  return '{}'::jsonb;
 end if;
 ctx:=casetrack_private.whatsapp_context(f,p);
 if operation='context' then return ctx; end if;
 if operation='claim' then
  if payload->>'kind'='reply' and not s.auto_reply then return null; end if;
  cid:=nullif(payload->>'case_id','')::uuid;
  if cid is not null and not exists(select 1 from jsonb_array_elements(ctx->'cases') c where c->>'id'=cid::text) then return null; end if;
  if payload->>'kind'='followup' and (ctx is null or not (ctx->>'consent')::boolean or not exists(select 1 from public.whatsapp_rules r join public.cases c on c.id=r.case_id where r.firm_id=f and r.case_id=cid and r.enabled and r.next_due_at<=now() and c.status not in ('completed','on_hold'))) then return null; end if;
  -- At most one reserved response per number in a minute; a failed/uncertain send is never blindly replayed.
  perform pg_advisory_xact_lock(hashtextextended(f::text||p,0));
  if exists(select 1 from public.whatsapp_events where firm_id=f and phone=p and created_at>now()-interval '1 minute') then return null; end if;
  insert into public.whatsapp_events(firm_id,event_key,phone,case_id,kind) values(f,payload->>'event_key',p,cid,payload->>'kind') on conflict(firm_id,event_key) do nothing returning id into cid;
  return case when cid is null then null else jsonb_build_object('id',cid) end;
 end if;
 if operation='authorize' then
  select * into ev from public.whatsapp_events where firm_id=f and id=(payload->>'id')::uuid and phone=p and status='processing';
  if ev.id is null or ev.created_at<now()-interval '5 minutes' then return null; end if;
  if ev.kind='reply' and not s.auto_reply then return null; end if;
  if ev.kind='followup' and (ctx is null or not (ctx->>'consent')::boolean or not exists(select 1 from public.whatsapp_rules r join public.cases c on c.id=r.case_id where r.firm_id=f and r.case_id=ev.case_id and r.enabled and r.next_due_at<=now() and c.status not in ('completed','on_hold'))) then return null; end if;
  return jsonb_build_object('dry_run',s.dry_run,'context',ctx,'rule',(select to_jsonb(r) from public.whatsapp_rules r where r.firm_id=f and r.case_id=ev.case_id));
 end if;
 raise exception 'Unknown worker operation';
end $$;
revoke all on function public.configure_whatsapp(jsonb),public.rotate_whatsapp_worker(text),public.whatsapp_worker(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.configure_whatsapp(jsonb),public.rotate_whatsapp_worker(text) to authenticated;
grant execute on function public.whatsapp_worker(text,text,jsonb) to anon,authenticated;
commit;
