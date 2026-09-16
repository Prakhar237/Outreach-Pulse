import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
const base = "/tmp/pulse-unit-" + process.pid;
await build({
  entryPoints: ["lib/outreach.ts", "lib/validation.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: base,
});
const { parseCSV, csvExport, metrics } = await import(
  pathToFileURL(base + "/outreach.js")
);
const { importRow, leadInput } = await import(
  pathToFileURL(base + "/validation.js")
);
test("CSV parsing accepts BOM, embedded commas, escaped quotes and multiline cells", () => {
  const rows = parseCSV(
    '\uFEFFname,email,message\r\n"Alex, Morgan",alex@example.com,"Hi ""Alex""\nWelcome"\r\n',
  );
  assert.deepEqual(rows, [
    {
      name: "Alex, Morgan",
      email: "alex@example.com",
      message: 'Hi "Alex"\nWelcome',
    },
  ]);
  assert.throws(() => parseCSV("name,email\nx,y,z"), /columns/);
  assert.throws(() => parseCSV("name,name\nx,y"), /unique/);
  assert.throws(() => parseCSV('name,email\n"x,y'), /not closed/);
});
test("CSV exports neutralize spreadsheet formulas and preserve quoted message text", () => {
  const text = csvExport([{ name: '=HYPERLINK("bad")', message: "a,\nb" }]);
  const r = parseCSV(text)[0];
  assert.equal(r.name, '\'=HYPERLINK("bad")');
  assert.equal(r.message, "a,\nb");
});
test("KPIs count distinct contacted leads and cap reply rate at 100%, with channel and time filters", () => {
  const now = Date.parse("2026-09-12T10:00:00Z");
  const a = (id, lead_id, kind, channel = "Email", age = 1) => ({
    id,
    lead_id,
    kind,
    channel,
    message: "",
    occurred_at: new Date(now - age * 86400000).toISOString(),
  });
  const data = {
    leads: [],
    deals: [],
    activities: [
      a("1", "a", "Message sent"),
      a("2", "a", "Message sent"),
      a("3", "a", "Reply received"),
      a("4", "a", "Positive reply"),
      a("5", "b", "Reply received"),
      a("6", "c", "Message sent", "LinkedIn"),
      a("7", "d", "Message sent", "Email", 60),
      a("8", "e", "Message sent", "Email", -1),
    ],
  };
  const all = metrics(data, "All channels", 30, now);
  assert.equal(all.contacted, 2);
  assert.equal(all.sent.length, 3);
  assert.equal(all.replyRate, 50);
  assert.equal(metrics(data, "Email", 30, now).replyRate, 100);
  assert.equal(
    metrics({ leads: [], activities: [], deals: [] }, "All channels", 30, now)
      .replyRate,
    0,
  );
});
test("Import validation rejects partial activities, unknown channels, future timestamps and missing contact identity", () => {
  const base = { name: "Alex", email: "alex@example.com" };
  assert.equal(importRow.safeParse(base).success, true);
  assert.equal(
    importRow.safeParse({ ...base, channel: "LinkedIn" }).success,
    false,
  );
  assert.equal(
    importRow.safeParse({
      ...base,
      channel: "Telegram",
      kind: "Message sent",
      message: "Hello",
      occurred_at: "2026-01-01T00:00:00Z",
    }).success,
    false,
  );
  assert.equal(
    importRow.safeParse({
      ...base,
      channel: "Email",
      kind: "Message sent",
      message: "Hello",
      occurred_at: "2099-01-01T00:00:00Z",
    }).success,
    false,
  );
  assert.equal(leadInput.safeParse({ name: "Alex" }).success, false);
});
// Optional embedded Postgres: PGLITE_MODULE points to an isolated test installation.
if (process.env.PGLITE_MODULE) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
  test("Supabase setup: atomic imports, deduplication, stable identities, statuses, denied browser access", async () => {
    const pg = new PGlite();
    await pg.exec(
      "create role anon; create role authenticated; create role service_role bypassrls;",
    );
    await pg.exec(await readFile("db/setup.sql", "utf8"));
    const lead = {
      name: "Alex Morgan",
      email: "alex@example.com",
      company: "Northstar",
      status: "Qualified",
      channel: "LinkedIn",
      kind: "Message sent",
      message: "Hi Alex",
      occurred_at: "2026-09-01T09:00:00Z",
    };
    const run = (rows) =>
      pg.query("select public.outreach_import($1::jsonb) as result", [
        JSON.stringify(rows),
      ]);
    await run([lead]);
    await run([
      { ...lead, status: "New", occurred_at: "2026-09-01T14:30:00+05:30" },
    ]);
    let count = await pg.query(
      "select (select count(*) from outreach_leads)::int as leads,(select count(*) from outreach_activities)::int as activities",
    );
    assert.deepEqual(count.rows[0], { leads: 1, activities: 1 });
    assert.equal(
      (await pg.query("select status from outreach_leads")).rows[0].status,
      "Qualified",
    );
    await assert.rejects(
      run([
        { name: "Another", email: "another@example.com" },
        {
          name: "Invalid",
          email: "invalid@example.com",
          channel: "Nope",
          kind: "Message sent",
          occurred_at: "2026-01-01T00:00:00Z",
          message: "x",
        },
      ]),
    );
    assert.equal(
      (await pg.query("select count(*)::int as total from outreach_leads"))
        .rows[0].total,
      1,
    );
    await run([
      {
        name: "Alex Morgan",
        email: "alex@example.com",
        external_id: "pipedrive:1",
      },
    ]);
    await run([
      {
        name: "Alex Morgan",
        email: "new@example.com",
        external_id: "pipedrive:1",
      },
    ]);
    assert.equal(
      (await pg.query("select count(*)::int as total from outreach_leads"))
        .rows[0].total,
      1,
    );
    await pg.exec("set role authenticated");
    await assert.rejects(
      pg.query("select * from outreach_integrations"),
      /permission denied/,
    );
    await assert.rejects(run([lead]), /permission denied/);
    await pg.exec("reset role; set role anon");
    await assert.rejects(
      pg.query("select * from outreach_leads"),
      /permission denied/,
    );
    await pg.exec("reset role");
    await pg.close();
  });
}

