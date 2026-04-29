import type { ApiResult } from "./types.js";

declare const __API_BASE__: string | undefined;

export const API_BASE: string =
  (typeof __API_BASE__ !== "undefined" && __API_BASE__) ||
  (import.meta.env.PUBLIC_API_BASE as string | undefined) ||
  "http://127.0.0.1:8787";

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data: data as T };
}
