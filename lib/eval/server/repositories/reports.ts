import "server-only";
import { db } from "../database";
import type { SavedReport, Revision } from "../../domain/records";
import type { z } from "zod";
import type { SaveSchema } from "../../domain/schemas";
export const findReport = (id: string) =>
  db<SavedReport[]>(`aet_fce_aice_report?id=eq.${id}&select=*`);
export const listReports = (offset: number) =>
  db<unknown[]>(
    `aet_fce_aice_report?select=id,name,created_at,updated_at,archived_at,applicant:content->>name,country:content->>country,ref_no:content->>refNo&order=updated_at.desc,id.asc&limit=101&offset=${offset}`,
  );
export const listHistory = (id: string, offset: number) =>
  db<Revision[]>(
    `report_history?report_id=eq.${id}&select=id,created_at,created_by&order=created_at.desc,id.desc&limit=50&offset=${offset}`,
  );
export const findRevision = (id: string) =>
  db<Revision[]>(`report_history?id=eq.${id}&select=*`);
// The existing RPC keeps the report and its new history revision atomic.
export const saveReport = (input: z.infer<typeof SaveSchema>) =>
  db<SavedReport>("rpc/aet_eval_save_report", {
    method: "POST",
    body: JSON.stringify({
      p_id: input.id,
      p_name: input.name,
      p_content: input.content,
      p_expected_updated_at: input.expectedUpdatedAt,
    }),
  });
export const archiveReport = (
  id: string,
  expectedUpdatedAt: string,
  archived: boolean,
) =>
  db<SavedReport>("rpc/aet_eval_set_archived", {
    method: "POST",
    body: JSON.stringify({
      p_id: id,
      p_expected_updated_at: expectedUpdatedAt,
      p_archived: archived,
    }),
  });
