import { runNext } from "../../lib/eval/server/agent/runner";
import { openaiReady } from "../../lib/eval/server/models/openai";
if (process.env.EVAL_LOCAL_ENABLED !== "true" || !openaiReady())
  throw new Error(
    "Enable local Eval and configure EVAL_OPENAI_API_KEY before running the worker.",
  );
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
async function main() {
  console.log("AET Eval worker ready. Processing confirmed material sets.");
  do {
    try {
      const worked = await runNext();
      if (process.argv.includes("--once")) break;
      if (worked) continue;
    } catch {
      console.error("Eval storage unavailable; retrying in 5 seconds.");
      if (process.argv.includes("--once")) {
        process.exitCode = 1;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (!stopping);
}
void main();
