import "server-only";
import { z } from "zod";
import { guard } from "../access";
import { EvalError } from "../errors";
import { json, jsonBody, form, errorResponse, binary } from "./responses";
import {
  ReportSchema,
  SaveSchema,
  AssistantSchema,
  uuid,
} from "../../domain/schemas";
import { getReport, reportList, history, revision } from "../services/reports";
import { saveReport, archiveReport } from "../repositories/reports";
import { listRules } from "../repositories/rules";
import { chatHistory, askAssistant } from "../services/assistant";
import { analyzePdfWithGemini } from "../services/pdf";
import { readAttachment, uploadAttachment } from "../services/attachments";
import { reportAsset } from "../services/assets";
import { exportReport } from "../services/exports";
import {
  workflowState,
  generationAction,
  approveReport,
  approvedExport,
} from "../services/generation";
import { uploadDocument, readSource } from "../services/documents";
import { documents, selectDocument } from "../repositories/generation";
export type EvalRouteContext = { params: Promise<{ path?: string[] }> };
export async function handle(request: Request, context: EvalRouteContext) {
  try {
    guard(request);
    const { path: parts = [] } = await context.params;
    const [area, id] = parts;
    const url = new URL(request.url);
    if (parts.length > 2) throw new EvalError("Not found", 404);
    if (request.method === "GET") {
      if (area === "workflow" && id) return json(await workflowState(id));
      if (area === "approved" && id)
        return binary(
          await approvedExport(id),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          {
            "Content-Disposition":
              'attachment; filename="AET-Approved-Evaluation.docx"',
          },
        );
      if (area === "source" && id) {
        uuid.parse(id);
        const reportId = uuid.parse(url.searchParams.get("reportId"));
        await getReport(reportId);
        const document = (await documents(reportId)).find(
          (doc) => doc.id === id,
        );
        if (!document) throw new EvalError("Document not found.", 404);
        return binary(await readSource(document), document.mime, {
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
          "Content-Security-Policy": "default-src 'none'; sandbox",
        });
      }
      if (area === "reports" && !id)
        return json(
          await reportList(
            z.coerce
              .number()
              .int()
              .min(0)
              .max(100000)
              .parse(url.searchParams.get("offset") || 0),
          ),
        );
      if (area === "reports" && id) return json(await getReport(id));
      if (area === "history" && id)
        return json(
          await history(
            id,
            z.coerce
              .number()
              .int()
              .min(0)
              .parse(url.searchParams.get("offset") || 0),
          ),
        );
      if (area === "revision" && id) return json(await revision(id));
      if (area === "chat" && id) return json(await chatHistory(id));
      if (area === "rules") return json(await listRules());
      if (area === "assets" && id) {
        const asset = await reportAsset(id);
        return binary(asset.bytes, asset.mime);
      }
      if (area === "attachments") {
        const image = await readAttachment(url.searchParams.get("path") || "");
        return binary(image.bytes, image.mime, {
          "Content-Security-Policy": "default-src 'none'; sandbox",
        });
      }
    }
    if (request.method === "POST") {
      if (area === "generation" && id)
        return json(await generationAction(id, await jsonBody(request)));
      if (area === "approval" && id)
        return json(await approveReport(id, await jsonBody(request)));
      if (area === "documents" && id) {
        uuid.parse(id);
        const { file, bytes } = await form(request, 20 * 1024 * 1024);
        return json(await uploadDocument(id, file, bytes));
      }
      if (area === "reports" && !id)
        return json(
          await saveReport(SaveSchema.parse(await jsonBody(request))),
        );
      if (area === "export")
        return binary(
          await exportReport(ReportSchema.parse(await jsonBody(request))),
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          {
            "Content-Disposition": 'attachment; filename="AET-Evaluation.docx"',
          },
        );
      if (area === "parse") {
        const { bytes } = await form(request, 20 * 1024 * 1024);
        if (bytes.subarray(0, 5).toString() !== "%PDF-")
          throw new EvalError("Please choose a PDF document.");
        return json(
          await analyzePdfWithGemini(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ) as ArrayBuffer,
          ),
        );
      }
      if (area === "attachments") {
        const reportId = uuid.parse(url.searchParams.get("reportId"));
        await getReport(reportId);
        const { file, bytes } = await form(request, 5 * 1024 * 1024);
        return json(await uploadAttachment(reportId, file, bytes));
      }
      if (area === "ai")
        return json(
          await askAssistant(AssistantSchema.parse(await jsonBody(request))),
        );
    }
    if (request.method === "PATCH" && area === "documents" && id) {
      await getReport(id);
      const input = z
        .object({ id: uuid, excluded: z.boolean() })
        .parse(await jsonBody(request));
      await selectDocument(id, input.id, input.excluded);
      return json({ ok: true });
    }
    if (request.method === "PATCH" && area === "reports" && id) {
      uuid.parse(id);
      const input = z
        .object({
          expectedUpdatedAt: z.string().datetime({ offset: true }),
          archived: z.boolean(),
        })
        .parse(await jsonBody(request));
      return json(
        await archiveReport(id, input.expectedUpdatedAt, input.archived),
      );
    }
    throw new EvalError("Not found", 404);
  } catch (error) {
    return errorResponse(error);
  }
}
