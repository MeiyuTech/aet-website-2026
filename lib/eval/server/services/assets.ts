import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { signatureFiles } from "../../assets";
import { EvalError } from "../errors";
export async function reportAsset(id: string) {
  if (![...signatureFiles, "AET-seal.jpg", "AET-watermark.png"].includes(id))
    throw new EvalError("Not found", 404);
  const bytes = await readFile(path.join(process.cwd(), "lib/eval/assets", id));
  return { bytes, mime: id.endsWith(".jpg") ? "image/jpeg" : "image/png" };
}
