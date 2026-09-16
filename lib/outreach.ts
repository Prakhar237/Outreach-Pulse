export type Channel = "Email" | "LinkedIn" | "WhatsApp" | "Pipedrive";
export type Lead = {
  id: string;
  name: string;
  company: string;
  position: string;
  email: string;
  phone: string;
  linkedin_url: string;
  status: string;
  owner: string;
  created_at: string;
  source_data?: Record<string, unknown>;
  external_id?: string | null;
};
export type Activity = {
  id: string;
  lead_id: string;
  channel: Channel;
  kind: string;
  message: string;
  occurred_at: string;
  external_id?: string | null;
};
export type Deal = {
  id: string;
  lead_id: string | null;
  title: string;
  value: number;
  currency: string;
  status: string;
  stage: string;
  external_id?: string | null;
};
export type Dataset = { leads: Lead[]; activities: Activity[]; deals: Deal[] };
export const channels: Channel[] = ["Email", "LinkedIn", "WhatsApp"];
export const statuses = [
  "New",
  "Contacted",
  "Replied",
  "Qualified",
  "Meeting booked",
  "Won",
  "Lost",
];
export const kinds = [
  "Message sent",
  "Reply received",
  "Positive reply",
  "Connection requested",
  "Connection accepted",
  "Meeting booked",
  "Note",
];
export function demoData(): Dataset {
  const people = [
    ["Alex Morgan", "Northstar", "Founder", "Qualified"],
    ["Sarah Chen", "Layers", "Head of Growth", "Meeting booked"],
    ["James Wilson", "Orbit", "CEO", "Replied"],
    ["Priya Sharma", "Acme Studio", "Marketing Director", "Contacted"],
    ["Oliver Scott", "Forma", "Co-founder", "Qualified"],
    ["Emma Davis", "Capsule", "VP Marketing", "Contacted"],
    ["Noah Williams", "Spherule", "Founder", "New"],
    ["Sofia Martinez", "CloudWatch", "Head of Sales", "Won"],
    ["Liam Brown", "Alt+Shift", "Managing Director", "Replied"],
    ["Mia Taylor", "Quotient", "CEO", "Contacted"],
    ["Ethan Lee", "Catalog", "Growth Lead", "Meeting booked"],
    ["Ava Johnson", "Circooles", "Founder", "New"],
  ];
  const leads = people.map((p, i) => ({
    id: `demo-${i}`,
    name: p[0],
    company: p[1],
    position: p[2],
    status: p[3],
    email:
      p[0].split(" ")[0].toLowerCase() +
      "@" +
      p[1].replace(/[^a-z]/gi, "").toLowerCase() +
      ".example",
    phone: "",
    linkedin_url: "",
    owner: "Your agency",
    created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
  }));
  const activities: Activity[] = [];
  for (let d = 27; d >= 0; d--)
    for (let j = 0; j < 4 + ((d * 7) % 11); j++) {
      const i = (d * 3 + j) % leads.length;
      const kind =
        j === 0 && d % 2 === 0
          ? "Reply received"
          : j === 1 && d % 5 === 0
            ? "Positive reply"
            : j === 2 && d % 7 === 0
              ? "Meeting booked"
              : "Message sent";
      activities.push({
        id: `sample-${d}-${j}`,
        lead_id: leads[i].id,
        channel: channels[(d + j) % 3],
        kind,
        message:
          kind === "Message sent"
            ? `Hi ${leads[i].name.split(" ")[0]}, I noticed ${leads[i].company} is growing. Would you be open to a conversation about reaching your next customers?`
            : kind === "Meeting booked"
              ? "Discovery call scheduled to discuss goals and next steps."
              : "Thanks for reaching out. This looks relevant to our plans — could you share a little more?",
        occurred_at: new Date(
          Date.now() - d * 86400000 - j * 47 * 60000,
        ).toISOString(),
      });
    }
  return {
    leads,
    activities,
    deals: [
      {
        id: "deal-1",
        lead_id: "demo-0",
        title: "Northstar · Growth partnership",
        value: 4500,
        currency: "USD",
        status: "open",
        stage: "Qualified",
      },
      {
        id: "deal-2",
        lead_id: "demo-1",
        title: "Layers · Lead generation",
        value: 6000,
        currency: "USD",
        status: "open",
        stage: "Proposal",
      },
      {
        id: "deal-3",
        lead_id: "demo-4",
        title: "Forma · Outreach campaign",
        value: 3200,
        currency: "USD",
        status: "open",
        stage: "Qualified",
      },
      {
        id: "deal-4",
        lead_id: "demo-7",
        title: "CloudWatch · Growth retainer",
        value: 5000,
        currency: "USD",
        status: "won",
        stage: "Won",
      },
    ],
  };
}
export function metrics(
  data: Dataset,
  channel: string,
  days: number,
  now = Date.now(),
) {
  const events = data.activities.filter(
    (a) =>
      (channel === "All channels" || a.channel === channel) &&
      Date.parse(a.occurred_at) >= now - days * 86400000 &&
      Date.parse(a.occurred_at) <= now,
  );
  const sent = events.filter((a) =>
    ["Message sent", "Connection requested"].includes(a.kind),
  );
  const replies = events.filter((a) =>
    ["Reply received", "Positive reply"].includes(a.kind),
  );
  const contacted = new Set(sent.map((a) => a.lead_id));
  const replied = new Set(
    replies.filter((a) => contacted.has(a.lead_id)).map((a) => a.lead_id),
  );
  return {
    events,
    sent,
    replies,
    contacted: contacted.size,
    replyRate: contacted.size
      ? Math.round((replied.size / contacted.size) * 100)
      : 0,
    meetings: events.filter((a) => a.kind === "Meeting booked").length,
  };
}
export function parseCSV(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (quoted) quoted = false;
      else if (!field) quoted = true;
      else throw new Error("Unexpected quote in CSV.");
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("A quoted field is not closed.");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  const headers = (rows.shift() || []).map((h) =>
    h
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase(),
  );
  if (new Set(headers).size !== headers.length)
    throw new Error("CSV column names must be unique.");
  return rows.map((r, i) => {
    if (r.length !== headers.length)
      throw new Error(
        `Row ${i + 2} has ${r.length} columns; expected ${headers.length}.`,
      );
    return Object.fromEntries(headers.map((h, j) => [h, r[j].trim()]));
  });
}
export function csvExport(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+@\-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  return [keys, ...rows.map((r) => keys.map((k) => r[k]))]
    .map((r) => r.map(cell).join(","))
    .join("\r\n");
}
