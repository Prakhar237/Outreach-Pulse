"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Download,
  Layers,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Plus,
  Plug,
  RefreshCw,
  Search,
  Upload,
  Users,
  Workflow,
} from "lucide-react";
import {
  Sidebar,
  SidebarProvider,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Toaster, toast } from "sonner";
import {
  metrics,
  channels,
  statuses,
  csvExport,
  type Dataset,
  type Lead,
  type Activity,
} from "@/lib/outreach";
import {
  api,
  Picker,
  ChannelMark,
  download,
} from "@/components/outreach-controls";
import { OutreachForm } from "@/components/outreach-forms";
import { Connections } from "@/components/outreach-connections";
const nav = [
  ["Overview", LayoutDashboard],
  ["Leads", Users],
  ["Activity", ActivityIcon],
  ["Pipeline", Workflow],
  ["Connections", Plug],
] as const;
const empty: Dataset = { leads: [], activities: [], deals: [] };
const colors = ["#17836b", "#78a3cf", "#b7c777"];
function businessName(lead: Lead) {
  const business = lead.source_data?.business_name;
  return typeof business === "string" && business.trim()
    ? business.trim()
    : lead.company || "—";
}
function linkedInProfile(value: string) {
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com"))
      ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((s) => s[0])
    .join("");
}
function formatDate(date: string) {
  return new Date(date).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function statusClass(status: string) {
  return "status " + status.toLowerCase().replace(/ /g, "-");
}
function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return currency + " " + value.toLocaleString();
  }
}
function LeadName({ lead, onClick }: { lead: Lead; onClick: () => void }) {
  return (
    <button className="lead-cell lead-button" onClick={onClick}>
      <span className="avatar">{initials(lead.name)}</span>
      <span>
        <b>{lead.name}</b>
        <small>
          {[lead.company, lead.position].filter(Boolean).join(" · ") ||
            lead.email ||
            lead.phone}
        </small>
      </span>
    </button>
  );
}
export default function Dashboard() {
  const [data, setData] = useState<Dataset>(empty);
  const [mode, setMode] = useState("loading");
  const [admin, setAdmin] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("Overview");
  const [channel, setChannel] = useState("All channels");
  const [period, setPeriod] = useState("Last 30 days");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<string | null>(null);
  const [initialLead, setInitialLead] = useState("");
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await api("/api/dashboard");
      setData({ leads: r.leads, activities: r.activities, deals: r.deals });
      setMode(r.mode);
      setAdmin(r.admin);
      setNow(Date.now());
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your workspace could not load.",
      );
      setData(empty);
      setMode("error");
      setAdmin(false);
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const result = new URLSearchParams(window.location.search).get(
      "connection",
    );
    if (result) {
      setView("Connections");
      if (result === "outlook_connected")
        toast.success(
          "Outlook connected. Categorize your outreach, then sync.",
        );
      else
        toast.error(
          result === "outlook_cancelled"
            ? "Microsoft connection was cancelled."
            : "Microsoft connection failed. Check your Microsoft app settings and try again.",
        );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [refresh]);
  useEffect(() => {
    if (mode !== "live") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !form) void refresh();
    }, 60000);
    return () => clearInterval(id);
  }, [mode, form, refresh]);
  const navigate = useCallback((name: string) => {
    setView(name);
    setSearch("");
    setPage(1);
    setChannel("All channels");
    setStatusFilter("All statuses");
  }, []);
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => Promise<void>;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: "navigate_outreach_dashboard",
          title: "Open an outreach view",
          description:
            "Navigate to Overview, Leads, Activity, Pipeline, or Connections. Does not change outreach records.",
          inputSchema: {
            type: "object",
            properties: {
              view: { type: "string", enum: nav.map((n) => n[0]) },
            },
            required: ["view"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          execute: (input: unknown) => {
            const value = input as { view?: string };
            if (
              !value ||
              !nav.some((n) => n[0] === value.view) ||
              Object.keys(value).some((k) => k !== "view")
            )
              throw new Error("Choose a valid dashboard view.");
            navigate(value.view!);
            return { view: value.view };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, [navigate]);
  const days = Number(period.match(/\d+/)?.[0] || 30);
  const m = useMemo(
    () => metrics(data, channel, days, now),
    [data, channel, days, now],
  );
  const leadMap = useMemo(
    () => new Map(data.leads.map((l) => [l.id, l])),
    [data.leads],
  );
  const query = search.toLowerCase();
  const matchingLead = (l: Lead) =>
    [l.name, l.company, businessName(l), l.email, l.phone, l.owner]
      .join(" ")
      .toLowerCase()
      .includes(query) &&
    (statusFilter === "All statuses" || l.status === statusFilter);
  const feed = [...m.events]
    .filter((a) => {
      const l = leadMap.get(a.lead_id);
      return l && matchingLead(l);
    })
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const filteredLeads = data.leads
    .filter(
      (l) =>
        matchingLead(l) &&
        (channel === "All channels" ||
          m.events.some((a) => a.lead_id === l.id)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const selectedLead = selected ? leadMap.get(selected) : undefined;
  const timeline = selected
    ? data.activities
        .filter((a) => a.lead_id === selected)
        .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    : [];
  const chartDays = Math.min(days, 14);
  const chart = Array.from({ length: chartDays }, (_, i) => ({
    date: new Date(now - (chartDays - 1 - i) * 86400000),
    counts: channels.map(
      (c) =>
        m.events.filter(
          (a) =>
            a.channel === c &&
            Math.floor((now - Date.parse(a.occurred_at)) / 86400000) ===
              chartDays - 1 - i,
        ).length,
    ),
  }));
  const max = Math.max(1, ...chart.flatMap((d) => d.counts));
  const sentCounts = channels.map(
    (c) => m.sent.filter((a) => a.channel === c).length,
  );
  const sentTotal = sentCounts.reduce((s, n) => s + n, 0);
  const first = sentTotal ? (sentCounts[0] / sentTotal) * 100 : 0;
  const second = sentTotal
    ? ((sentCounts[0] + sentCounts[1]) / sentTotal) * 100
    : 0;
  const rows = view === "Leads" ? filteredLeads : feed;
  const pageCount = Math.max(1, Math.ceil(rows.length / 10));
  const currentPage = Math.min(page, pageCount);
  const pipeline = data.deals.filter(
    (d) =>
      d.title.toLowerCase().includes(query) ||
      (d.lead_id && leadMap.get(d.lead_id)?.name.toLowerCase().includes(query)),
  );
  const currencies = Array.from(new Set(pipeline.map((d) => d.currency)));
  function openForm(type: string, leadId = "") {
    setInitialLead(leadId);
    setForm(type);
  }
  async function save(body: any) {
    if (mode !== "demo") {
      await api("/api/dashboard", body);
      await refresh();
    } else {
      const next: Dataset = {
        leads: [...data.leads],
        activities: [...data.activities],
        deals: [...data.deals],
      };
      const addLead = (value: Record<string, string>) => {
        const exists = next.leads.find((l) =>
          value.email
            ? l.email.toLowerCase() === value.email.toLowerCase()
            : value.phone
              ? l.phone === value.phone
              : l.linkedin_url === value.linkedin_url,
        );
        if (exists) return exists;
        const lead = {
          id: crypto.randomUUID(),
          name: value.name,
          company: value.company || "",
          position: value.position || "",
          email: value.email || "",
          phone: value.phone || "",
          linkedin_url: value.linkedin_url || "",
          status: value.status || "New",
          owner: value.owner || "Your agency",
          created_at: new Date().toISOString(),
        };
        next.leads.push(lead);
        return lead;
      };
      if (body.action === "lead") addLead(body.lead);
      if (body.action === "activity")
        next.activities.push({ ...body.activity, id: crypto.randomUUID() });
      if (body.action === "status")
        next.leads = next.leads.map((l) =>
          l.id === body.id ? { ...l, status: body.status } : l,
        );
      if (body.action === "import")
        for (const row of body.rows) {
          const l = addLead(row);
          if (
            row.channel &&
            !next.activities.some(
              (a) =>
                a.lead_id === l.id &&
                a.channel === row.channel &&
                a.kind === row.kind &&
                a.message === row.message &&
                Date.parse(a.occurred_at) === Date.parse(row.occurred_at),
            )
          )
            next.activities.push({
              id: crypto.randomUUID(),
              lead_id: l.id,
              channel: row.channel,
              kind: row.kind,
              message: row.message,
              occurred_at: new Date(row.occurred_at).toISOString(),
            });
        }
      setData(next);
      setNow(Date.now());
    }
    toast.success(
      mode === "demo"
        ? "Added to this demo session. Reloading resets sample changes."
        : "Saved to your workspace.",
    );
  }
  function exportData() {
    let exported: Record<string, unknown>[];
    if (view === "Leads")
      exported = filteredLeads.map((l) => ({
        name: l.name,
        email: l.email,
        company: l.company,
        position: l.position,
        phone: l.phone,
        linkedin_url: l.linkedin_url,
        status: l.status,
        owner: l.owner,
        business_name: businessName(l),
      }));
    else if (view === "Pipeline")
      exported = pipeline.map((d) => ({
        title: d.title,
        lead: leadMap.get(d.lead_id || "")?.name || "",
        value: d.value,
        currency: d.currency,
        status: d.status,
        stage: d.stage,
      }));
    else
      exported = feed.map((a) => {
        const l = leadMap.get(a.lead_id)!;
        return {
          name: l.name,
          email: l.email,
          company: l.company,
          channel: a.channel,
          kind: a.kind,
          message: a.message,
          occurred_at: a.occurred_at,
        };
      });
    if (!exported.length) {
      toast.info("There are no matching records to export.");
      return;
    }
    download(
      `pulse-${mode === "demo" ? "sample-" : ""}${view.toLowerCase()}.csv`,
      csvExport(exported),
    );
    toast.success(`Exported ${exported.length} records.`);
  }
  const canWrite = admin && mode !== "loading" && mode !== "error";
  return (
    <SidebarProvider>
      <Toaster position="bottom-right" richColors />
      <Sidebar className="pulse-sidebar">
        <SidebarHeader>
          <a className="brand" href="/">
            <span className="brand-symbol">
              <ActivityIcon size={23} />
            </span>
            pulse<span className="brand-period">.</span>
          </a>
          <div className="workspace">
            <span className="workspace-logo">Y</span>
            <div>
              <b>Your workspace</b>
              <small>Client outreach</small>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">WORKSPACE</div>
          <SidebarMenu>
            {nav
              .filter(([name]) => name !== "Connections" || admin)
              .map(([name, Icon]) => (
                <SidebarMenuItem key={name}>
                  <SidebarMenuButton
                    isActive={view === name}
                    onClick={() => navigate(name)}
                  >
                    <Icon />
                    <span>{name}</span>
                    {name === view && <span className="nav-active" />}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-note">
            <Layers size={21} />
            <b>
              Every conversation.
              <br />
              One clear picture.
            </b>
            <p>Your outreach, connected.</p>
          </div>
          <div className="profile">
            <span className="avatar">{admin ? "YA" : "CV"}</span>
            <div>
              <b>{admin ? "Your agency" : "Client view"}</b>
              <small>
                {mode === "demo"
                  ? "Exploring sample data"
                  : admin
                    ? "Shared workspace"
                    : "View-only access"}
              </small>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="main">
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <span>Workspace</span>
            <ChevronRight size={14} />
            <b>{view}</b>
          </div>
          <div>
            <button
              className="icon-button"
              aria-label="Refresh dashboard"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} className={refreshing ? "spin" : ""} />
            </button>
            <span className={mode === "demo" ? "demo-pill" : "live-pill"}>
              {mode === "loading"
                ? "Loading workspace…"
                : mode === "demo"
                  ? "Demo workspace"
                  : mode === "error"
                    ? "Connection unavailable"
                    : admin
                      ? "Live workspace"
                      : "Client view · read only"}
            </span>
          </div>
        </header>
        <div className="page">
          <section className="heading">
            <div>
              <div className="eyebrow">YOUR OUTREACH, AT A GLANCE</div>
              <h1>
                {view === "Overview"
                  ? "A little outreach. A lot of possibility."
                  : view === "Leads"
                    ? "People, before pipelines."
                    : view === "Activity"
                      ? "Every conversation has a story."
                      : view === "Pipeline"
                        ? "From first hello to what’s next."
                        : "Bring it all together."}
              </h1>
              <p>
                {view === "Leads"
                  ? "Your complete lead directory, with one timeline for every relationship."
                  : view === "Pipeline"
                    ? "Your current deal snapshot from Pipedrive, organized by stage."
                    : "Every lead, every channel, every next step. All in one place."}
              </p>
            </div>
            {canWrite && view !== "Connections" && (
              <div className="heading-actions">
                {view === "Leads" && (
                  <button className="button" onClick={() => openForm("import")}>
                    <Upload size={16} /> Import CSV
                  </button>
                )}
                <button
                  className="button primary"
                  onClick={() =>
                    openForm(view === "Leads" ? "lead" : "activity")
                  }
                >
                  <Plus size={17} />
                  {view === "Leads" ? "Add lead" : "Log activity"}
                </button>
              </div>
            )}
          </section>
          {error && (
            <div className="error-message" role="alert">
              {error}{" "}
              <button className="text-button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          )}
          {mode === "loading" ? (
            <div className="loading-grid" aria-label="Loading dashboard">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-72 col-span-2" />
            </div>
          ) : view === "Connections" && admin ? (
            <Connections
              demo={mode === "demo"}
              refresh={refresh}
              openImport={() => openForm("import")}
              openLog={() => openForm("activity")}
            />
          ) : (
            <>
              {view !== "Pipeline" && (
                <div className="toolbar">
                  <Tabs
                    value={channel}
                    onValueChange={(v) => {
                      setChannel(v);
                      setPage(1);
                    }}
                  >
                    <TabsList className="channel-tabs">
                      {["All channels", ...channels].map((c) => (
                        <TabsTrigger key={c} value={c}>
                          {c !== "All channels" && <ChannelMark channel={c} />}{" "}
                          {c}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <div className="toolbar-right">
                    <CalendarDays size={16} />
                    <Picker
                      label="Date range"
                      value={period}
                      onChange={(v) => {
                        setPeriod(v);
                        setPage(1);
                      }}
                      options={[
                        "Last 7 days",
                        "Last 14 days",
                        "Last 30 days",
                        "Last 90 days",
                      ]}
                    />
                    <button className="button" onClick={exportData}>
                      <Download size={16} /> Export
                    </button>
                  </div>
                </div>
              )}
              {(view === "Overview" || view === "Activity") && (
                <div className="stats">
                  {[
                    {
                      title: "Leads contacted",
                      value: m.contacted,
                      sub: "Distinct people reached",
                      icon: Users,
                    },
                    {
                      title: "Messages sent",
                      value: m.sent.length,
                      sub: "Messages + connection requests",
                      icon: Mail,
                    },
                    {
                      title: "Reply rate",
                      value: m.replyRate + "%",
                      sub: "Contacted leads who replied",
                      icon: MessageCircle,
                    },
                    {
                      title: "Meetings booked",
                      value: m.meetings,
                      sub: "Recorded booking activities",
                      icon: CalendarDays,
                    },
                  ].map(({ title, value, sub, icon: Icon }) => (
                    <div className="stat" key={title}>
                      <div>
                        <span>{title}</span>
                        <Icon size={18} />
                      </div>
                      <strong>{value}</strong>
                      <small>{sub}</small>
                    </div>
                  ))}
                </div>
              )}
              {view === "Overview" && (
                <div className="charts">
                  <section className="card activity-chart">
                    <div className="card-heading">
                      <div>
                        <h2>Outreach momentum</h2>
                        <p>Small steps. Meaningful connections.</p>
                      </div>
                      <span className="subtle">Last {chartDays} days</span>
                    </div>
                    <div className="chart-legend">
                      {channels.map((c) => (
                        <span key={c}>
                          <i className={c.toLowerCase()} />
                          {c}
                        </span>
                      ))}
                    </div>
                    <div
                      className="bar-chart"
                      aria-label="Outreach activities by day"
                    >
                      {chart.map((day, i) => (
                        <div className="bar-group" key={i}>
                          {day.counts.map((n, j) => (
                            <div
                              title={`${day.date.toLocaleDateString()}: ${channels[j]}, ${n} activities`}
                              key={j}
                              className={"bar " + channels[j].toLowerCase()}
                              style={{ height: (n / max) * 150 + "px" }}
                            />
                          ))}
                          <small>{day.date.getDate()}</small>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="card channel-card">
                    <div className="card-heading">
                      <div>
                        <h2>The channel mix</h2>
                        <p>How you’re starting conversations</p>
                      </div>
                    </div>
                    <div
                      className="donut"
                      aria-label={channels
                        .map((c, i) => `${c}: ${sentCounts[i]}`)
                        .join(", ")}
                      style={{
                        background: sentTotal
                          ? `conic-gradient(${colors[0]} 0% ${first}%, ${colors[1]} ${first}% ${second}%, ${colors[2]} ${second}% 100%)`
                          : "#eaf0ed",
                      }}
                    >
                      <div>
                        <strong>{sentTotal}</strong>
                        <span>messages sent</span>
                      </div>
                    </div>
                    {channels.map((c, i) => (
                      <div className="channel-summary" key={c}>
                        <span>
                          <ChannelMark channel={c} />
                          {c}
                        </span>
                        <b>{sentCounts[i]}</b>
                      </div>
                    ))}
                  </section>
                </div>
              )}
              {view === "Pipeline" ? (
                <>
                  <div className="pipeline-totals">
                    <div>
                      <span className="eyebrow">OPEN PIPELINE</span>
                      <h2>
                        {currencies.length
                          ? currencies
                              .map((c) =>
                                money(
                                  pipeline
                                    .filter(
                                      (d) =>
                                        d.status === "open" && d.currency === c,
                                    )
                                    .reduce((s, d) => s + Number(d.value), 0),
                                  c,
                                ),
                              )
                              .join(" · ")
                          : "No open deals"}
                      </h2>
                      <small>
                        {pipeline.filter((d) => d.status === "open").length}{" "}
                        open deals ·{" "}
                        {pipeline.filter((d) => d.status === "won").length} won
                      </small>
                    </div>
                    <div className="toolbar-right">
                      <div className="search">
                        <Search size={16} />
                        <input
                          aria-label="Search deals"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          placeholder="Search a deal or lead…"
                        />
                      </div>
                      <button className="button" onClick={exportData}>
                        <Download size={16} /> Export
                      </button>
                    </div>
                  </div>
                  <div className="pipeline-board">
                    {Array.from(
                      new Set(
                        pipeline.map((d) =>
                          d.status === "open"
                            ? d.stage || "Open"
                            : d.status === "won"
                              ? "Won"
                              : "Lost",
                        ),
                      ),
                    ).map((stage) => {
                      const deals = pipeline.filter(
                        (d) =>
                          (d.status === "open"
                            ? d.stage || "Open"
                            : d.status === "won"
                              ? "Won"
                              : "Lost") === stage,
                      );
                      return (
                        <section className="pipeline-column" key={stage}>
                          <h2>
                            {stage}
                            <span className="count">{deals.length}</span>
                          </h2>
                          {deals.map((d) => (
                            <article className="card deal-card" key={d.id}>
                              <span className={statusClass(d.status)}>
                                {d.status}
                              </span>
                              <h3>{d.title}</h3>
                              <strong>
                                {money(Number(d.value), d.currency)}
                              </strong>
                              {d.lead_id && leadMap.get(d.lead_id) && (
                                <LeadName
                                  lead={leadMap.get(d.lead_id)!}
                                  onClick={() => setSelected(d.lead_id)}
                                />
                              )}
                            </article>
                          ))}
                        </section>
                      );
                    })}
                  </div>
                  {!pipeline.length && (
                    <div className="empty-state">
                      <Workflow />
                      <h2>No deals to show yet</h2>
                      <p>
                        {search
                          ? "Try another search."
                          : "Connect Pipedrive and sync your current pipeline."}
                      </p>
                      {admin && (
                        <button
                          className="button"
                          onClick={() => navigate("Connections")}
                        >
                          Go to connections
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <section className="card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        {view === "Overview"
                          ? "Latest conversations"
                          : view === "Leads"
                            ? "Your lead directory"
                            : "Outreach activity"}{" "}
                        <span className="count">{rows.length}</span>
                      </h2>
                      <p>
                        {view === "Leads"
                          ? "Select a person to see their complete outreach history."
                          : "A shared window into your team’s work."}
                      </p>
                    </div>
                    <div className="list-controls">
                      {view !== "Overview" && (
                        <Picker
                          value={statusFilter}
                          onChange={(v) => {
                            setStatusFilter(v);
                            setPage(1);
                          }}
                          label="Filter by status"
                          options={["All statuses", ...statuses]}
                        />
                      )}
                      <div className="search">
                        <Search size={16} />
                        <input
                          aria-label="Search leads"
                          placeholder="Search a name or company…"
                          value={search}
                          onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {(view === "Leads"
                          ? [
                              "LEAD",
                              "CONTACT",
                              "CHANNELS",
                              "LINKEDIN",
                              "STATUS",
                              "OWNER",
                              "",
                            ]
                          : [
                              "LEAD",
                              "CHANNEL",
                              "LATEST ACTIVITY",
                              "STATUS",
                              "WHEN",
                              "",
                            ]
                        ).map((h, i) => (
                          <TableHead key={i}>{h}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view === "Leads"
                        ? filteredLeads
                            .slice((currentPage - 1) * 10, currentPage * 10)
                            .map((l) => (
                              <TableRow key={l.id}>
                                <TableCell>
                                  <LeadName
                                    lead={l}
                                    onClick={() => setSelected(l.id)}
                                  />
                                </TableCell>
                                <TableCell>
                                  {l.email || l.phone || "LinkedIn profile"}
                                </TableCell>
                                <TableCell>
                                  <div className="channel-group">
                                    {Array.from(
                                      new Set(
                                        data.activities
                                          .filter((a) => a.lead_id === l.id)
                                          .map((a) => a.channel),
                                      ),
                                    ).map((c) => (
                                      <span title={c} key={c}>
                                        <ChannelMark channel={c} />
                                      </span>
                                    ))}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  {linkedInProfile(l.linkedin_url) ? (
                                    <a
                                      className="linkedin-profile-link"
                                      href={linkedInProfile(l.linkedin_url)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={`LinkedIn profile for ${l.name} (opens in a new tab)`}
                                    >
                                      Linkedin <ArrowUpRight size={14} aria-hidden="true" />
                                    </a>
                                  ) : "—"}
                                </TableCell>
                                <TableCell>
                                  <span className={statusClass(l.status)}>
                                    {l.status}
                                  </span>
                                </TableCell>
                                <TableCell>{businessName(l)}</TableCell>
                                <TableCell>
                                  <button
                                    className="icon-button"
                                    aria-label={"View " + l.name}
                                    onClick={() => setSelected(l.id)}
                                  >
                                    <ArrowUpRight size={17} />
                                  </button>
                                </TableCell>
                              </TableRow>
                            ))
                        : feed
                            .slice(
                              view === "Overview" ? 0 : (currentPage - 1) * 10,
                              view === "Overview" ? 5 : currentPage * 10,
                            )
                            .map((a) => {
                              const l = leadMap.get(a.lead_id)!;
                              return (
                                <TableRow key={a.id}>
                                  <TableCell>
                                    <LeadName
                                      lead={l}
                                      onClick={() => setSelected(l.id)}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    <span className="inline-channel">
                                      <ChannelMark channel={a.channel} />
                                      {a.channel}
                                    </span>
                                  </TableCell>
                                  <TableCell>{a.kind}</TableCell>
                                  <TableCell>
                                    <span className={statusClass(l.status)}>
                                      {l.status}
                                    </span>
                                  </TableCell>
                                  <TableCell className="subtle">
                                    {formatDate(a.occurred_at)}
                                  </TableCell>
                                  <TableCell>
                                    <button
                                      className="icon-button"
                                      aria-label={"View " + l.name}
                                      onClick={() => setSelected(l.id)}
                                    >
                                      <ArrowUpRight size={17} />
                                    </button>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                    </TableBody>
                  </Table>
                  {!rows.length && (
                    <div className="empty-state">
                      <Search />
                      <h2>
                        {search ||
                        channel !== "All channels" ||
                        statusFilter !== "All statuses"
                          ? "No matching records"
                          : "Your next connection starts here"}
                      </h2>
                      <p>
                        {search
                          ? "Try a different name or company."
                          : "Add a lead, import a CSV, or connect Pipedrive to get started."}
                      </p>
                      {canWrite && (
                        <button
                          className="button"
                          onClick={() => openForm("lead")}
                        >
                          Add your first lead
                        </button>
                      )}
                    </div>
                  )}
                  {view === "Overview" ? (
                    <div className="table-footer">
                      <span>
                        Showing {Math.min(5, rows.length)} of {rows.length}{" "}
                        activities
                      </span>
                      <button
                        className="text-button"
                        onClick={() => navigate("Activity")}
                      >
                        View all activity <ChevronRight size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="table-footer">
                      <span>
                        {rows.length} records · Page {currentPage} of{" "}
                        {pageCount}
                      </span>
                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious
                              href="#"
                              aria-disabled={currentPage <= 1}
                              onClick={(e) => {
                                e.preventDefault();
                                if (currentPage > 1) setPage(currentPage - 1);
                              }}
                            />
                          </PaginationItem>
                          <PaginationItem>
                            <PaginationNext
                              href="#"
                              aria-disabled={currentPage >= pageCount}
                              onClick={(e) => {
                                e.preventDefault();
                                if (currentPage < pageCount)
                                  setPage(currentPage + 1);
                              }}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            {mode === "demo"
              ? "Sample data · Demo edits reset on reload"
              : mode === "live"
                ? "Saved data refreshes every minute · Times shown in your timezone"
                : "Your outreach workspace"}
            <span>Built for better connections.</span>
          </footer>
        </div>
      </main>
      <Sheet
        open={!!selectedLead}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="lead-sheet">
          {selectedLead && (
            <>
              <SheetHeader>
                <SheetTitle>
                  <span className="avatar large">
                    {initials(selectedLead.name)}
                  </span>
                  {selectedLead.name}
                </SheetTitle>
                <SheetDescription>
                  {[selectedLead.position, selectedLead.company]
                    .filter(Boolean)
                    .join(" at ") || "Lead profile"}
                </SheetDescription>
              </SheetHeader>
              <div className="lead-details">
                <div className="contact-details">
                  {selectedLead.email && (
                    <p>
                      <Mail size={15} />
                      {selectedLead.email}
                    </p>
                  )}
                  {selectedLead.phone && (
                    <p>
                      <MessageCircle size={15} />
                      {selectedLead.phone}
                    </p>
                  )}
                  {selectedLead.linkedin_url && (
                    <a
                      href={
                        /^https?:\/\//i.test(selectedLead.linkedin_url)
                          ? selectedLead.linkedin_url
                          : undefined
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      LinkedIn profile ↗
                    </a>
                  )}
                </div>
                <div className="lead-status-control">
                  <label>
                    Status
                    <Picker
                      label="Update lead status"
                      disabled={!canWrite || savingStatus}
                      value={selectedLead.status}
                      options={statuses}
                      onChange={async (status) => {
                        setSavingStatus(true);
                        try {
                          await save({
                            action: "status",
                            id: selectedLead.id,
                            status,
                          });
                        } catch (e) {
                          toast.error(
                            e instanceof Error
                              ? e.message
                              : "Status could not be updated",
                          );
                        } finally {
                          setSavingStatus(false);
                        }
                      }}
                    />
                  </label>
                  {canWrite && (
                    <button
                      className="button primary"
                      onClick={() => openForm("activity", selectedLead.id)}
                    >
                      <Plus size={15} /> Log activity
                    </button>
                  )}
                </div>
                <div className="timeline-heading">
                  <h2>One lead. Every touchpoint.</h2>
                  <span>{timeline.length} activities</span>
                </div>
                <div className="timeline">
                  {timeline.map((a) => (
                    <article key={a.id} className="timeline-item">
                      <ChannelMark channel={a.channel} />
                      <div>
                        <div className="timeline-meta">
                          <b>{a.kind}</b>
                          <span>{a.channel}</span>
                        </div>
                        <time>{formatDate(a.occurred_at)}</time>
                        {a.channel === "Email" && a.external_id && (
                          <small className="subtle">
                            Email preview · full message remains in your mailbox
                          </small>
                        )}
                        <p>{a.message}</p>
                      </div>
                    </article>
                  ))}
                  {!timeline.length && (
                    <p className="empty-timeline">
                      No activity yet. Log your first conversation to start the
                      story.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      {form && (
        <OutreachForm
          key={form + initialLead}
          type={form}
          close={() => setForm(null)}
          leads={data.leads}
          demo={mode === "demo"}
          save={save}
          initialLead={initialLead}
        />
      )}
    </SidebarProvider>
  );
}
