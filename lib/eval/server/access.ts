import "server-only";
import { EvalError } from "./errors";
export function isEvalEnabled() {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.EVAL_LOCAL_ENABLED === "true"
  );
}
export function isLocalHost(host: string) {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(`http://${host}`).hostname,
    );
  } catch {
    return false;
  }
}
export function guard(request: Request) {
  const host = request.headers.get("host") || "";
  if (!isEvalEnabled() || !isLocalHost(host))
    throw new EvalError("Not found", 404);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new EvalError("Request not allowed", 403);
  // Next's internal request URL can use localhost even when the browser uses 127.0.0.1.
  // Compare against the validated browser Host header, including its port.
  if (
    !["GET", "HEAD"].includes(request.method) &&
    request.headers.get("origin") !== `http://${host}`
  ) {
    throw new EvalError("Request origin does not match", 403);
  }
}
