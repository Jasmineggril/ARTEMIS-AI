/** Minimal JSON client for the ARTEMIS AI API (same-origin session cookie). */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly body: any) {
    super(message);
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && typeof data === "object" && data.message) || `Erro ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

export const apiGet = <T = any>(url: string) => api<T>("GET", url);
