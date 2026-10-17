import { emptyCredential, type SampleData, type EvidenceItem } from "./report";
import { calculateStats } from "./gpa";
import type {
  Extraction,
  Synthesis,
  SourceDocument,
  GenerationResult,
} from "./generation";
import { requiredReviewFields } from "../templates/course-by-course";
export function sourceCatalog(
  documents: SourceDocument[],
  extracted: Record<string, Extraction>,
) {
  return documents.flatMap((doc) =>
    extracted[doc.id].credentials.map((credential, index) => ({
      id: `${doc.id}:credential:${index}`,
      documentId: doc.id,
      ...credential,
      courses: credential.courses.map((course, i) => ({
        ...course,
        id: `${doc.id}:credential:${index}:course:${i}`,
      })),
    })),
  );
}
export function assembleGeneration(
  baseline: SampleData,
  documents: SourceDocument[],
  extracted: Record<string, Extraction>,
  synthesis: Synthesis,
): GenerationResult {
  const catalog = sourceCatalog(documents, extracted),
    usedCredentials = new Set<string>(),
    usedCourses = new Set<string>();
  const evidence: EvidenceItem[] = [];
  const messages: string[] = [
    "AI-proposed equivalencies and US conversions require evaluator verification. The reference catalog has not been approved.",
    ...synthesis.issues,
  ];
  const fact = (key: "name" | "dob" | "country") => {
    const values = documents
      .map((doc) => extracted[doc.id][key])
      .filter((v) => v.trim());
    if (new Set(values.map((v) => v.trim().toLowerCase())).size > 1)
      messages.push(
        `Conflicting ${key} values across source documents. Compare the originals.`,
      );
    return values[0] || "";
  };
  const credentials = synthesis.credentials.map((proposal, index) => {
    const originals = proposal.sourceIds.map((id) => {
      const source = catalog.find((c) => c.id === id);
      if (!source || usedCredentials.has(id))
        throw new Error(
          "The draft contains unknown or repeated source credentials.",
        );
      usedCredentials.add(id);
      return source;
    });
    const first = originals[0];
    for (const other of originals.slice(1))
      for (const key of [
        "awardingInstitution",
        "program",
        "country",
        "yearOfGraduation",
      ] as const) {
        if (first[key] !== other[key])
          messages.push(
            `Credential ${index + 1}: conflicting ${key} across merged documents.`,
          );
      }
    const courses = proposal.courses.map((conversion, i) => {
      const rows = conversion.sourceIds.map((id) => {
        const source = originals
          .flatMap((c) =>
            c.courses.map((course) => ({ course, documentId: c.documentId })),
          )
          .find((c) => c.course.id === id);
        if (!source || usedCourses.has(id))
          throw new Error(
            "The draft contains unknown or repeated source courses.",
          );
        usedCourses.add(id);
        return source;
      });
      const raw = rows[0].course;
      if (
        rows.some(({ course }) =>
          ["name", "year", "level", "credits", "grade"].some(
            (key) =>
              course[key as keyof typeof course] !==
              raw[key as keyof typeof raw],
          ),
        )
      )
        throw new Error(
          "Conflicting source courses cannot be merged. Review the source files.",
        );
      evidence.push({
        id: `course-${index}-${i}`,
        path: `credentials.${index}.courses.${i}`,
        label: raw.name,
        value: `${raw.grade} / ${raw.credits}`,
        confidence: "low",
        source: "AI_INFERRED",
        notes: conversion.reason,
        refs: rows.map((row) => ({
          docId: row.documentId,
          page: row.course.page,
          quote: row.course.quote,
          method: "ai" as const,
        })),
      });
      return {
        id: i + 1,
        year: raw.year,
        name: raw.name,
        level: raw.level,
        credits: raw.credits,
        grade: raw.grade,
        usGrade: conversion.usGrade,
        usCredits: conversion.usCredits,
        conversionSource: "AI_INFERRED",
      };
    });
    return {
      ...emptyCredential(index + 1),
      awardingInstitution: first.awardingInstitution,
      country: first.country,
      program: first.program,
      admissionRequirements: first.admissionRequirements,
      grantsAccessTo: first.grantsAccessTo,
      standardProgramLength: first.standardProgramLength,
      yearsAttended: first.yearsAttended,
      yearOfGraduation: first.yearOfGraduation,
      equivalenceStatement: proposal.equivalenceStatement,
      courseTableNotes: proposal.creditBasis,
      gradeConversion: [
        ...new Map(
          courses
            .filter((c) => c.usGrade)
            .map((c) => [
              `${c.grade}::${c.usGrade}`,
              { grade: c.grade, usGrade: c.usGrade },
            ]),
        ).values(),
      ],
      courses,
      ...calculateStats(courses),
    };
  });
  if (
    usedCredentials.size !== catalog.length ||
    usedCourses.size !== catalog.reduce((n, c) => n + c.courses.length, 0)
  )
    throw new Error(
      "The generated draft omitted source credentials or courses. No report was replaced.",
    );
  for (const doc of documents) {
    const extraction = extracted[doc.id];
    messages.push(...extraction.issues.map((issue) => `${doc.name}: ${issue}`));
    for (const [i, item] of extraction.evidence.entries())
      evidence.push({
        id: `${doc.id}-${i}`,
        path: `source.${doc.id}.${item.path}`,
        label: item.path,
        value: item.value,
        confidence: "low",
        source: "AI_INFERRED",
        refs: [
          { docId: doc.id, page: item.page, quote: item.quote, method: "ai" },
        ],
      });
  }
  const draft: SampleData = {
    ...baseline,
    name: fact("name"),
    dob: fact("dob"),
    country: fact("country"),
    documents: documents.map((doc) => {
      const e = extracted[doc.id];
      return {
        title: e.documentTitle || doc.name,
        issuedBy: e.issuedBy,
        dateIssued: e.dateIssued,
        certificateNo: e.certificateNo,
      };
    }),
    credentials,
    evaluationNotes: synthesis.evaluationNotes,
    evidence,
    evaluatorName: "",
    evaluatorSignature: "",
    seniorEvaluatorName: "",
    seniorEvaluatorSignature: "",
  };
  const issues = [...new Set(messages)].map((message, i) => ({
    id: `review-${i}`,
    message,
    kind: "review" as const,
  }));
  issues.push(
    ...requiredReviewFields(draft).map((message, i) => ({
      id: `missing-${i}`,
      message,
      kind: "review" as const,
    })),
  );
  return { draft, issues };
}
