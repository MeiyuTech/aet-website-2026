import "server-only";
import { generate } from "../models/gemini";
import { EvalError } from "../errors";
import { convertToSampleData } from "../../domain/parsed-document";
import {
  ParsedPdfResponseSchema,
  TranscriptResponseSchema,
  STAGE1_PDF_PARSING_INSTRUCTION,
} from "../models/document-schemas";
import { safety } from "../models/instructions";
import { referenceContext } from "./references";
export async function analyzePdfWithGemini(buffer: ArrayBuffer) {
  const raw = await generate(
    ParsedPdfResponseSchema,
    `${safety}\n${STAGE1_PDF_PARSING_INSTRUCTION}`,
    [
      {
        inlineData: {
          mimeType: "application/pdf",
          data: Buffer.from(buffer).toString("base64"),
        },
      },
      {
        text: "Extract every credential and every course. Preserve source values. This is an extraction draft.",
      },
    ],
  );
  const result = await generate(
    TranscriptResponseSchema,
    `${safety}\nUse the supplied stored grade rules only when the country, scale, and education level match. Mark all other conversions AI_INFERRED. Explain the credit conversion basis and round proposed US credits to the nearest 0.5. Preserve every original course, credit, and grade in order. Do not invent document details. Include only relevant references from the supplied catalog; do not claim to have consulted publications.\n${await referenceContext()}`,
    [{ text: JSON.stringify(raw) }],
  );
  if (
    result.credentials.length !== raw.credentials.length ||
    result.credentials.some(
      (cred, i) => cred.courses.length !== raw.credentials[i].courses.length,
    )
  ) {
    throw new EvalError(
      "AI returned an incomplete course list. Nothing was imported; please retry.",
      502,
    );
  }
  // The second stage may suggest conversions, but cannot rewrite extracted originals.
  result.name = raw.name;
  result.dob = raw.dob;
  result.country = raw.country;
  result.documents = raw.documents;
  result.credentials = result.credentials.map((cred, i) => ({
    ...cred,
    ...raw.credentials[i],
    courses: cred.courses.map((course, j) => ({
      ...course,
      ...raw.credentials[i].courses[j],
    })),
  }));
  return {
    data: convertToSampleData(result),
    warnings: [
      "Review all extracted fields, proposed equivalencies, and conversions before applying.",
    ],
    detectedLanguage: raw.detectedLanguage,
  };
}
