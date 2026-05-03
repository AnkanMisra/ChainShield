import type { ApiResult } from "./types.js";

declare const __API_BASE__: string | undefined;

export const API_BASE: string =
  (typeof __API_BASE__ !== "undefined" && __API_BASE__) ||
  (import.meta.env.PUBLIC_API_BASE as string | undefined) ||
  "http://127.0.0.1:8787";

const CLIENT_ID_KEY = "chainshield:client-id";

/**
 * Returns a stable UUID-shaped session id, persisted in localStorage so it
 * survives page reloads. The risk-gate scopes all CRUD operations to this
 * id (sent as the `X-Client-Id` header) so a fresh browser sees an empty
 * workspace and cannot read another browser's policies or timeline.
 *
 * Falls back to an in-memory id when localStorage is unavailable (Safari
 * private mode, sandboxed iframes) — isolation still works for the lifetime
 * of the page, just not across reloads.
 */
let inMemoryClientId: string | null = null;

export function getClientId(): string {
  if (inMemoryClientId) return inMemoryClientId;
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing && existing.length > 0) {
      inMemoryClientId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, fresh);
    inMemoryClientId = fresh;
    return fresh;
  } catch {
    // localStorage threw (private mode / disabled). Use a per-tab id.
    inMemoryClientId = crypto.randomUUID();
    return inMemoryClientId;
  }
}

export async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "X-Client-Id": getClientId(),
  };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
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
