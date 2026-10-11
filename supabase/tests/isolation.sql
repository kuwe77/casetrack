begin;
insert into auth.users values
 ('00000000-0000-4000-8000-000000000001','owner-a@example.com',now()),
 ('00000000-0000-4000-8000-000000000002','owner-b@example.com',now()),
 ('00000000-0000-4000-8000-000000000003','member@example.com',now()),
 ('00000000-0000-4000-8000-000000000004','outsider@example.com',now()),
 ('00000000-0000-4000-8000-000000000005','unverified@example.com',null);
set role anon;
select tests.denied('select * from public.cases','42501','anonymous cannot read cases');
select tests.denied('select public.get_workspace()','42501','anonymous cannot call workspace RPC');
select tests.denied($q$select public.create_workspace('Intruder')$q$,'42501','anonymous cannot create workspace');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',false);
select tests.denied($q$select public.create_workspace('Unverified')$q$,'P0001','unverified account cannot create workspace');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.create_workspace('Firm A') as firm_a \gset
select tests.assert((select count(*)=1 from public.firms),'owner sees only own workspace');
insert into public.agents(id,firm_id,name) values('10000000-0000-4000-8000-000000000001',:'firm_a','Agent A');
insert into public.cases(id,firm_id,ref,buyer,type,status,priority) values('20000000-0000-4000-8000-000000000001',:'firm_a','A-001','Client A','SPA','documents','normal');
select tests.assert((select count(*)=2 from public.activities),'audit is created atomically for case and agent');
select tests.denied($q$update public.firms set owner_id='00000000-0000-4000-8000-000000000004'$q$,'42501','owner_id cannot be edited by client');
select tests.denied($q$insert into public.workspace_members values('00000000-0000-4000-8000-000000000004',null,'x','owner',now())$q$,'42501','direct membership insertion denied');
select public.invite_member('member@example.com');
select id as invitation from public.workspace_invites \gset
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select public.create_workspace('Firm B') as firm_b \gset
select tests.assert((select count(*)=0 from public.cases),'other workspace cannot read cases');
select tests.assert((select count(*)=0 from public.activities),'other workspace cannot read activity');
select tests.assert((select count(*)=0 from public.workspace_invites),'other workspace cannot read invites');
select tests.denied(format('insert into public.cases(firm_id,ref,buyer,type,status,priority) values(%L,''FAKE'',''x'',''SPA'',''spa'',''normal'')',:'firm_a'),'42501','forged workspace insert denied');
insert into public.cases(id,firm_id,ref,buyer,type,status,priority) values('20000000-0000-4000-8000-000000000002',:'firm_b','B-001','Client B','Loan','loan','normal');
select tests.denied($q$update public.cases set agent_id='10000000-0000-4000-8000-000000000001'$q$,'23503','cross-workspace foreign key denied');
with changed as(update public.cases set buyer='Intruder' where id='20000000-0000-4000-8000-000000000001' returning *) select tests.assert((select count(*)=0 from changed),'cross-workspace update changes no rows');
select tests.denied($q$select public.add_note('20000000-0000-4000-8000-000000000001','Injected')$q$,'P0001','cross-workspace note denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false);
select tests.assert(public.get_workspace() is null,'unaffiliated account has no workspace data');
select tests.assert((select count(*)=0 from public.pending_invitations()),'invitations only visible to matching email');
select tests.denied(format('select public.accept_invitation(%L)',:'invitation'),'P0001','wrong email cannot accept invitation');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
select tests.assert((select count(*)=1 from public.pending_invitations()),'invited email sees its invitation');
select public.accept_invitation(:'invitation');
select tests.assert((public.get_workspace()->'firm'->>'name')='Firm A','member can join correct workspace');
update public.cases set status='completed' where id='20000000-0000-4000-8000-000000000001';
select public.add_note('20000000-0000-4000-8000-000000000001','Verified completion');
select tests.assert((select count(*)=4 from public.activities),'member edit and note append audit events');
select tests.denied($q$select public.invite_member('outsider@example.com')$q$,'P0001','member cannot invite');
select tests.denied($q$update public.workspace_members set role='owner'$q$,'42501','member cannot promote self');
with changed as(update public.firms set name='Hijacked' returning *) select tests.assert((select count(*)=0 from changed),'member cannot rename firm');
select tests.denied('delete from public.activities','42501','activity cannot be deleted');
select tests.denied($q$insert into public.activities(firm_id,title,detail,kind,actor) values(null,'x','x','case','Owner')$q$,'42501','forged audit events denied');
select tests.denied($q$select public.create_workspace('Second')$q$,'P0001','one workspace per account enforced');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select tests.assert((select buyer='Client A' from public.cases),'failed attacks preserved original data');
select tests.assert((select actor='member@example.com' from public.activities where kind='note'),'audit actor comes from authenticated user');
select public.remove_member('00000000-0000-4000-8000-000000000003');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',false);
select tests.assert(public.get_workspace() is null,'revoked member immediately loses database access with same token');
select tests.assert((select count(*)=0 from public.cases),'revoked member cannot read case table');
reset role;
rollback;
