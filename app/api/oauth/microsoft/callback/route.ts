import {
  AppError,
  authorize,
  decrypt,
  encrypt,
  saveIntegration,
  setting,
} from "@/lib/server";
import { graph, microsoftToken } from "@/lib/outlook";
export async function GET(req: Request) {
  const origin = setting("APP_URL").replace(/\/$/, "");
  if (!origin || new URL(req.url).origin !== new URL(origin).origin)
    return new Response("Invalid callback origin", { status: 400 });
  let result = "outlook_error";
  try {
    const user = await authorize(true);
    const url = new URL(req.url);
    const cookie = req.headers
      .get("cookie")
      ?.split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("pulse_microsoft="))
      ?.slice("pulse_microsoft=".length);
    if (!cookie) throw new AppError("Missing authorization state");
    const saved = await decrypt<{
      state: string;
      email: string;
      issued: number;
      verifier: string;
    }>(decodeURIComponent(cookie));
    if (
      saved.state !== url.searchParams.get("state") ||
      saved.email !== user.email ||
      Date.now() - saved.issued > 600000 ||
      saved.issued > Date.now()
    )
      throw new AppError("Invalid authorization state");
    if (url.searchParams.get("error")) result = "outlook_cancelled";
    else {
      const code = url.searchParams.get("code");
      if (!code) throw new AppError("Missing authorization code");
      const tokens = await microsoftToken({
        grant_type: "authorization_code",
        code,
        code_verifier: saved.verifier,
        redirect_uri: origin + "/api/oauth/microsoft/callback",
      });
      if (
        !tokens.refresh_token ||
        !tokens.scope
          ?.toLowerCase()
          .split(" ")
          .some(
            (s) =>
              s === "mail.read" ||
              s === "https://graph.microsoft.com/mail.read",
          )
      )
        throw new AppError("Outlook read permission or offline access missing");
      const profile = await graph(
        tokens.access_token,
        "me?$select=id,mail,userPrincipalName",
      );
      const account = profile.mail || profile.userPrincipalName;
      if (!account || !profile.id)
        throw new AppError("Microsoft did not return a mailbox identity");
      await graph(tokens.access_token, "me/messages?$top=1&$select=id");
      await saveIntegration({
        provider: "outlook",
        account,
        credentials: await encrypt({ refresh_token: tokens.refresh_token }),
        settings: { category: "Outreach", account_id: profile.id },
        last_sync: null,
        last_error: null,
        cursor: null,
        locked_until: null,
      });
      result = "outlook_connected";
    }
  } catch (e) {
    console.error(
      "Microsoft connection failed",
      e instanceof Error ? e.name : "Unknown",
    );
  }
  return new Response(null, {
    status: 303,
    headers: {
      Location: origin + "/?connection=" + result,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "Set-Cookie": `pulse_microsoft=; HttpOnly; SameSite=Lax; Path=/api/oauth/microsoft/callback; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
    },
  });
}
