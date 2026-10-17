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
    // Never return database details, credentials, or private report content.
    throw new EvalError(
      "The database request could not be completed. Please retry.",
      502,
    );
  }
  const body = await response.text();
  return body ? (JSON.parse(body) as T) : (undefined as T);
}
