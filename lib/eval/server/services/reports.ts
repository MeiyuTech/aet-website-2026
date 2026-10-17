import "server-only";
import { uuid } from "../../domain/schemas";
import { EvalError } from "../errors";
import * as reports from "../repositories/reports";
export async function getReport(id: string) {
  uuid.parse(id);
  const rows = await reports.findReport(id);
  if (!rows[0]) throw new EvalError("Report not found.", 404);
  return rows[0];
}
export async function reportList(offset: number) {
  const rows = await reports.listReports(offset);
  return { reports: rows.slice(0, 100), hasMore: rows.length > 100 };
}
export async function history(id: string, offset: number) {
  await getReport(id);
  return reports.listHistory(id, offset);
}
export async function revision(id: string) {
  uuid.parse(id);
  const rows = await reports.findRevision(id);
  if (!rows[0]) throw new EvalError("Version not found", 404);
  return rows[0];
}
