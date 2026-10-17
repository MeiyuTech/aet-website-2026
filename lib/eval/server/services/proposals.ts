import "server-only";
import type { Part } from "@google/genai";
import { z } from "zod";
import type { SampleData } from "../../domain/report";
import { changeParts } from "../../domain/changes";
import { generate } from "../models/gemini";
import { EvalError } from "../errors";
import { safety } from "../models/instructions";
import { referenceContext } from "./references";
const proposals = z.object({
  reply: z.string().max(24000),
  changes: z
    .array(
      z.object({
        path: z.string(),
        value: z.string().max(30000),
        reason: z.string().max(2000),
      }),
    )
    .max(100),
});
export async function assistReport(
  data: SampleData,
  message: string,
  history: { role: string; content: string }[],
  images: Part[],
) {
  const context = JSON.stringify({
    report: data,
    conversation: history.slice(-12),
  });
  if (context.length > 220000)
    throw new EvalError(
      "This report is too large for AI assistance. Please work with a smaller draft.",
      413,
    );
  const result = await generate(
    proposals,
    `${safety}\nReply in the user's language. Suggest changes only when requested. Allowed paths: name,dob,country,purpose,evaluationNotes,references; credentials[index].awardingInstitution,country,admissionRequirements,program,grantsAccessTo,standardProgramLength,yearsAttended,yearOfGraduation,equivalenceStatement,courseTableNotes; credentials[index].courses[index].year,name,level,credits,grade,usCredits,usGrade. Values are strings. Changes are proposals and do not save the report. ${await referenceContext()}`,
    [
      {
        text: `Current draft and prior conversation:\n${context}\nUser request:\n${message}`,
      },
      ...images,
    ],
  );
  return {
    ...result,
    changes: result.changes.filter((change) => changeParts(data, change.path)),
  };
}
