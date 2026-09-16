import {
  AppError,
  allRows,
  db,
  decrypt,
  encrypt,
  saveIntegration,
  setting,
} from "./server";
import type { Integration } from "./server";
import type { Lead, Activity } from "./outreach";
export const microsoftScopes =
  "offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read";
export function microsoftAuthority() {
  const tenant = setting("MICROSOFT_TENANT_ID") || "common";
  if (!/^(common|organizations|consumers|[a-zA-Z0-9.-]+)$/.test(tenant))
    throw new AppError("Invalid Microsoft tenant configuration.", 409);
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
}
export type MicrosoftTokens = {
  access_token: string;
  refresh_token?: string;
  scope?: string;
};
export async function microsoftToken(
  values: Record<string, string>,
): Promise<MicrosoftTokens> {
  const res = await fetch(microsoftAuthority() + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: setting("MICROSOFT_CLIENT_ID"),
      client_secret: setting("MICROSOFT_CLIENT_SECRET"),
      scope: microsoftScopes,
      ...values,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    if (res.status === 429)
      throw new AppError(
        "Microsoft is limiting requests. Wait a few minutes and resume sync.",
        429,
      );
    throw new AppError(
      "Microsoft authorization could not be renewed. Reconnect Outlook and check the app’s client secret expiry.",
      401,
    );
  }
  const tokens = (await res.json()) as MicrosoftTokens;
  if (!tokens.access_token)
    throw new AppError("Microsoft did not return an access token.", 502);
  return tokens;
}
export async function graph(token: string, path: string) {
  const url = new URL(
    path.startsWith("https:")
      ? path
      : "https://graph.microsoft.com/v1.0/" + path,
  );
  if (
    url.origin !== "https://graph.microsoft.com" ||
    !url.pathname.startsWith("/v1.0/") ||
    url.username ||
    url.password
  )
    throw new AppError(
      "Microsoft returned an unexpected pagination link.",
      502,
    );
  const res = await fetch(url, {
    headers: {
      Authorization: "Bearer " + token,
      Prefer: 'IdType="ImmutableId"',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 429)
    throw new AppError(
      "Outlook’s request limit was reached. Wait a few minutes and resume sync.",
      429,
    );
  if (res.status === 401 || res.status === 403)
    throw new AppError(
      "Outlook denied access. Reconnect the mailbox or ask your Microsoft administrator to approve Mail.Read.",
      401,
    );
  if (!res.ok)
    throw new AppError(
      `Outlook sync could not complete (${res.status}). Retry or reconnect the mailbox.`,
      502,
    );
  return res.json() as Promise<Record<string, any>>;
}
export type OutlookMessage = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isDraft?: boolean;
  categories?: string[];
  from?: { emailAddress?: { address?: string } };
  sender?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  bccRecipients?: { emailAddress?: { address?: string } }[];
  parentFolderId?: string;
  receivedDateTime?: string;
  sentDateTime?: string;
};
export function outlookActivities(
  message: OutlookMessage,
  leads: Lead[],
  account: string,
  accountId: string,
  sentFolder: string,
  category = "Outreach",
) {
  if (message.isDraft || !message.categories?.includes(category)) return [];
  const from = String(message.from?.emailAddress?.address || "").toLowerCase();
  const sender = String(
    message.sender?.emailAddress?.address || "",
  ).toLowerCase();
  const own = account.toLowerCase();
  const outgoing =
    from === own || sender === own || message.parentFolderId === sentFolder;
  const participants = outgoing
    ? [
        ...(message.toRecipients || []),
        ...(message.ccRecipients || []),
        ...(message.bccRecipients || []),
      ].map((r) => String(r.emailAddress?.address || "").toLowerCase())
    : [from];
  const matches = leads.filter(
    (l) =>
      l.email &&
      l.email.toLowerCase() !== own &&
      participants.includes(l.email.toLowerCase()),
  );
  const timestamp = outgoing ? message.sentDateTime : message.receivedDateTime;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return [];
  return matches.map((l) => ({
    lead_id: l.id,
    channel: "Email",
    kind: outgoing ? "Message sent" : "Reply received",
    message: [message.subject || "", message.bodyPreview || ""]
      .filter(Boolean)
      .join("\n\n"),
    occurred_at: new Date(timestamp).toISOString(),
    external_id: `outlook:${accountId}:${message.id}:${l.id}`,
  }));
}
export async function syncOutlook(integration: Integration) {
  const credential = await decrypt<{ refresh_token: string }>(
    integration.credentials,
  );
  const tokens = await microsoftToken({
    refresh_token: credential.refresh_token,
    grant_type: "refresh_token",
  });
  // Microsoft can rotate the refresh token on every redemption; persist it before other work.
  if (tokens.refresh_token)
    await saveIntegration({
      provider: "outlook",
      credentials: await encrypt({ refresh_token: tokens.refresh_token }),
    });
  const leads = await allRows<Lead>("outreach_leads");
  if (!leads.length)
    throw new AppError(
      "Import your leads or sync Pipedrive first. Outlook matches messages to saved lead emails.",
      409,
    );
  const progress = integration.cursor
    ? JSON.parse(integration.cursor)
    : {
        next: "",
        started: new Date().toISOString(),
        after: new Date(Date.now() - 90 * 86400000).toISOString(),
      };
  const category = integration.settings.category || "Outreach";
  const params = new URLSearchParams({
    $top: "50",
    $filter: `receivedDateTime ge ${progress.after} and categories/any(c:c eq '${category.replace(/'/g, "''")}')`,
    $select:
      "id,subject,bodyPreview,from,sender,toRecipients,ccRecipients,bccRecipients,sentDateTime,receivedDateTime,parentFolderId,isDraft,categories",
  });
  const [list, sentFolder] = await Promise.all([
    graph(tokens.access_token, progress.next || "me/messages?" + params),
    graph(tokens.access_token, "me/mailFolders/sentitems?$select=id"),
  ]);
  const rows = (list.value || []).flatMap((m: OutlookMessage) =>
    outlookActivities(
      m,
      leads,
      integration.account,
      integration.settings.account_id || integration.account,
      String(sentFolder.id),
      category,
    ),
  );
  const inserted = rows.length
    ? await db<Activity[]>(
        "outreach_activities?on_conflict=external_id",
        "POST",
        rows,
        "resolution=ignore-duplicates,return=representation",
      )
    : [];
  const next = list["@odata.nextLink"];
  if (next) {
    const url = new URL(next);
    if (
      url.origin !== "https://graph.microsoft.com" ||
      !url.pathname.startsWith("/v1.0/")
    )
      throw new AppError("Outlook returned an unexpected next page.", 502);
  }
  await saveIntegration({
    provider: "outlook",
    cursor: next ? JSON.stringify({ ...progress, next }) : null,
    last_error: null,
    ...(!next ? { last_sync: progress.started } : {}),
  });
  return {
    done: !next,
    message: `${inserted.length} new Outlook activities saved.`,
    processed: (list.value || []).length,
  };
}
