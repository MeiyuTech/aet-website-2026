import "server-only";
import { z } from "zod";
import { uuid } from "../../domain/schemas";
import { isEmptyReport, type WorkflowState } from "../../domain/generation";
import {
  courseByCourseTemplate,
  requiredReviewFields,
} from "../../templates/course-by-course";
import { openaiReady, openaiModel } from "../models/openai";
import * as repo from "../repositories/generation";
import { listRules } from "../repositories/rules";
import { getReport } from "./reports";
import { digest } from "./documents";
import { exportReport } from "./exports";
import { EvalError } from "../errors";
const stamp = z.string().datetime({ offset: true });
export async function workflowState(id: string): Promise<WorkflowState> {
  const report = await getReport(id);
  const [documents, revision, runs, approval] = await Promise.all([
    repo.documents(id),
    repo.materialRevision(id),
    repo.runs(id),
    repo.latestApproval(id),
  ]);
  const approvalCurrent =
    !!approval &&
    approval.report_updated_at === report.updated_at &&
    approval.material_revision === revision &&
    runs[0]?.id === approval.run_id;
  return {
    documents,
    revision,
    runs: runs.map((run) => ({ ...run, lease_token: null, checkpoints: {} })),
    approval,
    approvalCurrent,
    providerReady: openaiReady(),
    model: openaiModel(),
  };
}
export async function generationAction(id: string, body: unknown) {
  const input = z
    .object({
      action: z.enum(["confirm", "cancel", "retry", "apply"]),
      id: uuid,
      expectedUpdatedAt: stamp.optional(),
      revision: z.number().int().nonnegative().optional(),
      confirmed: z.boolean().optional(),
    })
    .parse(body);
  const report = await getReport(id);
  if (input.action === "confirm") {
    if (
      !input.confirmed ||
      input.revision === undefined ||
      !input.expectedUpdatedAt
    )
      throw new EvalError(
        "Confirm that all source files have finished uploading.",
      );
    if (!openaiReady())
      throw new EvalError(
        "Configure the OpenAI API key before generation.",
        503,
      );
    const catalog = await listRules();
    const run = await repo.enqueue({
      p_report_id: id,
      p_id: input.id,
      p_revision: input.revision,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_template: courseByCourseTemplate,
      p_rules: {
        version: digest(JSON.stringify(catalog)),
        status: "unreviewed",
        catalog,
      },
      p_model: openaiModel(),
      p_auto_apply: isEmptyReport(report.content),
    });
    return { id: run.id };
  }
  if (input.action === "apply") {
    if (!input.confirmed || !input.expectedUpdatedAt)
      throw new EvalError("Review the differences before applying this draft.");
    return repo.applyDraft(id, input.id, input.expectedUpdatedAt);
  }
  await repo.controlRun(id, input.id, input.action);
  return { ok: true };
}
export async function approveReport(id: string, body: unknown) {
  const input = z
    .object({
      runId: uuid,
      expectedUpdatedAt: stamp,
      reviewer: z.string().trim().min(2).max(120),
      notes: z.string().trim().max(5000),
      acknowledgedIssues: z.array(z.string().max(100)).max(1000),
      confirmed: z.literal(true),
    })
    .parse(body);
  const report = await getReport(id),
    run = await repo.findRun(input.runId);
  if (!run || run.report_id !== id || !run.result)
    throw new EvalError("Generation run not found.", 404);
  const missing = requiredReviewFields(report.content);
  if (missing.length) throw new EvalError(missing.join(" "));
  if (
    run.result.issues.some(
      (issue) => !input.acknowledgedIssues.includes(issue.id),
    ) ||
    !input.notes.trim()
  )
    throw new EvalError(
      "Resolve or acknowledge every review item and record your review notes.",
    );
  return repo.approve(
    id,
    run.id,
    input.expectedUpdatedAt,
    input.reviewer,
    input.notes,
    input.acknowledgedIssues,
  );
}
export async function approvedExport(id: string) {
  const state = await workflowState(id);
  if (!state.approvalCurrent || !state.approval)
    throw new EvalError(
      "This report needs a current human approval before official export.",
      409,
    );
  return exportReport(state.approval.content, true);
}
