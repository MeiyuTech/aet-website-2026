import "server-only";
import { db } from "../database";
import type {
  SourceDocument,
  GenerationRun,
  Approval,
  GenerationResult,
  Extraction,
} from "../../domain/generation";
import type { SavedReport } from "../../domain/records";
const rpc = <T>(name: string, input: unknown) =>
  db<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(input) });
export const documents = (id: string) =>
  db<SourceDocument[]>(
    `aet_eval_documents?report_id=eq.${id}&order=created_at.asc,id.asc`,
  );
export const materialRevision = async (id: string) =>
  (
    await db<Array<{ revision: number }>>(
      `aet_eval_materials?report_id=eq.${id}&select=revision`,
    )
  )[0]?.revision || 0;
export const runs = (id: string) =>
  db<GenerationRun[]>(
    `aet_eval_runs?report_id=eq.${id}&order=created_at.desc&limit=5`,
  );
export const findRun = async (id: string) =>
  (await db<GenerationRun[]>(`aet_eval_runs?id=eq.${id}`))[0];
export const latestApproval = async (id: string) =>
  (
    await db<Approval[]>(
      `aet_eval_approvals?report_id=eq.${id}&order=created_at.desc&limit=1`,
    )
  )[0] || null;
export const registerDocument = (reportId: string, document: unknown) =>
  rpc<SourceDocument>("aet_eval_register_document", {
    p_report_id: reportId,
    p_document: document,
  });
export const selectDocument = (
  reportId: string,
  id: string,
  excluded: boolean,
) =>
  rpc<void>("aet_eval_select_document", {
    p_report_id: reportId,
    p_id: id,
    p_excluded: excluded,
  });
export const enqueue = (args: Record<string, unknown>) =>
  rpc<GenerationRun>("aet_eval_enqueue", args);
export const claim = (id: string | null = null) =>
  rpc<GenerationRun | null>("aet_eval_claim", { p_id: id });
export const checkpoint = (
  run: GenerationRun,
  step: string,
  options: {
    checkpoints?: Record<string, Extraction>;
    result?: GenerationResult;
    status?: string;
    error?: string;
    spend?: boolean;
  } = {},
) =>
  rpc<GenerationRun>("aet_eval_checkpoint", {
    p_id: run.id,
    p_token: run.lease_token,
    p_step: step,
    p_checkpoints: options.checkpoints ?? null,
    p_result: options.result ?? null,
    p_status: options.status || "running",
    p_error: options.error ?? null,
    p_spend: options.spend || false,
  });
export const controlRun = (reportId: string, id: string, action: string) =>
  rpc<GenerationRun>("aet_eval_control_run", {
    p_report_id: reportId,
    p_id: id,
    p_action: action,
  });
export const applyDraft = (
  reportId: string,
  id: string,
  stamp: string,
  automatic = false,
) =>
  rpc<SavedReport>("aet_eval_apply_draft", {
    p_report_id: reportId,
    p_id: id,
    p_expected_updated_at: stamp,
    p_automatic: automatic,
  });
export const approve = (
  reportId: string,
  id: string,
  stamp: string,
  reviewer: string,
  notes: string,
  ack: string[],
) =>
  rpc<Approval>("aet_eval_approve", {
    p_report_id: reportId,
    p_id: id,
    p_expected_updated_at: stamp,
    p_reviewer: reviewer,
    p_notes: notes,
    p_acknowledged: ack,
  });
