import type { SampleData } from "../domain/report";
export const courseByCourseTemplate = {
  id: "aet-course-by-course",
  version: "2026.1",
  name: "Course-by-course evaluation",
  description:
    "AET US Letter report with source documents, credential details, proposed US equivalencies and course conversions.",
} as const;
export function requiredReviewFields(data: SampleData): string[] {
  const missing: string[] = [];
  if (!data.name.trim()) missing.push("Applicant name is required.");
  if (!data.country.trim()) missing.push("Country of education is required.");
  if (!data.documents.length)
    missing.push("At least one source document must be listed.");
  if (!data.credentials.length)
    missing.push("At least one credential is required.");
  for (const [i, c] of data.credentials.entries()) {
    if (!c.awardingInstitution.trim())
      missing.push(`Credential ${i + 1}: awarding institution is required.`);
    if (!c.program.trim())
      missing.push(`Credential ${i + 1}: program is required.`);
    if (!c.equivalenceStatement.trim())
      missing.push(
        `Credential ${i + 1}: the evaluator must confirm an equivalency.`,
      );
    if (!c.courses.length)
      missing.push(
        `Credential ${i + 1}: course-by-course evaluation requires courses.`,
      );
    if (
      c.courses.some(
        (row) =>
          !row.name.trim() ||
          !/^(A[+-]?|B[+-]?|C[+-]?|D[+-]?|F|WF|P|PASS|CR|CREDIT|T|WITHDRAWAL|F\/WITHDRAWAL)$/i.test(
            row.usGrade?.trim() || "",
          ) ||
          !row.usCredits?.trim() ||
          !Number.isFinite(
            Number(row.usCredits?.trim().replace(/^\((.*)\)$/, "$1")),
          ) ||
          Number(row.usCredits?.trim().replace(/^\((.*)\)$/, "$1")) < 0,
      )
    )
      missing.push(
        `Credential ${i + 1}: review missing or invalid US grades/credits.`,
      );
  }
  return missing;
}
