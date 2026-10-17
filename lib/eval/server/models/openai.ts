import "server-only";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { EvalError } from "../errors";
export const openaiModel = () => process.env.EVAL_OPENAI_MODEL || "gpt-6.1-sol";
export const openaiReady = () => !!process.env.EVAL_OPENAI_API_KEY;
export type ModelInput =
  | { type: "input_text"; text: string }
  | { type: "input_file"; filename: string; file_data: string }
  | { type: "input_image"; image_url: string; detail: "high" };
export class ModelError extends EvalError {
  constructor(
    message: string,
    public retryable = false,
    status = 502,
  ) {
    super(message, status);
  }
}
export async function openaiGenerate<T extends z.ZodTypeAny>(
  schema: T,
  instructions: string,
  input: ModelInput[],
  model = openaiModel(),
): Promise<z.infer<T>> {
  if (!openaiReady())
    throw new ModelError(
      "Configure EVAL_OPENAI_API_KEY before starting the generation worker.",
      false,
      503,
    );
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.EVAL_OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model,
        store: false,
        instructions,
        input: [{ role: "user", content: input }],
        max_output_tokens: 24000,
        text: {
          format: {
            type: "json_schema",
            name: "evaluation_result",
            strict: true,
            schema: zodToJsonSchema(schema, { $refStrategy: "none" }),
          },
        },
      }),
    });
  } catch {
    throw new ModelError(
      "OpenAI timed out or could not be reached. Completed steps are retained.",
      true,
    );
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403)
      throw new ModelError(
        "OpenAI rejected the key or model access. Check the configured project.",
        false,
        503,
      );
    if (response.status === 429)
      throw new ModelError(
        "OpenAI quota or rate limit reached. Check project billing and retry.",
        true,
        429,
      );
    throw new ModelError(
      "OpenAI could not complete this step. Check the configured model and retry.",
      response.status >= 500,
    );
  }
  const body = (await response.json()) as {
    status?: string;
    output?: Array<{ content?: Array<{ type: string; text?: string }> }>;
  };
  if (body.status !== "completed")
    throw new ModelError(
      "OpenAI returned an incomplete result. Use fewer or smaller documents.",
    );
  const parts = body.output?.flatMap((item) => item.content || []) || [];
  if (parts.some((part) => part.type === "refusal"))
    throw new ModelError(
      "OpenAI could not process this material. Review the files before retrying.",
    );
  try {
    return schema.parse(
      JSON.parse(
        parts
          .filter((part) => part.type === "output_text")
          .map((part) => part.text || "")
          .join(""),
      ),
    );
  } catch {
    throw new ModelError(
      "OpenAI returned a result that did not pass validation. No report was replaced.",
    );
  }
}
