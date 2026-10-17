-- Run against the Eval development database. All fixture writes are rolled back.
begin;
do $$
declare rid uuid:=gen_random_uuid(); did uuid:=gen_random_uuid(); jid uuid:=gen_random_uuid();
 r public.aet_fce_aice_report; j public.aet_eval_runs; c public.aet_eval_runs; a public.aet_eval_approvals;
 original_token uuid;
begin
 insert into public.aet_fce_aice_report(id,name,content) values(rid,'[QA] Transaction rollback fixture','{"name":""}') returning * into r;
 perform public.aet_eval_register_document(rid,jsonb_build_object('id',did,'name','Synthetic.pdf','mime','application/pdf','size',10,'sha256',repeat('a',64),'storage_path',rid||'/'||did||'.pdf'));
 perform public.aet_eval_register_document(rid,jsonb_build_object('id',gen_random_uuid(),'name','Duplicate.pdf','mime','application/pdf','size',10,'sha256',repeat('a',64),'storage_path','unused'));
 if (select revision from public.aet_eval_materials where report_id=rid)<>1 then raise exception 'Duplicate upload changed revision'; end if;
 j:=public.aet_eval_enqueue(rid,jid,1,r.updated_at,'{"id":"test","version":"1"}','{"status":"unreviewed"}','test',true);
 c:=public.aet_eval_enqueue(rid,jid,1,r.updated_at,'{}','{}','test',true);
 if c.id<>j.id then raise exception 'Enqueue not idempotent'; end if;
 begin
  perform public.aet_eval_enqueue(rid,gen_random_uuid(),1,r.updated_at,'{}','{}','test',true);
  raise exception 'Concurrent active run was allowed';
 exception when raise_exception then if sqlerrm<>'EVAL_ACTIVE_RUN' then raise; end if;end;
 j:=public.aet_eval_claim(jid); original_token:=j.lease_token;
 c:=public.aet_eval_claim(jid);if c.id is not null then raise exception 'Active lease claimed twice';end if;
 perform public.aet_eval_control_run(rid,jid,'cancel');
 begin
  perform public.aet_eval_checkpoint(jid,original_token,'stale','{}',null,'running',null,false);
  raise exception 'Cancelled worker was allowed to write';
 exception when raise_exception then if sqlerrm<>'EVAL_LEASE_LOST' then raise; end if;end;
 perform public.aet_eval_control_run(rid,jid,'retry');j:=public.aet_eval_claim(jid);
 j:=public.aet_eval_checkpoint(jid,j.lease_token,'done',null,'{"draft":{"name":"Synthetic"},"issues":[]}','needs_review',null,true);
 -- A competing edit must prevent the automatic replacement.
 update public.aet_fce_aice_report set content='{"name":"Human edit"}' where id=rid;
 begin
  perform public.aet_eval_apply_draft(rid,jid,r.updated_at,true);
  raise exception 'Human edit overwritten';
 exception when raise_exception then if sqlerrm<>'EVAL_CONFLICT' then raise; end if;end;
 select * into r from public.aet_fce_aice_report where id=rid;
 r:=public.aet_eval_apply_draft(rid,jid,r.updated_at,false);
 a:=public.aet_eval_approve(rid,jid,r.updated_at,'Synthetic QA','Test only','[]');
 if a.content<>r.content or a.reviewer_mode<>'local_unverified' then raise exception 'Approval snapshot mismatch';end if;
 perform public.aet_eval_select_document(rid,did,true);
 begin
  perform public.aet_eval_approve(rid,jid,r.updated_at,'Synthetic QA','Test only','[]');
  raise exception 'Changed material set approved';
 exception when raise_exception then if sqlerrm<>'EVAL_MATERIALS_CHANGED' then raise;end if;end;
 if has_table_privilege('anon','public.aet_eval_runs','select') or has_function_privilege('authenticated','public.aet_eval_claim(uuid)','execute') then raise exception 'Browser role has workflow access';end if;
end $$;
rollback;
