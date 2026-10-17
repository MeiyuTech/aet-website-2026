import { z } from "zod";
import type { SampleData } from "./report";
const text = z.string().max(30000);
const short = z.string().max(1000);
export const SourceCourseSchema = z.object({
  year: short,
  name: text,
  level: short,
  credits: short,
  grade: short,
  page: z.number().int().min(1),
  quote: text,
});
export const SourceCredentialSchema = z.object({
  awardingInstitution: text,
  country: short,
  program: text,
  creditSystem: text,
  gradingScale: text,
  admissionRequirements: text,
  grantsAccessTo: text,
  standardProgramLength: short,
  yearsAttended: short,
  yearOfGraduation: short,
  courses: z.array(SourceCourseSchema).max(2000),
});
export const ExtractionSchema = z.object({
  name: short,
  dob: short,
  country: short,
  documentTitle: short,
  issuedBy: short,
  dateIssued: short,
  certificateNo: short,
  credentials: z.array(SourceCredentialSchema).max(30),
  evidence: z
    .array(
      z.object({
        path: short,
        value: text,
        page: z.number().int().min(1),
        quote: text,
      }),
    )
    .max(2000),
  issues: z.array(text).max(100),
});
export const SynthesisSchema = z.object({
  credentials: z
    .array(
      z.object({
        sourceIds: z.array(short).min(1),
        equivalenceStatement: text,
        creditBasis: text,
        courses: z
          .array(
            z.object({
              sourceIds: z.array(short).min(1),
              usGrade: short,
              usCredits: short,
              reason: text,
            }),
          )
          .max(2000),
      }),
    )
    .max(30),
  evaluationNotes: text,
  issues: z.array(text).max(100),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
export type Synthesis = z.infer<typeof SynthesisSchema>;
export type SourceDocument = {
  id: string;
  report_id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  storage_path: string;
  excluded: boolean;
  created_at: string;
};
export type GenerationIssue = {
  id: string;
  message: string;
  kind: "review" | "missing" | "conflict";
};
export type GenerationResult = { draft: SampleData; issues: GenerationIssue[] };
export type GenerationRun = {
  id: string;
  report_id: string;
  material_revision: number;
  materials: SourceDocument[];
  template: { id: string; version: string };
  rules: { version: string; status: "unreviewed"; catalog: unknown[] };
  model: string;
  baseline_content: SampleData;
  baseline_updated_at: string;
  auto_apply: boolean;
  status: "queued" | "running" | "needs_review" | "failed" | "cancelled";
  step: string;
  attempts: number;
  calls: number;
  lease_token: string | null;
  checkpoints: Record<string, Extraction>;
  result: GenerationResult | null;
  error: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};
export type Approval = {
  id: string;
  report_id: string;
  run_id: string;
  report_updated_at: string;
  material_revision: number;
  report_name: string;
  content: SampleData;
  reviewer: string;
  reviewer_mode: string;
  notes: string;
  created_at: string;
  template: GenerationRun["template"];
  rules: GenerationRun["rules"];
  materials: SourceDocument[];
  acknowledged_issues: string[];
};
export type WorkflowState = {
  documents: SourceDocument[];
  revision: number;
  runs: GenerationRun[];
  approval: Approval | null;
  approvalCurrent: boolean;
  providerReady: boolean;
  model: string;
};
export function draftDifferences(before: SampleData, after: SampleData) {
  return (Object.keys(after) as (keyof SampleData)[]).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}
export function isEmptyReport(data: SampleData) {
  return (
    !data.name &&
    !data.dob &&
    !data.country &&
    !data.documents.length &&
    !data.evaluationNotes &&
    !data.references &&
    !data.evaluatorName &&
    !data.evaluatorSignature &&
    !data.seniorEvaluatorName &&
    !data.seniorEvaluatorSignature &&
    data.credentials.every(
      (c) =>
        !c.awardingInstitution &&
        !c.program &&
        !c.equivalenceStatement &&
        !c.country &&
        !c.admissionRequirements &&
        !c.grantsAccessTo &&
        !c.standardProgramLength &&
        !c.yearsAttended &&
        !c.yearOfGraduation &&
        !c.courseTableNotes &&
        !c.gradeConversion.length &&
        !c.courses.length,
    )
  );
}

/** Field-level review rows omit internal IDs and separately presented evidence. */
export function differenceRows(
  before: unknown,
  after: unknown,
  prefix = "",
): Array<{ label: string; before: string; after: string }> {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    (before && typeof before === "object") ||
    (after && typeof after === "object")
  ) {
    const a = (before || {}) as Record<string, unknown>,
      b = (after || {}) as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .filter((key) => !["id", "evidence"].includes(key))
      .flatMap((key) => {
        const label = /^\d+$/.test(key)
          ? `${Number(key) + 1}`
          : key
              .replace(/([A-Z])/g, " $1")
              .replace(/^us /, "US ")
              .replace(/^gpa$/, "GPA");
        return differenceRows(
          a[key],
          b[key],
          prefix ? `${prefix} / ${label}` : label,
        );
      });
  }
  return [
    {
      label: prefix,
      before: before == null || before === "" ? "Not provided" : String(before),
      after: after == null || after === "" ? "Not provided" : String(after),
    },
  ];
}
export const reportSectionLabels: Record<string, string> = {
  name: "Applicant name",
  dob: "Date of birth",
  country: "Country of education",
  date: "Evaluation date",
  refNo: "Evaluation ID",
  purpose: "Purpose",
  documents: "Documents",
  credentials: "Credentials and courses",
  evaluationNotes: "Evaluation notes",
  references: "References",
  evaluatorName: "Evaluator name",
  evaluatorSignature: "Evaluator signature",
  seniorEvaluatorName: "Senior evaluator name",
  seniorEvaluatorSignature: "Senior evaluator signature",
  evidence: "Source evidence",
};
