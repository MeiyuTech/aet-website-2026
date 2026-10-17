import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SourceDocument } from "../../domain/generation";
import { storageFetch } from "../transport";
import { EvalError } from "../errors";
import { getReport } from "./reports";
import {
  documents,
  registerDocument,
  selectDocument,
} from "../repositories/generation";
export const DOCUMENT_BUCKET = "aet-eval-documents";
export const digest = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
function detectedMime(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  throw new EvalError("Choose PDF, PNG, JPEG or WebP files.");
}
export async function uploadDocument(
  reportId: string,
  file: File,
  bytes: Buffer,
) {
  await getReport(reportId);
  if (!bytes.length || bytes.length > 20 * 1024 * 1024)
    throw new EvalError("Choose files up to 20 MB each.");
  const mime = detectedMime(bytes);
  if (file.type && file.type !== mime)
    throw new EvalError("The file type does not match its contents.");
  const previous = await documents(reportId);
  const sha256 = digest(bytes);
  const duplicate = previous.find((d) => d.sha256 === sha256);
  if (duplicate) {
    if (duplicate.excluded) await selectDocument(reportId, duplicate.id, false);
    return { ...duplicate, excluded: false };
  }
  if (previous.filter((d) => !d.excluded).length >= 8)
    throw new EvalError("Upload up to 8 files per material set.");
  const id = randomUUID();
  const storage_path = `${reportId}/${id}.${mime === "application/pdf" ? "pdf" : mime === "image/jpeg" ? "jpg" : mime.split("/")[1]}`;
  const response = await storageFetch(
    `/storage/v1/object/${DOCUMENT_BUCKET}/${storage_path}`,
    {
      method: "POST",
      body: new Uint8Array(bytes),
      headers: { "Content-Type": mime, "x-upsert": "false" },
    },
  );
  if (!response.ok)
    throw new EvalError("The file could not be stored. Please retry.", 502);
  return registerDocument(reportId, {
    id,
    name: file.name.replace(/[\/\\\r\n]/g, "_").slice(0, 180),
    mime,
    size: bytes.length,
    sha256,
    storage_path,
  });
}
export async function readSource(document: SourceDocument) {
  if (
    !document.storage_path.startsWith(document.report_id + "/") ||
    document.storage_path.includes("..")
  )
    throw new EvalError("Invalid document path.");
  const response = await storageFetch(
    `/storage/v1/object/${DOCUMENT_BUCKET}/${document.storage_path}`,
  );
  if (!response.ok)
    throw new EvalError("The source file could not be read.", 502);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== document.size || digest(bytes) !== document.sha256)
    throw new EvalError(
      "Source file integrity check failed. Upload the source again.",
      409,
    );
  return bytes;
}
