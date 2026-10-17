import "server-only";
import type { Part } from "@google/genai";
import type { z } from "zod";
import type { AssistantSchema } from "../../domain/schemas";
import { EvalError } from "../errors";
import { EVAL_BUCKET } from "../config";
import { attachmentPath, storageFetch, objectUrl, proxyUrl } from "../storage";
import {
  listChat,
  conversationContext,
  appendConversation,
} from "../repositories/chat";
import { getReport } from "./reports";
import { assistReport } from "./proposals";
export async function chatHistory(id: string) {
  await getReport(id);
  const rows = await listChat(id);
  return rows
    .reverse()
    .map((row) => ({
      ...row,
      image_urls: row.image_urls?.map(proxyUrl).filter(Boolean) || [],
    }));
}
export async function askAssistant(input: z.infer<typeof AssistantSchema>) {
  await getReport(input.reportId);
  const history = await conversationContext(input.reportId);
  const images: Part[] = [];
  for (const value of input.imagePaths) {
    const name = attachmentPath(value);
    if (!name.startsWith(input.reportId + "/"))
      throw new EvalError("Image belongs to another report.");
    const file = await storageFetch(
      `/storage/v1/object/${EVAL_BUCKET}/${name}`,
    );
    if (!file.ok) throw new EvalError("Image could not be read.");
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024)
      throw new EvalError("Image is too large.");
    images.push({
      inlineData: {
        mimeType: file.headers.get("content-type") || "image/png",
        data: Buffer.from(bytes).toString("base64"),
      },
    });
  }
  const answer = await assistReport(
    input.content,
    input.message,
    history.reverse(),
    images,
  );
  await appendConversation([
    {
      report_id: input.reportId,
      role: "user",
      content: input.message,
      image_urls: input.imagePaths.map(objectUrl),
      created_at: new Date().toISOString(),
    },
    {
      report_id: input.reportId,
      role: "assistant",
      content: answer.reply,
      image_urls: [],
      created_at: new Date(Date.now() + 1).toISOString(),
    },
  ]);
  return answer;
}
