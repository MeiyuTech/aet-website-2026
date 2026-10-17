import "server-only";
import { supabaseConfig } from "./config";
export async function storageFetch(path: string, init: RequestInit = {}) {
  const { url, key } = supabaseConfig();
  return fetch(`${url}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
    headers: { ...init.headers, apikey: key, Authorization: `Bearer ${key}` },
  });
}
