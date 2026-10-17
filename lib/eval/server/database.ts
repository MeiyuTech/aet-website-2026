import "server-only";
import { storageFetch } from "./transport";
import { EvalError } from "./errors";
export async function db<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await storageFetch(`/rest/v1/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    if (failure.message === "EVAL_CONFLICT")
      throw new EvalError(
        "This report changed in another window. Reload before saving; your draft has been kept.",
        409,
      );
    if (failure.message === "EVAL_NOT_FOUND")
      throw new EvalError("Report not found.", 404);
    const workflowErrors: Record<string, string> = {
      EVAL_MATERIAL_LIMIT: "A material set can contain up to 8 files.",
      EVAL_NO_MATERIALS: "Upload source files before confirming.",
      EVAL_ACTIVE_RUN:
        "A newer or active generation exists. Refresh the workflow.",
      EVAL_MATERIALS_CHANGED:
        "The material set changed. Confirm the current files to generate again.",
      EVAL_LEASE_LOST:
        "The generation was cancelled or resumed by another worker.",
      EVAL_BUDGET:
        "This run reached its model-call limit. Review the files before starting again.",
      EVAL_INVALID_STATE:
        "This action is no longer available. Refresh the workflow.",
      EVAL_REVIEW_REQUIRED: "Human review is required before approval.",
    };
    if (workflowErrors[failure.message])
      throw new EvalError(workflowErrors[failure.message], 409);
    // Never return database details, credentials, or private report content.
    throw new EvalError(
      "The database request could not be completed. Please retry.",
      502,
    );
  }
  const body = await response.text();
  return body ? (JSON.parse(body) as T) : (undefined as T);
}
