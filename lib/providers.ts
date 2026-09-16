import { syncOutlook } from "./outlook";
import {
  AppError,
  allRows,
  db,
  decrypt,
  encrypt,
  getIntegration,
  lock,
  saveIntegration,
  setting,
} from "./server";
import type { Integration } from "./server";
import type { Lead, Activity } from "./outreach";
type PipedriveCredentials = { token: string; domain: string };
type GmailCredentials = { refresh_token: string };
type RemoteRecord = Record<string, any>;
async function external(
  url: string,
  headers: Record<string, string>,
  options: RequestInit = {},
): Promise<RemoteRecord> {
  const res = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 429)
    throw new AppError(
      "The provider rate limit was reached. Wait a few minutes, then resume sync.",
      429,
    );
  if (res.status === 401 || res.status === 403)
    throw new AppError(
      "The provider denied access. Check the account permissions or reconnect.",
      401,
    );
  if (!res.ok)
    throw new AppError(
      `The provider could not complete the request (${res.status}). Resume sync shortly.`,
      502,
    );
  return res.json() as Promise<RemoteRecord>;
}
async function pipedrive(c: PipedriveCredentials, path: string) {
  return external(`https://${c.domain}.pipedrive.com/api/v2/${path}`, {
    "x-api-token": c.token,
  });
}
export async function connectPipedrive(token: string, domain: string) {
  await pipedrive({ token, domain }, "persons?limit=1");
  await saveIntegration({
    provider: "pipedrive",
    credentials: await encrypt({ token, domain }),
    account: domain + ".pipedrive.com",
    settings: {},
    cursor: null,
    last_sync: null,
    last_error: null,
    locked_until: null,
  });
}
async function googleAccess(refresh_token: string) {
  const t = await external(
    "https://oauth2.googleapis.com/token",
    { "Content-Type": "application/x-www-form-urlencoded" },
    {
      method: "POST",
      body: new URLSearchParams({
        client_id: setting("GOOGLE_CLIENT_ID"),
        client_secret: setting("GOOGLE_CLIENT_SECRET"),
        refresh_token,
        grant_type: "refresh_token",
      }),
    },
  );
  if (!t.access_token)
    throw new AppError(
      "Google authorization has expired. Reconnect Gmail.",
      401,
    );
  return String(t.access_token);
}
export async function gmailApi(token: string, path: string) {
  return external("https://gmail.googleapis.com/gmail/v1/users/me/" + path, {
    Authorization: "Bearer " + token,
  });
}
function safeDate(value: unknown, fallback = new Date().toISOString()) {
  const raw = String(value || "");
  const date = Date.parse(
    raw.includes("T") ? raw : raw.replace(" ", "T") + "Z",
  );
  return Number.isFinite(date) ? new Date(date).toISOString() : fallback;
}
export function emailAddresses(value: string) {
  return Array.from(
    value.matchAll(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi,
    ),
    (m) => m[0].toLowerCase(),
  );
}
export function gmailActivities(
  message: RemoteRecord,
  leads: Lead[],
  account: string,
) {
  const headers = message.payload?.headers || [];
  const header = (name: string) =>
    String(
      headers.find((h: RemoteRecord) => String(h.name).toLowerCase() === name)
        ?.value || "",
    );
  const from = emailAddresses(header("from"));
  const outgoing = (message.labelIds || []).includes("SENT");
  const participants = outgoing
    ? [
        ...emailAddresses(header("to")),
        ...emailAddresses(header("cc")),
        ...emailAddresses(header("bcc")),
      ]
    : from;
  const matches = leads.filter(
    (l) =>
      l.email &&
      participants.includes(l.email.toLowerCase()) &&
      l.email.toLowerCase() !== account.toLowerCase(),
  );
  const occurred_at = new Date(Number(message.internalDate)).toISOString();
  return matches.map((l) => ({
    lead_id: l.id,
    channel: "Email",
    kind: outgoing ? "Message sent" : "Reply received",
    message: [header("subject"), String(message.snippet || "")]
      .filter(Boolean)
      .join("\n\n"),
    occurred_at,
    external_id: `gmail:${account}:${message.id}:${l.id}`,
  }));
}
async function syncGmail(integration: Integration) {
  const credential = await decrypt<GmailCredentials>(integration.credentials);
  const access = await googleAccess(credential.refresh_token);
  const progress = integration.cursor
    ? JSON.parse(integration.cursor)
    : {
        page: "",
        started: new Date().toISOString(),
        after: Math.floor((Date.now() - 90 * 86400000) / 1000),
      };
  const label = integration.settings.label || "Outreach";
  const labels = await gmailApi(access, "labels");
  const selected = (labels.labels || []).find(
    (l: RemoteRecord) => l.name === label,
  );
  if (!selected)
    throw new AppError(
      `Create the Gmail label “${label}” and apply it to outreach conversations, then sync again.`,
      409,
    );
  const params = new URLSearchParams({
    maxResults: "30",
    labelIds: selected.id,
    q: `after:${progress.after}`,
  });
  if (progress.page) params.set("pageToken", progress.page);
  const list = await gmailApi(access, "messages?" + params);
  const leads = await allRows<Lead>("outreach_leads");
  if (!leads.length)
    throw new AppError(
      "Import your leads or sync Pipedrive first. Gmail only imports messages matched to your saved leads.",
      409,
    );
  let matched = 0;
  for (let i = 0; i < (list.messages || []).length; i += 5) {
    const messages = await Promise.all(
      list.messages
        .slice(i, i + 5)
        .map((m: RemoteRecord) =>
          gmailApi(
            access,
            `messages/${encodeURIComponent(m.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Bcc&metadataHeaders=Subject`,
          ),
        ),
    );
    const rows = messages.flatMap((m: RemoteRecord) =>
      gmailActivities(m, leads, integration.account),
    );
    if (rows.length) {
      const inserted = await db<Activity[]>(
        "outreach_activities?on_conflict=external_id",
        "POST",
        rows,
        "resolution=ignore-duplicates,return=representation",
      );
      matched += inserted.length;
    }
  }
  const next = list.nextPageToken;
  await saveIntegration({
    provider: "gmail",
    cursor: next ? JSON.stringify({ ...progress, page: next }) : null,
    last_error: null,
    ...(!next ? { last_sync: progress.started } : {}),
  });
  return {
    done: !next,
    message: `${matched} new email activities saved.`,
    processed: (list.messages || []).length,
  };
}
async function syncPipedrive(integration: Integration) {
  const c = await decrypt<PipedriveCredentials>(integration.credentials);
  const progress = integration.cursor
    ? JSON.parse(integration.cursor)
    : { phase: "persons", page: "", started: new Date().toISOString() };
  const params = new URLSearchParams({ limit: "100" });
  if (progress.page) params.set("cursor", progress.page);
  const result = await pipedrive(c, progress.phase + "?" + params);
  const records: RemoteRecord[] = result.data || [];
  if (progress.phase === "persons" && records.length) {
    const orgIds = [...new Set(records.map((p) => p.org_id).filter(Boolean))];
    const orgs = orgIds.length
      ? (
          await pipedrive(
            c,
            "organizations?" +
              new URLSearchParams({ ids: orgIds.join(","), limit: "100" }),
          )
        ).data || []
      : [];
    const orgMap = new Map(orgs.map((o: RemoteRecord) => [o.id, o.name]));
    await db("rpc/outreach_import", "POST", {
      payload: records.map((p) => ({
        name: p.name || "Unnamed contact",
        company: orgMap.get(p.org_id) || "",
        position: p.job_title || "",
        email:
          (p.emails?.find((e: RemoteRecord) => e.primary) || p.emails?.[0])
            ?.value || "",
        phone:
          (p.phones?.find((e: RemoteRecord) => e.primary) || p.phones?.[0])
            ?.value || "",
        external_id: "pipedrive:" + p.id,
      })),
    });
  }
  if (progress.phase === "deals" && records.length) {
    const leads = await allRows<Lead>(
      "outreach_leads",
      "external_id=not.is.null",
    );
    const map = new Map(leads.map((l) => [l.external_id, l.id]));
    const stages = (await pipedrive(c, "stages?limit=500")).data || [];
    const stageMap = new Map(stages.map((s: RemoteRecord) => [s.id, s.name]));
    await db(
      "outreach_deals?on_conflict=external_id",
      "POST",
      records.map((d) => ({
        lead_id: map.get("pipedrive:" + d.person_id) || null,
        title: d.title || "Untitled deal",
        value: d.value || 0,
        currency: d.currency || "USD",
        status: d.status,
        stage: stageMap.get(d.stage_id) || `Stage ${d.stage_id}`,
        external_id: "pipedrive:" + d.id,
        sync_run: progress.started,
      })),
      "resolution=merge-duplicates",
    );
  }
  if (progress.phase === "activities" && records.length) {
    const leads = await allRows<Lead>(
      "outreach_leads",
      "external_id=not.is.null",
    );
    const map = new Map(leads.map((l) => [l.external_id, l.id]));
    const rows = records
      .filter((a) => map.has("pipedrive:" + a.person_id))
      .map((a) => ({
        lead_id: map.get("pipedrive:" + a.person_id),
        channel: "Pipedrive",
        kind: a.type === "meeting" ? "Meeting booked" : "Note",
        message: [
          a.subject,
          a.note ? String(a.note).replace(/<[^>]*>/g, "") : "",
          a.due_date
            ? "Scheduled: " + a.due_date + " " + (a.due_time || "")
            : "",
          a.done ? "Completed" : "Open",
        ]
          .filter(Boolean)
          .join("\n"),
        occurred_at: safeDate(a.add_time),
        external_id: "pipedrive:activity:" + a.id,
      }));
    if (rows.length)
      await db(
        "outreach_activities?on_conflict=external_id",
        "POST",
        rows,
        "resolution=merge-duplicates",
      );
  }
  const next = result.additional_data?.next_cursor;
  const nextPhase =
    progress.phase === "persons"
      ? "deals"
      : progress.phase === "deals"
        ? "activities"
        : null;
  const done = !next && !nextPhase;
  if (done)
    await db(
      `outreach_deals?external_id=like.pipedrive%3A*&sync_run=lt.${encodeURIComponent(progress.started)}`,
      "DELETE",
    );
  await saveIntegration({
    provider: "pipedrive",
    cursor: done
      ? null
      : JSON.stringify({
          ...progress,
          phase: next ? progress.phase : nextPhase,
          page: next || "",
        }),
    last_error: null,
    ...(done ? { last_sync: progress.started } : {}),
  });
  return {
    done,
    message: `Synced ${records.length} ${progress.phase}.`,
    processed: records.length,
  };
}
export async function syncProvider(provider: string) {
  const integration = await getIntegration(provider);
  if (!integration) throw new AppError("Connect this account first.", 409);
  await lock(provider);
  try {
    return provider === "outlook"
      ? await syncOutlook(integration)
      : provider === "gmail"
        ? await syncGmail(integration)
        : await syncPipedrive(integration);
  } catch (e) {
    await saveIntegration({
      provider,
      last_error:
        e instanceof AppError ? e.message : "Sync failed. Resume to try again.",
    });
    throw e;
  } finally {
    await saveIntegration({ provider, locked_until: null });
  }
}
