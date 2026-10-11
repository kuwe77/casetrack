-- Run once in a NEW Supabase project's SQL Editor. No sample records are inserted.
begin;
create schema if not exists casetrack_private;
revoke all on schema casetrack_private from public;
grant usage on schema casetrack_private to authenticated;

create table public.firms (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(btrim(name)) between 1 and 150),
 email text not null default '' check (length(email) <= 254),
 owner_id uuid not null unique references auth.users(id),
 created_at timestamptz not null default now()
);
create table public.workspace_members (
 user_id uuid primary key references auth.users(id),
 firm_id uuid not null references public.firms(id),
 email text not null,
 role text not null check (role in ('owner','member')),
 created_at timestamptz not null default now()
);
create index workspace_members_firm on public.workspace_members(firm_id);
create table public.workspace_invites (
 id uuid primary key default gen_random_uuid(),
 firm_id uuid not null references public.firms(id),
 email text not null check (length(email) between 3 and 254 and email = lower(btrim(email))),
 expires_at timestamptz not null default now() + interval '7 days',
 unique(firm_id,email)
);
create table public.agents (
 id uuid primary key default gen_random_uuid(), firm_id uuid not null references public.firms(id),
 name text not null check(length(btrim(name)) between 1 and 150),
 email text not null default '' check(length(email)<=10000), phone text not null default '' check(length(phone)<=10000),
 agency text not null default '' check(length(agency)<=10000),
 color text not null default 'teal' check(color in ('lime','blue','peach','lavender','green','rose','teal','amber','violet')),
 created_at timestamptz not null default now(), unique(id,firm_id)
);
create table public.cases (
 id uuid primary key default gen_random_uuid(), firm_id uuid not null references public.firms(id),
 ref text not null check(length(btrim(ref)) between 1 and 150),
 buyer text not null check(length(btrim(buyer)) between 1 and 150),
 seller text not null default '' check(length(seller)<=10000), property text not null default '' check(length(property)<=10000),
 type text not null check(type in ('Subsale','SPA','Loan','Refinance')),
 status text not null check(status in ('documents','spa','loan','redemption','stamping','disbursement','completed','on_hold')),
 priority text not null check(priority in ('normal','high')),
 agent_id uuid, owner text not null default '' check(length(owner)<=10000), due_date date,
 next_step text not null default '' check(length(next_step)<=10000), notes text not null default '' check(length(notes)<=10000),
 value numeric(16,2) not null default 0 check(value >= 0 and value <> 'NaN'::numeric),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,firm_id), foreign key(agent_id,firm_id) references public.agents(id,firm_id)
);
create unique index cases_unique_ref on public.cases(firm_id,lower(ref));
create table public.tasks (
 id uuid primary key default gen_random_uuid(), firm_id uuid not null references public.firms(id),
 case_id uuid, title text not null check(length(btrim(title)) between 1 and 150), due_date date,
 assignee text not null default '' check(length(assignee)<=10000), completed boolean not null default false,
 priority text not null check(priority in ('normal','high')), created_at timestamptz not null default now(),
 foreign key(case_id,firm_id) references public.cases(id,firm_id)
);
create table public.activities (
 id uuid primary key default gen_random_uuid(), firm_id uuid not null references public.firms(id), case_id uuid,
 title text not null, detail text not null, kind text not null check(kind in ('case','status','note','task','agent')),
 actor text not null, created_at timestamptz not null default now(),
 foreign key(case_id,firm_id) references public.cases(id,firm_id)
);
create index agents_firm on public.agents(firm_id);
create index cases_firm on public.cases(firm_id);
create index tasks_firm on public.tasks(firm_id);
create index activities_firm on public.activities(firm_id,created_at desc);

-- Definer functions have an empty search path and derive identity from verified Auth.
create function casetrack_private.my_firm() returns uuid language sql stable security definer set search_path='' as $$
 select firm_id from public.workspace_members where user_id=(select auth.uid());
