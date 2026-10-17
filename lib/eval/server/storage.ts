import "server-only";
import { EvalError } from "./errors";
import { EVAL_PROJECT, EVAL_BUCKET } from "./config";
export { storageFetch } from "./transport";
export const attachmentPath = (value: string) => {
  if (!/^[a-f0-9-]{36}\/[a-zA-Z0-9_.-]+$/.test(value) || value.includes(".."))
    throw new EvalError("Invalid attachment path");
  return value;
};
export const objectUrl = (name: string) =>
  `https://${EVAL_PROJECT}.supabase.co/storage/v1/object/authenticated/${EVAL_BUCKET}/${name}`;
export const proxyUrl = (value: string) => {
  const prefix = `https://${EVAL_PROJECT}.supabase.co/storage/v1/object/authenticated/${EVAL_BUCKET}/`;
  return value.startsWith(prefix)
    ? `/api/admin/eval/attachments?path=${encodeURIComponent(attachmentPath(value.slice(prefix.length)))}`
    : "";
};
