import "server-only";
export class EvalError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
