import "server-only";
import { randomUUID } from "node:crypto";
import { EVAL_BUCKET } from "../config";
import { EvalError } from "../errors";
import { attachmentPath, storageFetch, proxyUrl, objectUrl } from "../storage";
export async function readAttachment(value: string) {
  const name = attachmentPath(value);
  const res = await storageFetch(`/storage/v1/object/${EVAL_BUCKET}/${name}`);
  if (!res.ok) throw new EvalError("Attachment not found", 404);
  const mime = res.headers.get("content-type") || "";
  if (!/^image\/(png|jpeg|webp)/.test(mime))
    throw new EvalError("Unsupported attachment type", 415);
  return { bytes: await res.arrayBuffer(), mime };
}
export async function uploadAttachment(
  reportId: string,
  file: File,
  bytes: Buffer,
) {
  const mime = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      ? "image/jpeg"
      : bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP"
        ? "image/webp"
        : null;
  if (!mime || mime !== file.type)
    throw new EvalError("Choose a PNG, JPEG, or WebP image.");
  const name = `${reportId}/${randomUUID()}.${mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "webp"}`;
  const result = await storageFetch(
    `/storage/v1/object/${EVAL_BUCKET}/${name}`,
    {
      method: "POST",
      body: new Uint8Array(bytes),
      headers: { "Content-Type": mime, "x-upsert": "false" },
    },
  );
  if (!result.ok) throw new EvalError("Image upload failed.", 502);
  return { path: name, url: proxyUrl(objectUrl(name)) };
}
