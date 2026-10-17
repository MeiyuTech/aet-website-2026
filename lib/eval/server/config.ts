import "server-only";
import { EvalError } from "./errors";
export const EVAL_PROJECT = "qrxztgdemfodemlcabcq";
export const EVAL_BUCKET = "aet-eval-attachments";
export function supabaseConfig() {
  const url = process.env.EVAL_SUPABASE_URL;
  const key = process.env.EVAL_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url !== `https://${EVAL_PROJECT}.supabase.co`)
    throw new EvalError("Evaluation storage is not configured.", 503);
  return { url, key };
}
