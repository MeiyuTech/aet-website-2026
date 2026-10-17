-- Eval remains server-only. No browser role receives table or RPC access.
create table public.aet_eval_materials (
 report_id uuid primary key references public.aet_fce_aice_report(id),
 revision bigint not null default 0
);
create table public.aet_eval_documents (
 id uuid primary key, report_id uuid not null references public.aet_fce_aice_report(id),
 name text not null, mime text not null, size integer not null check(size > 0 and size <= 20971520),
 sha256 text not null check(length(sha256)=64), storage_path text not null unique,
 excluded boolean not null default false, created_at timestamptz not null default now(),
 unique(report_id,sha256)
);
create index aet_eval_documents_report on public.aet_eval_documents(report_id,created_at);
create table public.aet_eval_runs (
 id uuid primary key, report_id uuid not null references public.aet_fce_aice_report(id),
 material_revision bigint not null, materials jsonb not null,
 template jsonb not null, rules jsonb not null, model text not null,
 baseline_content jsonb not null, baseline_updated_at timestamptz not null,
 auto_apply boolean not null default false,
 status text not null default 'queued' check(status in ('queued','running','needs_review','failed','cancelled')),
 step text not null default 'Queued', attempts integer not null default 0,
 calls integer not null default 0 check(calls between 0 and 24),
 lease_token uuid, lease_until timestamptz, available_at timestamptz not null default now(),
 checkpoints jsonb not null default '{}', result jsonb, error text,
 applied_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index aet_eval_one_active_run on public.aet_eval_runs(report_id) where status in ('queued','running');
create index aet_eval_run_queue on public.aet_eval_runs(available_at,created_at) where status in ('queued','running');
create index aet_eval_run_report on public.aet_eval_runs(report_id,created_at desc);
create table public.aet_eval_approvals (
 id uuid primary key default gen_random_uuid(), report_id uuid not null references public.aet_fce_aice_report(id),
 run_id uuid not null references public.aet_eval_runs(id), report_updated_at timestamptz not null,
 material_revision bigint not null, report_name text not null, content jsonb not null,
 template jsonb not null, rules jsonb not null, materials jsonb not null,
 reviewer text not null, reviewer_mode text not null default 'local_unverified',
 notes text not null, acknowledged_issues jsonb not null, created_at timestamptz not null default now()
);
create index aet_eval_approval_report on public.aet_eval_approvals(report_id,created_at desc);
alter table public.aet_eval_materials enable row level security;
alter table public.aet_eval_documents enable row level security;
alter table public.aet_eval_runs enable row level security;
alter table public.aet_eval_approvals enable row level security;
revoke all on public.aet_eval_materials,public.aet_eval_documents,public.aet_eval_runs,public.aet_eval_approvals from public,anon,authenticated;
grant select,insert,update on public.aet_eval_materials,public.aet_eval_documents,public.aet_eval_runs to service_role;
grant select,insert on public.aet_eval_approvals to service_role;

create function public.aet_eval_register_document(p_report_id uuid,p_document jsonb)
returns public.aet_eval_documents language plpgsql security invoker set search_path='' as $$
declare d public.aet_eval_documents;
begin
 perform 1 from public.aet_fce_aice_report where id=p_report_id for update;
 if not found then raise exception 'EVAL_NOT_FOUND'; end if;
 select * into d from public.aet_eval_documents where report_id=p_report_id and sha256=p_document->>'sha256';
 if found then return d; end if;
 if (select count(*) from public.aet_eval_documents where report_id=p_report_id and not excluded)>=8 then raise exception 'EVAL_MATERIAL_LIMIT'; end if;
 insert into public.aet_eval_documents(id,report_id,name,mime,size,sha256,storage_path)
 values((p_document->>'id')::uuid,p_report_id,p_document->>'name',p_document->>'mime',(p_document->>'size')::int,p_document->>'sha256',p_document->>'storage_path') returning * into d;
 insert into public.aet_eval_materials(report_id,revision) values(p_report_id,1)
 on conflict(report_id) do update set revision=aet_eval_materials.revision+1;
 return d;
end; $$;

create function public.aet_eval_select_document(p_report_id uuid,p_id uuid,p_excluded boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.aet_fce_aice_report where id=p_report_id for update;
 if not found then raise exception 'EVAL_NOT_FOUND'; end if;
 if not p_excluded and (select count(*) from public.aet_eval_documents where report_id=p_report_id and not excluded and id<>p_id)>=8 then raise exception 'EVAL_MATERIAL_LIMIT'; end if;
 update public.aet_eval_documents set excluded=p_excluded where report_id=p_report_id and id=p_id and excluded<>p_excluded;
 if found then
  insert into public.aet_eval_materials(report_id,revision) values(p_report_id,1)
  on conflict(report_id) do update set revision=aet_eval_materials.revision+1;
 end if;
end; $$;

create function public.aet_eval_enqueue(p_report_id uuid,p_id uuid,p_revision bigint,p_expected_updated_at timestamptz,p_template jsonb,p_rules jsonb,p_model text,p_auto_apply boolean)
returns public.aet_eval_runs language plpgsql security invoker set search_path='' as $$
declare r public.aet_fce_aice_report; j public.aet_eval_runs; docs jsonb; rev bigint;
begin
 select * into r from public.aet_fce_aice_report where id=p_report_id for update;
 if not found then raise exception 'EVAL_NOT_FOUND'; end if;
 select * into j from public.aet_eval_runs where id=p_id and report_id=p_report_id;
 if found then return j; end if;
 select revision into rev from public.aet_eval_materials where report_id=p_report_id;
 if rev is distinct from p_revision or r.updated_at is distinct from p_expected_updated_at then raise exception 'EVAL_CONFLICT'; end if;
 select jsonb_agg(to_jsonb(d) order by d.created_at,d.id) into docs from public.aet_eval_documents d where report_id=p_report_id and not excluded;
 if docs is null or jsonb_array_length(docs)=0 then raise exception 'EVAL_NO_MATERIALS'; end if;
 if exists(select 1 from public.aet_eval_runs where report_id=p_report_id and status in ('queued','running')) then raise exception 'EVAL_ACTIVE_RUN'; end if;
 insert into public.aet_eval_runs(id,report_id,material_revision,materials,template,rules,model,baseline_content,baseline_updated_at,auto_apply)
 values(p_id,p_report_id,p_revision,docs,p_template,p_rules,p_model,r.content,r.updated_at,p_auto_apply) returning * into j;
 return j;
end; $$;

create function public.aet_eval_claim(p_id uuid default null)
returns public.aet_eval_runs language plpgsql security invoker set search_path='' as $$
declare j public.aet_eval_runs;
begin
 update public.aet_eval_runs set status='failed',step='Stopped',error='Worker stopped repeatedly. Retry to resume completed steps.',lease_token=null,lease_until=null,updated_at=now()
 where status='running' and lease_until<now() and (attempts>=3 or calls>=24) and (p_id is null or id=p_id);
 select * into j from public.aet_eval_runs
 where (p_id is null or id=p_id) and attempts<3 and calls<24 and available_at<=now()
 and (status='queued' or (status='running' and lease_until<now()))
 order by created_at limit 1 for update skip locked;
 if not found then return null; end if;
 update public.aet_eval_runs set status='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',updated_at=now()
 where id=j.id returning * into j;
 return j;
end; $$;

create function public.aet_eval_checkpoint(p_id uuid,p_token uuid,p_step text,p_checkpoints jsonb,p_result jsonb,p_status text,p_error text,p_spend boolean default false)
returns public.aet_eval_runs language plpgsql security invoker set search_path='' as $$
declare j public.aet_eval_runs;
begin
 select * into j from public.aet_eval_runs where id=p_id for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_token or j.lease_until<now() then raise exception 'EVAL_LEASE_LOST'; end if;
 if p_status not in ('running','queued','needs_review','failed') then raise exception 'EVAL_INVALID_STATE'; end if;
 if p_spend and j.calls>=24 then raise exception 'EVAL_BUDGET'; end if;
 update public.aet_eval_runs set step=p_step,checkpoints=coalesce(p_checkpoints,checkpoints),result=coalesce(p_result,result),
 status=p_status,error=p_error,calls=calls+case when p_spend then 1 else 0 end,
 lease_until=case when p_status='running' then now()+interval '5 minutes' else null end,
 lease_token=case when p_status='running' then lease_token else null end,
 available_at=case when p_status='queued' then now()+interval '15 seconds' else available_at end,updated_at=now()
 where id=p_id returning * into j;
 return j;
end; $$;

create function public.aet_eval_control_run(p_report_id uuid,p_id uuid,p_action text)
returns public.aet_eval_runs language plpgsql security invoker set search_path='' as $$
declare j public.aet_eval_runs;
begin
 perform 1 from public.aet_fce_aice_report where id=p_report_id for update;
 select * into j from public.aet_eval_runs where id=p_id and report_id=p_report_id for update;
 if not found then raise exception 'EVAL_NOT_FOUND'; end if;
 if p_action='cancel' and j.status in ('queued','running') then
  update public.aet_eval_runs set status='cancelled',step='Cancelled',lease_token=null,lease_until=null,updated_at=now() where id=p_id returning * into j;
 elsif p_action='retry' and j.status in ('failed','cancelled') and j.calls<24 then
  if exists(select 1 from public.aet_eval_runs where report_id=p_report_id and status in ('queued','running')) then raise exception 'EVAL_ACTIVE_RUN'; end if;
  if j.material_revision is distinct from (select revision from public.aet_eval_materials where report_id=p_report_id) then raise exception 'EVAL_MATERIALS_CHANGED'; end if;
  update public.aet_eval_runs set status='queued',step='Queued for retry',attempts=0,error=null,available_at=now(),updated_at=now() where id=p_id returning * into j;
 else raise exception 'EVAL_INVALID_STATE'; end if;
 return j;
end; $$;

create function public.aet_eval_apply_draft(p_report_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_automatic boolean default false)
returns public.aet_fce_aice_report language plpgsql security invoker set search_path='' as $$
declare r public.aet_fce_aice_report; j public.aet_eval_runs;
begin
 select * into r from public.aet_fce_aice_report where id=p_report_id for update;
 select * into j from public.aet_eval_runs where id=p_id and report_id=p_report_id for update;
 if not found then raise exception 'EVAL_NOT_FOUND'; end if;
 if r.updated_at is distinct from p_expected_updated_at then raise exception 'EVAL_CONFLICT'; end if;
 if j.status<>'needs_review' or j.result is null or j.applied_at is not null then raise exception 'EVAL_INVALID_STATE'; end if;
 if j.material_revision is distinct from (select revision from public.aet_eval_materials where report_id=p_report_id) then raise exception 'EVAL_MATERIALS_CHANGED'; end if;
 if exists(select 1 from public.aet_eval_runs where report_id=p_report_id and created_at>j.created_at) then raise exception 'EVAL_ACTIVE_RUN'; end if;
 if p_automatic and (not j.auto_apply or r.content<>j.baseline_content) then raise exception 'EVAL_CONFLICT'; end if;
 update public.aet_fce_aice_report set content=j.result->'draft' where id=p_report_id returning * into r;
 insert into public.report_history(report_id,content,created_by) values(p_report_id,r.content,'AET Eval generated draft');
 update public.aet_eval_runs set applied_at=now(),updated_at=now() where id=p_id;
 return r;
end; $$;

create function public.aet_eval_approve(p_report_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_reviewer text,p_notes text,p_acknowledged jsonb)
returns public.aet_eval_approvals language plpgsql security invoker set search_path='' as $$
declare r public.aet_fce_aice_report; j public.aet_eval_runs; a public.aet_eval_approvals;
begin
 select * into r from public.aet_fce_aice_report where id=p_report_id for update;
 select * into j from public.aet_eval_runs where id=p_id and report_id=p_report_id;
 if not found then raise exception 'EVAL_NOT_FOUND'; end if;
 if r.updated_at is distinct from p_expected_updated_at then raise exception 'EVAL_CONFLICT'; end if;
 if j.status<>'needs_review' or j.applied_at is null then raise exception 'EVAL_INVALID_STATE'; end if;
 if j.material_revision is distinct from (select revision from public.aet_eval_materials where report_id=p_report_id) then raise exception 'EVAL_MATERIALS_CHANGED'; end if;
 if exists(select 1 from public.aet_eval_runs where report_id=p_report_id and (created_at>j.created_at or status in ('queued','running'))) then raise exception 'EVAL_ACTIVE_RUN'; end if;
 if length(trim(p_reviewer))<2 then raise exception 'EVAL_REVIEW_REQUIRED'; end if;
 insert into public.aet_eval_approvals(report_id,run_id,report_updated_at,material_revision,report_name,content,template,rules,materials,reviewer,notes,acknowledged_issues)
 values(p_report_id,p_id,r.updated_at,j.material_revision,r.name,r.content,j.template,j.rules,j.materials,p_reviewer,p_notes,p_acknowledged) returning * into a;
 return a;
end; $$;

revoke all on function public.aet_eval_register_document(uuid,jsonb),public.aet_eval_select_document(uuid,uuid,boolean),
 public.aet_eval_enqueue(uuid,uuid,bigint,timestamptz,jsonb,jsonb,text,boolean),public.aet_eval_claim(uuid),
 public.aet_eval_checkpoint(uuid,uuid,text,jsonb,jsonb,text,text,boolean),public.aet_eval_control_run(uuid,uuid,text),
 public.aet_eval_apply_draft(uuid,uuid,timestamptz,boolean),public.aet_eval_approve(uuid,uuid,timestamptz,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.aet_eval_register_document(uuid,jsonb),public.aet_eval_select_document(uuid,uuid,boolean),
 public.aet_eval_enqueue(uuid,uuid,bigint,timestamptz,jsonb,jsonb,text,boolean),public.aet_eval_claim(uuid),
 public.aet_eval_checkpoint(uuid,uuid,text,jsonb,jsonb,text,text,boolean),public.aet_eval_control_run(uuid,uuid,text),
 public.aet_eval_apply_draft(uuid,uuid,timestamptz,boolean),public.aet_eval_approve(uuid,uuid,timestamptz,text,text,jsonb) to service_role;
