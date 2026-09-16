import { z } from "zod";
export function setting(key: string): string {
  return process.env[key] || "";
}
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function configured() {
  return !!(setting("SUPABASE_URL") && setting("SUPABASE_SECRET_KEY"));
}
// Intentionally no login in this manually hosted edition, at the owner's request.
// All visitors can read, edit and manage integrations. Not an access-control check.
export async function authorize(_write = false) {
  return { userId: "shared-workspace", email: "shared-workspace@local.invalid", admin: true };
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin)
    throw new AppError(
      "This action must be performed from your dashboard.",
      403,
    );
}
export async function input(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("Expected JSON.", 415);
  const raw = await req.text();
  if (raw.length > 2_000_000)
    throw new AppError("Please import at most 500 rows at a time.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Invalid JSON.");
  }
}
export function response(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}
export function failure(e: unknown) {
  if (e instanceof z.ZodError)
    return response(
      {
        error: e.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      400,
    );
  if (e instanceof AppError) return response({ error: e.message }, e.status);
  console.error(
    "Outreach request failed",
    e instanceof Error ? e.name : "Unknown",
  );
  return response(
    {
      error:
        "This request could not be completed. Your input has been kept. Please try again.",
    },
    500,
  );
}
export async function db<T = unknown>(
  path: string,
  method = "GET",
  body?: unknown,
  prefer?: string,
): Promise<T> {
  if (!configured())
    throw new AppError(
      "Connect Supabase before saving real outreach data.",
      409,
    );
  const key = setting("SUPABASE_SECRET_KEY");
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  if (!key.startsWith("sb_secret_")) headers.Authorization = `Bearer ${key}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(
    setting("SUPABASE_URL").replace(/\/$/, "") + "/rest/v1/" + path,
    {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    },
  );
  if (!res.ok) {
    console.error("Database request failed", path.split("?")[0], res.status);
    throw new AppError(
      "The database request failed. Check that the setup SQL has been applied and the server key is correct.",
      502,
    );
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
export async function allRows<T>(table: string, query = ""): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const page = await db<T[]>(
      `${table}?select=*&order=id&limit=1000&offset=${offset}${query ? "&" + query : ""}`,
    );
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
  throw new AppError(
    "This workspace has exceeded the current dashboard limit of 50,000 records per table. Export or archive older records before continuing.",
    413,
  );
}
export async function secureKey() {
  const raw = setting("INTEGRATION_ENCRYPTION_KEY");
  if (raw.length < 32)
    throw new AppError(
      "The workspace owner needs to configure the integration encryption key.",
      409,
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encrypt(value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await secureKey(),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return btoa(String.fromCharCode(...iv, ...new Uint8Array(bytes)));
}
export async function decrypt<T>(value: string): Promise<T> {
  const raw = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12) },
    await secureKey(),
    raw.slice(12),
  );
  return JSON.parse(new TextDecoder().decode(bytes));
}
export type Integration = {
  provider: string;
  credentials: string;
  account: string;
  last_sync: string | null;
  last_error: string | null;
  cursor: string | null;
  settings: Record<string, string>;
  locked_until: string | null;
};
export async function getIntegration(provider: string) {
  const records = await db<Integration[]>(
    `outreach_integrations?provider=eq.${encodeURIComponent(provider)}&limit=1`,
  );
  return records[0] || null;
}
export async function saveIntegration(
  value: Partial<Integration> & { provider: string },
) {
  await db(
    "outreach_integrations?on_conflict=provider",
    "POST",
    value,
    "resolution=merge-duplicates",
  );
}
export async function lock(provider: string) {
  const until = new Date(Date.now() + 180000).toISOString();
  const rows = await db<Integration[]>(
    `outreach_integrations?provider=eq.${provider}&or=(locked_until.is.null,locked_until.lt.${encodeURIComponent(new Date().toISOString())})`,
    "PATCH",
    { locked_until: until },
    "return=representation",
  );
  if (!rows.length)
    throw new AppError("A sync is already running. Please wait a moment.", 409);
}
