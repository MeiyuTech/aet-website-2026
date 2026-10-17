import "server-only";
import { z } from "zod";
import { EvalError } from "../errors";
export async function bodyBytes(request: Request, max: number) {
  if (Number(request.headers.get("content-length") || 0) > max)
    throw new EvalError("File or request is too large.", 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader)
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel();
        throw new EvalError("File or request is too large.", 413);
      }
      chunks.push(value);
    }
  return Buffer.concat(chunks);
}
export async function jsonBody(request: Request) {
  try {
    return JSON.parse(
      (await bodyBytes(request, 2 * 1024 * 1024)).toString("utf8"),
    ) as unknown;
  } catch (error) {
    if (error instanceof EvalError) throw error;
    throw new EvalError("Invalid JSON.");
  }
}
export const responseHeaders = {
  "Cache-Control": "no-store, private",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
};

export const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: responseHeaders });

export async function form(request: Request, max: number) {
  const bytes = await bodyBytes(request, max + 100000);
  const data = await new Response(bytes, {
    headers: { "Content-Type": request.headers.get("content-type") || "" },
  }).formData();
  const file = data.get("file");
  if (!(file instanceof File) || !file.size || file.size > max)
    throw new EvalError("Choose a file within the upload limit.", 400);
  return { file, bytes: Buffer.from(await file.arrayBuffer()) };
}

export function errorResponse(error: unknown) {
  if (error instanceof EvalError)
    return json({ error: error.message }, error.status);
  if (error instanceof z.ZodError)
    return json(
      {
        error: "Please check the report fields and try again.",
        fields: error.issues.map((i) => i.path.join(".")).slice(0, 8),
      },
      400,
    );
  return json(
    {
      error:
        "The request could not be completed. Your draft is still available.",
    },
    500,
  );
}

export function binary(
  bytes: ArrayBuffer | Uint8Array,
  mime: string,
  extra: Record<string, string> = {},
) {
  return new Response(
    bytes instanceof Uint8Array ? new Uint8Array(bytes) : bytes,
    { headers: { ...responseHeaders, "Content-Type": mime, ...extra } },
  );
}
