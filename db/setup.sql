-- One client workspace. Run once in your own Supabase SQL Editor.
-- Data is accessible only through the server API with explicit email authorization.
begin;
create table public.outreach_leads (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name)>0),
 company text not null default '', position text not null default '', email text not null default '',
 phone text not null default '', linkedin_url text not null default '',
 status text not null default 'New' check(status in ('New','Contacted','Replied','Qualified','Meeting booked','Won','Lost')),
 source_data jsonb not null default '{}'::jsonb,
 owner text not null default 'Your agency', created_at timestamptz not null default now(), external_id text unique,
 identity_key text generated always as (case when email<>'' then 'email:'||lower(email) when phone<>'' then 'phone:'||phone when linkedin_url<>'' then 'linkedin:'||linkedin_url else 'external:'||external_id end) stored unique,
 check(email<>'' or phone<>'' or linkedin_url<>'' or external_id is not null)
);
create table public.outreach_activities (
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.outreach_leads(id) on delete cascade,
 channel text not null check(channel in ('Email','LinkedIn','WhatsApp','Pipedrive','Other')),
 kind text not null check(kind in ('Message sent','Reply received','Positive reply','Connection requested','Connection accepted','Meeting booked','Note')),
 message text not null,occurred_at timestamptz not null default now(),external_id text unique
);
create index outreach_activities_lead_time on public.outreach_activities(lead_id,occurred_at desc);
create index outreach_activities_time on public.outreach_activities(occurred_at desc);
create table public.outreach_deals (
 id uuid primary key default gen_random_uuid(),lead_id uuid references public.outreach_leads(id) on delete set null,
 title text not null,value numeric not null default 0,currency text not null default 'USD',
 status text not null default 'open' check(status in ('open','won','lost')),stage text not null default '',external_id text unique,sync_run timestamptz
);
create index outreach_deals_lead on public.outreach_deals(lead_id);
create table public.outreach_integrations (
 provider text primary key check(provider in ('outlook','gmail','pipedrive')),credentials text not null,
 account text not null,settings jsonb not null default '{}',last_sync timestamptz,last_error text,cursor text,locked_until timestamptz
);
alter table public.outreach_leads enable row level security;
alter table public.outreach_activities enable row level security;
alter table public.outreach_deals enable row level security;
alter table public.outreach_integrations enable row level security;
revoke all on public.outreach_leads,public.outreach_activities,public.outreach_deals,public.outreach_integrations from public,anon,authenticated;
grant select,insert,update,delete on public.outreach_leads,public.outreach_activities,public.outreach_deals,public.outreach_integrations to service_role;
-- This private single-client app authorizes users in its trusted server.
-- Explicit deny policies also protect these tables if browser grants are added later.
create policy outreach_leads_deny_browser on public.outreach_leads as restrictive for all to anon,authenticated using (false) with check (false);
create policy outreach_activities_deny_browser on public.outreach_activities as restrictive for all to anon,authenticated using (false) with check (false);
create policy outreach_deals_deny_browser on public.outreach_deals as restrictive for all to anon,authenticated using (false) with check (false);
create policy outreach_integrations_deny_browser on public.outreach_integrations as restrictive for all to anon,authenticated using (false) with check (false);
-- A batch is one transaction. Reimporting the same timestamped activity is idempotent.
create function public.outreach_import(payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; lid uuid; ikey text; previous_external text; activity_key text; leads_count integer:=0; activity_count integer:=0; added integer;
begin
 if jsonb_typeof(payload)<>'array' or jsonb_array_length(payload)>500 then raise exception 'Expected up to 500 rows';end if;
 for r in select * from jsonb_array_elements(payload) loop
  ikey:=case when coalesce(r->>'email','')<>'' then 'email:'||lower(r->>'email') when coalesce(r->>'phone','')<>'' then 'phone:'||(r->>'phone') when coalesce(r->>'linkedin_url','')<>'' then 'linkedin:'||(r->>'linkedin_url') else 'external:'||(r->>'external_id') end;
  lid:=null;
  if coalesce(r->>'external_id','')<>'' then select id into lid from public.outreach_leads where external_id=r->>'external_id';end if;
  if lid is null then select id into lid from public.outreach_leads where identity_key=ikey;end if;
  if lid is not null then
   select external_id into previous_external from public.outreach_leads where id=lid;
   if previous_external is not null and r->>'external_id' is not null and previous_external<>r->>'external_id' then raise exception 'Two CRM contacts share the same identity. Resolve the duplicate in Pipedrive first.';end if;
   update public.outreach_leads set name=r->>'name',company=coalesce(nullif(r->>'company',''),company),position=coalesce(nullif(r->>'position',''),position),email=coalesce(nullif(lower(r->>'email'),''),email),phone=coalesce(nullif(r->>'phone',''),phone),linkedin_url=coalesce(nullif(r->>'linkedin_url',''),linkedin_url),external_id=coalesce(r->>'external_id',external_id) where id=lid;
  else
   insert into public.outreach_leads(name,company,position,email,phone,linkedin_url,status,owner,external_id) values(r->>'name',coalesce(r->>'company',''),coalesce(r->>'position',''),lower(coalesce(r->>'email','')),coalesce(r->>'phone',''),coalesce(r->>'linkedin_url',''),coalesce(nullif(r->>'status',''),'New'),coalesce(nullif(r->>'owner',''),'Your agency'),r->>'external_id') returning id into lid;
   leads_count:=leads_count+1;
  end if;
  if coalesce(r->>'channel','')<>'' then
   activity_key:='csv:'||md5(lid::text||'|'||(r->>'channel')||'|'||(r->>'kind')||'|'||(r->>'message')||'|'||((r->>'occurred_at')::timestamptz)::text);
   insert into public.outreach_activities(lead_id,channel,kind,message,occurred_at,external_id) values(lid,r->>'channel',r->>'kind',r->>'message',(r->>'occurred_at')::timestamptz,activity_key) on conflict(external_id) do nothing;
   get diagnostics added=row_count;activity_count:=activity_count+added;
  end if;
 end loop;
 return jsonb_build_object('new_leads',leads_count,'new_activities',activity_count,'rows',jsonb_array_length(payload));
end;$$;
revoke all on function public.outreach_import(jsonb) from public,anon,authenticated;
grant execute on function public.outreach_import(jsonb) to service_role;
commit;
