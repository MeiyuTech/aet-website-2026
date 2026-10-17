export async function evalRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/admin/eval/${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Request failed. Please try again.");
  return result as T;
}
