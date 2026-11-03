import type { Config, NewSource, SearchRequest, SearchResponse, Source, Status } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`.trim();
    try {
      const body = await res.json();
      if (body && typeof body.error === "string" && body.error) message = body.error;
    } catch {
      // Not JSON; keep the status line.
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  config: () => call<Config>("/api/config"),
  sources: () => call<Source[]>("/api/sources"),
  status: () => call<Status>("/api/status"),
  search: (req: SearchRequest, signal?: AbortSignal) =>
    call<SearchResponse>("/api/search", { method: "POST", body: JSON.stringify(req), signal }),
  addSource: (s: NewSource) =>
    call<Source>("/api/sources", { method: "POST", body: JSON.stringify(s) }),
  removeSource: (id: string) =>
    call<void>(`/api/sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
  syncSource: (id: string) =>
    call<void>(`/api/sources/${encodeURIComponent(id)}/sync`, { method: "POST" }),
};
