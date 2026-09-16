import {
  authorize,
  decrypt,
  encrypt,
  saveIntegration,
  setting,
  AppError,
} from "@/lib/server";
import { gmailApi } from "@/lib/providers";
export async function GET(req: Request) {
  const origin = setting("APP_URL").replace(/\/$/, "");
  if (!origin || new URL(req.url).origin !== new URL(origin).origin)
    return new Response("Invalid callback origin", { status: 400 });
  let result = "gmail_error";
  try {
    const user = await authorize(true);
    const url = new URL(req.url);
    const raw = req.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("pulse_oauth="))
      ?.slice(12);
    if (!raw) throw new AppError("Missing authorization state");
    const stored = await decrypt<{
      state: string;
      email: string;
      issued: number;
    }>(decodeURIComponent(raw));
    if (
      stored.state !== url.searchParams.get("state") ||
      stored.email !== user.email ||
      Date.now() - stored.issued > 600000 ||
      stored.issued > Date.now()
    )
      throw new AppError("Invalid authorization state");
    if (url.searchParams.get("error")) result = "gmail_cancelled";
    else {
      const code = url.searchParams.get("code");
      if (!code) throw new AppError("Missing authorization code");
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: setting("GOOGLE_CLIENT_ID"),
          client_secret: setting("GOOGLE_CLIENT_SECRET"),
          redirect_uri: origin + "/api/oauth/google/callback",
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new AppError("Token exchange failed");
      const tokens = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        scope?: string;
      };
      if (
        !tokens.refresh_token ||
        !tokens.scope
          ?.split(" ")
          .includes("https://www.googleapis.com/auth/gmail.readonly")
      )
        throw new AppError("Read permission or offline access missing");
      const profile = await gmailApi(tokens.access_token, "profile");
      await saveIntegration({
        provider: "gmail",
        account: profile.emailAddress,
        credentials: await encrypt({ refresh_token: tokens.refresh_token }),
        settings: { label: "Outreach" },
        last_sync: null,
        last_error: null,
        cursor: null,
        locked_until: null,
      });
      result = "gmail_connected";
    }
  } catch (e) {
    console.error(
      "Google connection failed",
      e instanceof Error ? e.name : "Unknown",
    );
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: origin + "/?connection=" + result,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `pulse_oauth=; HttpOnly; SameSite=Lax; Path=/api/oauth/google/callback; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
    },
  });
}
