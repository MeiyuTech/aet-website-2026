import "server-only";
import { GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EvalError } from "../errors";
let requestTimes: number[] = [];
function client() {
  if (!process.env.EVAL_GEMINI_API_KEY)
    throw new EvalError("AI assistance is not configured.", 503);
  const now = Date.now();
  requestTimes = requestTimes.filter((t) => now - t < 60000);
  if (requestTimes.length >= 6)
    throw new EvalError("Please wait a minute before another AI request.", 429);
  requestTimes.push(now);
  return new GoogleGenAI({
    apiKey: process.env.EVAL_GEMINI_API_KEY,
    httpOptions: { timeout: 120000 },
  });
}
export async function generate<T extends z.ZodTypeAny>(
  schema: T,
  instruction: string,
  parts: Part[],
) {
  try {
    const response = await client().models.generateContent({
      model: process.env.EVAL_GEMINI_MODEL || "gemini-3-flash-preview",
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: instruction,
        responseMimeType: "application/json",
        responseJsonSchema: zodToJsonSchema(schema, { $refStrategy: "none" }),
        temperature: 0.1,
        maxOutputTokens: 32768,
      },
    });
    if (!response.text || response.candidates?.[0]?.finishReason !== "STOP")
      throw new EvalError(
        "AI returned an incomplete response. Please retry with a smaller document.",
        502,
      );
    return schema.parse(JSON.parse(response.text)) as z.infer<T>;
  } catch (error) {
    if (error instanceof EvalError) throw error;
    const status = (error as { status?: number })?.status;
    if (status === 402)
      throw new EvalError(
        "Gemini credits are depleted. Add credits to the configured Google AI Studio project or configure another Gemini API key. Your draft has not changed.",
        503,
      );
    if (status === 429)
      throw new EvalError(
        "Gemini quota is temporarily unavailable. Please retry later or check the configured project quota.",
        429,
      );
    if (status === 400 || status === 401 || status === 403)
      throw new EvalError(
        "Gemini rejected the request. Check the configured API key, model, and project access.",
        502,
      );
    throw new EvalError(
      "AI could not complete this request. Your report has not been changed.",
      502,
    );
  }
}