$$;
create function casetrack_private.is_owner() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.firms where owner_id=(select auth.uid()));
$$;
revoke all on all functions in schema casetrack_private from public, anon;
grant execute on all functions in schema casetrack_private to authenticated;

do $$ declare t text; begin
 foreach t in array array['firms','workspace_members','workspace_invites','agents','cases','tasks','activities'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 end loop;
end $$;
grant select on public.firms, public.workspace_members, public.workspace_invites, public.agents, public.cases, public.tasks, public.activities to authenticated;
grant update(name,email) on public.firms to authenticated;
grant insert, update on public.agents, public.cases, public.tasks to authenticated;
create policy firm_read on public.firms for select to authenticated using(id=(select casetrack_private.my_firm()));
create policy firm_edit on public.firms for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy members_read on public.workspace_members for select to authenticated using(firm_id=(select casetrack_private.my_firm()));
create policy invites_owner on public.workspace_invites for select to authenticated using(firm_id=(select casetrack_private.my_firm()) and (select casetrack_private.is_owner()));
create policy activity_read on public.activities for select to authenticated using(firm_id=(select casetrack_private.my_firm()));
do $$ declare t text; begin
 foreach t in array array['agents','cases','tasks'] loop
 execute format('create policy member_read on public.%I for select to authenticated using(firm_id=(select casetrack_private.my_firm()))',t);
 execute format('create policy member_insert on public.%I for insert to authenticated with check(firm_id=(select casetrack_private.my_firm()))',t);
 execute format('create policy member_update on public.%I for update to authenticated using(firm_id=(select casetrack_private.my_firm())) with check(firm_id=(select casetrack_private.my_firm()))',t);
 end loop;
end $$;

create function public.create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare f uuid; e text;
begin
 select email into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
 if e is null then raise exception 'Sign in with a verified email first.'; end if;
 if exists(select 1 from public.workspace_members where user_id=auth.uid()) then raise exception 'You already belong to a workspace.'; end if;
 insert into public.firms(name,owner_id) values(btrim(workspace_name),auth.uid()) returning id into f;
 insert into public.workspace_members(user_id,firm_id,email,role) values(auth.uid(),f,e,'owner');
 return f;
end $$;
create function public.invite_member(invitee_email text) returns void language plpgsql security definer set search_path='' as $$
declare f uuid; e text := lower(btrim(invitee_email));
begin
 select id into f from public.firms where owner_id=auth.uid();
 if f is null then raise exception 'Only the workspace owner can invite members.'; end if;
 if e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email.'; end if;
 if exists(select 1 from public.workspace_members where firm_id=f and lower(email)=e) then raise exception 'Already a workspace member.'; end if;
 insert into public.workspace_invites(firm_id,email) values(f,e) on conflict(firm_id,email) do update set expires_at=now()+interval '7 days';
end $$;
create function public.pending_invitations() returns table(id uuid,workspace_name text,expires_at timestamptz) language sql stable security definer set search_path='' as $$
 select i.id,f.name,i.expires_at from public.workspace_invites i join public.firms f on f.id=i.firm_id
 join auth.users u on lower(u.email)=i.email where u.id=auth.uid() and u.email_confirmed_at is not null and i.expires_at>now();
$$;
create function public.accept_invitation(invitation_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare i public.workspace_invites; e text;
begin
 select email into e from auth.users where id=auth.uid() and email_confirmed_at is not null;
 select * into i from public.workspace_invites where id=invitation_id and email=lower(e) and expires_at>now() for update;
 if i.id is null then raise exception 'Invitation unavailable or expired.'; end if;
 insert into public.workspace_members(user_id,firm_id,email,role) values(auth.uid(),i.firm_id,e,'member');
 delete from public.workspace_invites where id=i.id;
end $$;
create function public.remove_member(member_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare f uuid;
begin
 select id into f from public.firms where owner_id=auth.uid();
 if f is null or member_id=auth.uid() then raise exception 'Only owners may remove other members.'; end if;
 delete from public.workspace_members where user_id=member_id and firm_id=f and role='member';
end $$;
create function public.revoke_invitation(invitation_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not casetrack_private.is_owner() then raise exception 'Owner access required.'; end if;
 delete from public.workspace_invites where id=invitation_id and firm_id=casetrack_private.my_firm();
end $$;
create function public.add_note(target_case uuid, note_text text) returns void language plpgsql security definer set search_path='' as $$
declare f uuid := casetrack_private.my_firm();
begin
 if f is null or not exists(select 1 from public.cases where id=target_case and firm_id=f) then raise exception 'Case unavailable.'; end if;
 if note_text is null or length(btrim(note_text)) not between 1 and 10000 then raise exception 'Enter a note of 1–10000 characters.'; end if;
 insert into public.activities(firm_id,case_id,title,detail,kind,actor) values(f,target_case,'Internal note added',btrim(note_text),'note',(select email from auth.users where id=auth.uid()));
end $$;

create function casetrack_private.audit_record() returns trigger language plpgsql security definer set search_path='' as $$
declare title text; detail text; kind text; c uuid;
begin
 if TG_OP='UPDATE' and (new.id<>old.id or new.firm_id<>old.firm_id) then raise exception 'Record identity cannot change.'; end if;
 if TG_TABLE_NAME='cases' then
  new.updated_at=now(); c=new.id; detail=new.next_step; kind='case';
  if TG_OP='INSERT' then title='New case opened';
  elsif new.status<>old.status then title='Moved to '||new.status; kind='status';
  else title='Case details updated'; end if;
 elsif TG_TABLE_NAME='agents' then
  title=case when TG_OP='INSERT' then 'Agent added' else 'Agent details updated' end; detail=new.name; kind='agent';
 else
  c=new.case_id; detail=new.title; kind='task'; title=case when new.completed then 'Follow-up completed' when TG_OP='INSERT' then 'Follow-up created' else 'Follow-up updated' end;
 end if;
 -- AFTER trigger makes the case row available to the activity foreign key.
 insert into public.activities(firm_id,case_id,title,detail,kind,actor) values(new.firm_id,c,title,detail,kind,coalesce((select email from auth.users where id=auth.uid()),'System'));
 return new;
end $$;
create function casetrack_private.touch_case() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
create trigger touch_case before update on public.cases for each row execute function casetrack_private.touch_case();
create trigger audit_case after insert or update on public.cases for each row execute function casetrack_private.audit_record();
create trigger audit_agent after insert or update on public.agents for each row execute function casetrack_private.audit_record();
create trigger audit_task after insert or update on public.tasks for each row execute function casetrack_private.audit_record();
revoke all on function casetrack_private.audit_record(), casetrack_private.touch_case() from public, anon, authenticated;

-- One consistent snapshot. Row-level policies still apply to this invoker function.
create function public.get_workspace() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('firm',jsonb_build_object('id',f.id,'name',f.name,'email',f.email),
 'cases',coalesce((select jsonb_agg(to_jsonb(c) order by c.updated_at desc) from public.cases c where c.firm_id=f.id),'[]'),
 'agents',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.agents a where a.firm_id=f.id),'[]'),
 'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at desc) from public.tasks t where t.firm_id=f.id),'[]'),
 'activities',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from public.activities a where a.firm_id=f.id),'[]'))
 from public.firms f where f.id=casetrack_private.my_firm();
$$;
revoke all on function public.create_workspace(text),public.invite_member(text),public.pending_invitations(),public.accept_invitation(uuid),public.remove_member(uuid),public.revoke_invitation(uuid),public.add_note(uuid,text),public.get_workspace() from public, anon;
grant execute on function public.create_workspace(text),public.invite_member(text),public.pending_invitations(),public.accept_invitation(uuid),public.remove_member(uuid),public.revoke_invitation(uuid),public.add_note(uuid,text),public.get_workspace() to authenticated;
commit;