await build({
  entryPoints: ["lib/server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: base + "/server.js",
  plugins: [
    {
      name: "test-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: "settings",
          namespace: "pulse",
        }));
        builder.onResolve({ filter: /app\/chatgpt-auth/ }, () => ({
          path: "auth",
          namespace: "pulse",
        }));
        builder.onLoad({ filter: /.*/, namespace: "pulse" }, (args) => ({
          contents:
            args.path === "settings"
              ? "export const env = new Proxy({}, {get:(_, key)=>globalThis.__pulseSettings?.[key]});"
              : "export async function getChatGPTUser(){return globalThis.__pulseUser||null}",
          loader: "js",
        }));
      },
    },
  ],
});
const server = await import(pathToFileURL(base + "/server.js"));
test("Manual edition permits access without a signed-in user", async () => {
  globalThis.__pulseUser = null;
  assert.equal((await server.authorize()).admin, true);
  assert.equal((await server.authorize(true)).admin, true);
});
test("Integration tokens encrypt with distinct IVs and reject tampering", async () => {
  process.env.INTEGRATION_ENCRYPTION_KEY = "test-only-32-character-encryption-key-not-a-production-secret";
  const value = { token: "sensitive-test-token" };
  const a = await server.encrypt(value);
  const b = await server.encrypt(value);
  assert.notEqual(a, b);
  assert.ok(!a.includes(value.token));
  assert.deepEqual(await server.decrypt(a), value);
  const bytes = Buffer.from(a, "base64");
  bytes[15] ^= 1;
  await assert.rejects(server.decrypt(bytes.toString("base64")));
});
await build({
  entryPoints: ["lib/providers.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: base + "/providers.js",
  plugins: [
    {
      name: "provider-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/server$/ }, () => ({
          path: "server",
          namespace: "provider-test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "provider-test" }, () => ({
          contents: `export class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}};export const allRows=()=>Promise.resolve(globalThis.__provider.leads);export const db=(...args)=>globalThis.__provider.db(...args);export const decrypt=async x=>JSON.parse(x);export const encrypt=async x=>JSON.stringify(x);export const getIntegration=async()=>globalThis.__provider.integration;export const lock=async()=>{};export const saveIntegration=async x=>Object.assign(globalThis.__provider.integration,x);export const setting=key=>key;`,
          loader: "js",
        }));
      },
    },
  ],
});
const providers = await import(pathToFileURL(base + "/providers.js"));
test("Gmail maps outbound and inbound participants without importing unrelated leads", () => {
  const leads = [
    { id: "lead1", email: "alex@example.com" },
    { id: "lead2", email: "unknown@example.com" },
  ];
  const m = {
    id: "m1",
    internalDate: String(Date.parse("2026-09-01T10:00:00Z")),
    labelIds: ["SENT"],
    snippet: "Hi Alex",
    payload: {
      headers: [
        { name: "From", value: "Agency <agency@example.com>" },
        { name: "To", value: "Alex <alex@example.com>" },
        { name: "Subject", value: "Hello" },
      ],
    },
  };
  const out = providers.gmailActivities(m, leads, "agency@example.com");
  assert.equal(out.length, 1);
  assert.equal(out[0].lead_id, "lead1");
  assert.equal(out[0].kind, "Message sent");
  assert.equal(out[0].message, "Hello\n\nHi Alex");
  const incoming = {
    ...m,
    labelIds: ["INBOX"],
    payload: {
      headers: [
        { name: "From", value: "Alex <alex@example.com>" },
        { name: "To", value: "Agency <agency@example.com>" },
      ],
    },
  };
  assert.equal(
    providers.gmailActivities(incoming, leads, "agency@example.com")[0].kind,
    "Reply received",
  );
  assert.equal(
    providers.gmailActivities(
      {
        ...incoming,
        payload: {
          headers: [{ name: "From", value: "Other <other@example.com>" }],
        },
      },
      leads,
      "agency@example.com",
    ).length,
    0,
  );
});
test("Gmail sync saves resumable cursors, imports metadata only, and reports quota errors", async () => {
  const realFetch = globalThis.fetch;
  const writes = [];
  globalThis.__provider = {
    leads: [{ id: "lead1", email: "alex@example.com" }],
    integration: {
      provider: "gmail",
      credentials: JSON.stringify({ refresh_token: "test" }),
      account: "agency@example.com",
      settings: { label: "Outreach" },
      cursor: null,
    },
    db: async (...args) => {
      writes.push(args);
      return args[2] || [];
    },
  };
  const requested = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("oauth2")) return Response.json({ access_token: "test" });
    if (url.endsWith("/labels"))
      return Response.json({ labels: [{ id: "label1", name: "Outreach" }] });
    if (url.includes("/messages?"))
      return Response.json({
        messages: [{ id: "m1" }],
        nextPageToken: "cursor-2",
      });
    return Response.json({
      id: "m1",
      internalDate: String(Date.now()),
      labelIds: ["SENT"],
      snippet: "Hello",
      payload: { headers: [{ name: "To", value: "alex@example.com" }] },
    });
  };
  try {
    const result = await providers.syncProvider("gmail");
    assert.equal(result.done, false);
    assert.equal(
      JSON.parse(globalThis.__provider.integration.cursor).page,
      "cursor-2",
    );
    assert.equal(writes[0][2][0].lead_id, "lead1");
    assert.ok(requested.some((u) => u.includes("format=metadata")));
    assert.ok(!requested.some((u) => u.includes("format=full")));
    globalThis.fetch = async () => new Response("", { status: 429 });
    await assert.rejects(
      providers.syncProvider("gmail"),
      (e) => e.status === 429,
    );
    assert.match(globalThis.__provider.integration.last_error, /rate limit/);
    assert.equal(globalThis.__provider.integration.locked_until, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
test("Pipedrive sync progresses across persons, deals and activities and reconciles only after completion", async () => {
  const realFetch = globalThis.fetch;
  const writes = [];
  const urls = [];
  globalThis.__provider = {
    leads: [
      { id: "lead1", email: "alex@example.com", external_id: "pipedrive:10" },
    ],
    integration: {
      provider: "pipedrive",
      credentials: JSON.stringify({ token: "test-token", domain: "sample" }),
      settings: {},
      cursor: null,
    },
    db: async (...args) => {
      writes.push(args);
      return args[2] || [];
    },
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    urls.push(url.href);
    assert.equal(init.headers["x-api-token"], "test-token");
    assert.equal(url.searchParams.has("api_token"), false);
    const entity = url.pathname.split("/").pop();
    const data =
      entity === "persons"
        ? [
            {
              id: 10,
              name: "Alex Morgan",
              org_id: 3,
              emails: [{ value: "alex@example.com", primary: true }],
              phones: [],
            },
          ]
        : entity === "organizations"
          ? [{ id: 3, name: "Northstar" }]
          : entity === "stages"
            ? [{ id: 1, name: "Qualified" }]
            : entity === "deals"
              ? [
                  {
                    id: 20,
                    person_id: 10,
                    title: "Northstar growth",
                    value: 4500,
                    currency: "USD",
                    status: "open",
                    stage_id: 1,
                  },
                ]
              : [
                  {
                    id: 30,
                    person_id: 10,
                    type: "meeting",
                    subject: "Discovery",
                    add_time: "2026-09-01 10:00:00",
                    done: false,
                  },
                ];
    return Response.json({
      success: true,
      data,
      additional_data: { next_cursor: null },
    });
  };
  try {
    assert.equal((await providers.syncProvider("pipedrive")).done, false);
    assert.equal(
      JSON.parse(globalThis.__provider.integration.cursor).phase,
      "deals",
    );
    assert.equal(writes[0][2].payload[0].company, "Northstar");
    assert.equal((await providers.syncProvider("pipedrive")).done, false);
    assert.equal(writes[1][2][0].stage, "Qualified");
    assert.equal(
      writes.some((w) => w[1] === "DELETE"),
      false,
    );
    assert.equal((await providers.syncProvider("pipedrive")).done, true);
    assert.equal(writes[2][2][0].kind, "Meeting booked");
    assert.equal(writes[2][2][0].lead_id, "lead1");
    assert.equal(writes[3][1], "DELETE");
    assert.equal(globalThis.__provider.integration.cursor, null);
    assert.ok(globalThis.__provider.integration.last_sync);
    assert.ok(
      urls.every((u) => u.startsWith("https://sample.pipedrive.com/api/v2/")),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
const outlookBuildPlugin = {
  name: "outlook-test-boundaries",
  setup(builder) {
    builder.onResolve({ filter: /^\.\/server$/ }, () => ({
      path: "server",
      namespace: "outlook-test",
    }));
    builder.onLoad({ filter: /.*/, namespace: "outlook-test" }, () => ({
      contents: `export class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}};export const allRows=()=>Promise.resolve(globalThis.__outlook.leads);export const db=(...args)=>globalThis.__outlook.db(...args);export const decrypt=async x=>JSON.parse(x);export const encrypt=async x=>JSON.stringify(x);export const saveIntegration=async x=>Object.assign(globalThis.__outlook.integration,x);export const setting=key=>key==='MICROSOFT_TENANT_ID'?'common':'test-value';`,
      loader: "js",
    }));
  },
};
await build({
  entryPoints: ["lib/outlook.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: base + "/outlook.js",
  plugins: [outlookBuildPlugin],
});
const outlook = await import(pathToFileURL(base + "/outlook.js"));
test("Outlook maps categorized sent emails and replies, excluding drafts and unrelated messages", () => {
  const leads = [{ id: "lead1", email: "alex@example.com" }];
  const m = {
    id: "immutable-id",
    categories: ["Outreach"],
    from: { emailAddress: { address: "agency@example.com" } },
    toRecipients: [{ emailAddress: { address: "alex@example.com" } }],
    subject: "Hello",
    bodyPreview: "Preview text",
    sentDateTime: "2026-09-01T10:00:00Z",
    receivedDateTime: "2026-09-01T10:00:00Z",
    parentFolderId: "sent",
  };
  let rows = outlook.outlookActivities(
    m,
    leads,
    "agency@example.com",
    "account1",
    "sent",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "Message sent");
  assert.equal(rows[0].external_id, "outlook:account1:immutable-id:lead1");
  assert.equal(rows[0].message, "Hello\n\nPreview text");
  const incoming = {
    ...m,
    from: { emailAddress: { address: "alex@example.com" } },
    toRecipients: [{ emailAddress: { address: "agency@example.com" } }],
    parentFolderId: "inbox",
  };
  assert.equal(
    outlook.outlookActivities(
      incoming,
      leads,
      "agency@example.com",
      "account1",
      "sent",
    )[0].kind,
    "Reply received",
  );
  assert.equal(
    outlook.outlookActivities(
      { ...m, isDraft: true },
      leads,
      "agency@example.com",
      "account1",
      "sent",
    ).length,
    0,
  );
  assert.equal(
    outlook.outlookActivities(
      { ...m, categories: [] },
      leads,
      "agency@example.com",
      "account1",
      "sent",
    ).length,
    0,
  );
  const moved = { ...m, parentFolderId: "archive" };
  assert.equal(
    outlook.outlookActivities(
      moved,
      leads,
      "agency@example.com",
      "account1",
      "sent",
    )[0].external_id,
    rows[0].external_id,
  );
});
test("Outlook rotates refresh tokens, follows provider pagination, restricts metadata and rejects foreign next links", async () => {
  const realFetch = globalThis.fetch;
  const writes = [];
  const calls = [];
  globalThis.__outlook = {
    leads: [{ id: "lead1", email: "alex@example.com" }],
    integration: {
      provider: "outlook",
      credentials: JSON.stringify({ refresh_token: "old" }),
      account: "agency@example.com",
      settings: { category: "Outreach", account_id: "a1" },
      cursor: null,
    },
    db: async (...args) => {
      writes.push(args);
      return args[2] || [];
    },
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("login.microsoftonline.com"))
      return Response.json({
        access_token: "access",
        refresh_token: "rotated",
      });
    if (url.includes("sentitems")) return Response.json({ id: "sent" });
    return Response.json({
      value: [
        {
          id: "m1",
          categories: ["Outreach"],
          from: { emailAddress: { address: "alex@example.com" } },
          receivedDateTime: "2026-09-01T10:00:00Z",
          subject: "Interested",
          bodyPreview: "Please send details",
        },
      ],
      "@odata.nextLink":
        "https://graph.microsoft.com/v1.0/me/messages?$skip=50",
    });
  };
  try {
    const result = await outlook.syncOutlook(globalThis.__outlook.integration);
    assert.equal(result.done, false);
    assert.equal(
      JSON.parse(globalThis.__outlook.integration.credentials).refresh_token,
      "rotated",
    );
    assert.match(
      JSON.parse(globalThis.__outlook.integration.cursor).next,
      /skip=50/,
    );
    assert.equal(writes[0][2][0].kind, "Reply received");
    const messageCall = calls.find((c) => c.url.includes("/me/messages"));
    const params = new URL(messageCall.url).searchParams;
    assert.ok(params.get("$select").includes("bodyPreview"));
    assert.ok(!params.get("$select").split(",").includes("body"));
    assert.match(params.get("$filter"), /categories\/any/);
    assert.equal(messageCall.init.headers.Prefer, 'IdType="ImmutableId"');
    const before = calls.length;
    await assert.rejects(
      outlook.graph("secret", "https://evil.example/steal"),
      /unexpected/,
    );
    assert.equal(calls.length, before);
  } finally {
    globalThis.fetch = realFetch;
  }
});
