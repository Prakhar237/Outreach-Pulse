import { microsoftAuthority, microsoftScopes } from "@/lib/outlook";
import {
  allRows,
  authorize,
  configured,
  db,
  decrypt,
  encrypt,
  failure,
  input,
  response,
  sameOrigin,
  setting,
  getIntegration,
  AppError,
} from "@/lib/server";
import type { Integration } from "@/lib/server";
import { connectPipedrive, syncProvider } from "@/lib/providers";
import { z } from "zod";
function appOrigin(req: Request) {
  const configured = setting("APP_URL").replace(/\/$/, "");
  if (!configured || new URL(configured).origin !== new URL(req.url).origin)
    throw new AppError(
      "Set APP_URL to this dashboard’s exact origin before connecting an email account.",
      409,
    );
  return configured;
}
export async function GET() {
  try {
    if (!configured())
      return response({
        ready: false,
        googleReady: false,
        microsoftReady: false,
        encryptionReady: false,
        connections: [],
      });
    await authorize(true);
    const records = await allRows<Integration>("outreach_integrations");
    return response({
      ready: true,
      microsoftReady: !!(
        setting("MICROSOFT_CLIENT_ID") &&
        setting("MICROSOFT_CLIENT_SECRET") &&
        setting("APP_URL")
      ),
      googleReady: !!(
        setting("GOOGLE_CLIENT_ID") &&
        setting("GOOGLE_CLIENT_SECRET") &&
        setting("APP_URL")
      ),
      encryptionReady: setting("INTEGRATION_ENCRYPTION_KEY").length >= 32,
      connections: records.map((r) => ({
        provider: r.provider,
        account: r.account,
        last_sync: r.last_sync,
        last_error: r.last_error,
        pending: !!r.cursor,
        label: r.settings.label || "Outreach",
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const user = await authorize(true);
    const body = await input(req);
    const provider = z
      .enum(["outlook", "gmail", "pipedrive"])
      .parse(body.provider);
    if (!configured()) throw new AppError("Connect Supabase first.", 409);
    if (body.action === "sync") return response(await syncProvider(provider));
    if (body.action === "disconnect") {
      const current = await getIntegration(provider);
      if (
        current?.locked_until &&
        Date.parse(current.locked_until) > Date.now()
      )
        throw new AppError(
          "Wait for the current sync to finish before disconnecting.",
          409,
        );
      if (current && provider === "gmail") {
        const tokens = await decrypt<{ refresh_token: string }>(
          current.credentials,
        );
        const revoke = await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: tokens.refresh_token }),
          signal: AbortSignal.timeout(15000),
        });
        if (!revoke.ok && revoke.status !== 400)
          throw new AppError(
            "Google could not revoke access. Please retry disconnecting.",
            502,
          );
      }
      await db("outreach_integrations?provider=eq." + provider, "DELETE");
      return response({ ok: true });
    }
    if (body.action === "connect") {
      const current = await getIntegration(provider);
      if (
        current?.locked_until &&
        Date.parse(current.locked_until) > Date.now()
      )
        throw new AppError(
          "Wait for the current sync before reconnecting.",
          409,
        );
    }
    if (body.action === "connect" && provider === "outlook") {
      const origin = appOrigin(req);
      if (
        !setting("MICROSOFT_CLIENT_ID") ||
        !setting("MICROSOFT_CLIENT_SECRET")
      )
        throw new AppError(
          "Add the Microsoft app client ID and secret to enable Outlook.",
          409,
        );
      const state = crypto.randomUUID();
      const verifier = Array.from(
        crypto.getRandomValues(new Uint8Array(32)),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier),
      );
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const cookie = await encrypt({
        state,
        verifier,
        email: user.email,
        issued: Date.now(),
      });
      const params = new URLSearchParams({
        client_id: setting("MICROSOFT_CLIENT_ID"),
        redirect_uri: origin + "/api/oauth/microsoft/callback",
        response_type: "code",
        response_mode: "query",
        scope: microsoftScopes,
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      });
      return response(
        { url: microsoftAuthority() + "/authorize?" + params },
        200,
        {
          "Set-Cookie": `pulse_microsoft=${encodeURIComponent(cookie)}; HttpOnly; SameSite=Lax; Path=/api/oauth/microsoft/callback; Max-Age=600${origin.startsWith("https:") ? "; Secure" : ""}`,
        },
      );
    }
    if (body.action === "connect" && provider === "pipedrive") {
      const { token, domain } = z
        .object({
          token: z.string().trim().min(20).max(300),
          domain: z
            .string()
            .trim()
            .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/),
        })
        .parse(body);
      await connectPipedrive(token, domain);
      return response({ ok: true });
    }
    if (body.action === "connect" && provider === "gmail") {
      const origin = appOrigin(req);
      if (!setting("GOOGLE_CLIENT_ID") || !setting("GOOGLE_CLIENT_SECRET"))
        throw new AppError(
          "Add the Google OAuth client ID and secret to enable Gmail.",
          409,
        );
      const state = crypto.randomUUID();
      const cookie = await encrypt({
        state,
        email: user.email,
        issued: Date.now(),
      });
      const params = new URLSearchParams({
        client_id: setting("GOOGLE_CLIENT_ID"),
        redirect_uri: origin + "/api/oauth/google/callback",
        response_type: "code",
        scope: "https://www.googleapis.com/auth/gmail.readonly",
        access_type: "offline",
        prompt: "consent",
        state,
      });
      return response(
        { url: "https://accounts.google.com/o/oauth2/v2/auth?" + params },
        200,
        {
          "Set-Cookie": `pulse_oauth=${encodeURIComponent(cookie)}; HttpOnly; SameSite=Lax; Path=/api/oauth/google/callback; Max-Age=600${origin.startsWith("https:") ? "; Secure" : ""}`,
        },
      );
    }
    throw new AppError("Unknown integration action.");
  } catch (e) {
    return failure(e);
  }
}
