"use client";
import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { api, ChannelMark } from "./outreach-controls";
import { toast } from "sonner";
type Connection = {
  provider: string;
  account: string;
  last_sync: string | null;
  last_error: string | null;
  pending: boolean;
  label: string;
};
type Info = {
  ready: boolean;
  microsoftReady: boolean;
  encryptionReady: boolean;
  connections: Connection[];
};
export function Connections({
  demo,
  refresh,
  openImport,
  openLog,
}: {
  demo: boolean;
  refresh: () => Promise<void>;
  openImport: () => void;
  openLog: () => void;
}) {
  const [info, setInfo] = useState<Info>({
    ready: false,
    microsoftReady: false,
    encryptionReady: false,
    connections: [],
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [modal, setModal] = useState(false);
  const [disconnect, setDisconnect] = useState("");
  const [progress, setProgress] = useState("");
  async function load() {
    try {
      setInfo(await api("/api/integrations"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connections unavailable.");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function connectOutlook() {
    setBusy("outlook");
    setError("");
    try {
      const r = await api("/api/integrations", {
        action: "connect",
        provider: "outlook",
      });
      window.location.assign(r.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
      setBusy("");
    }
  }
  async function connectPipedrive(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy("pipedrive");
    setError("");
    try {
      await api("/api/integrations", {
        action: "connect",
        provider: "pipedrive",
        domain: f.get("domain"),
        token: f.get("token"),
      });
      setModal(false);
      await load();
      toast.success("Pipedrive connected. You can now sync your outreach.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy("");
    }
  }
  async function sync(provider: string) {
    setBusy(provider);
    setError("");
    setProgress("Starting sync…");
    try {
      let done = false;
      for (let i = 0; i < 100; i++) {
        const r = await api("/api/integrations", { action: "sync", provider });
        setProgress(r.message);
        if (r.done) {
          done = true;
          break;
        }
      }
      await refresh();
      await load();
      toast.success(
        done
          ? "Sync complete. Your dashboard is up to date."
          : "Progress saved. Click Resume sync to continue.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
      await load();
    } finally {
      setBusy("");
      setProgress("");
    }
  }
  async function remove(provider: string) {
    setBusy(provider);
    try {
      await api("/api/integrations", { action: "disconnect", provider });
      await load();
      toast.success(
        "Account disconnected. Your existing outreach history is retained.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy("");
      setDisconnect("");
    }
  }
  return (
    <>
      <div className="connections-intro">
        <ShieldCheck size={24} />
        <div>
          <h2>Your channels. Connected on your terms.</h2>
          <p>
            Sync the tools you already use. Keep the rest simple with manual
            updates.
          </p>
        </div>
      </div>
      {demo && (
        <div className="setup-banner">
          <div>
            <b>Ready for your Supabase project</b>
            <p>
              Connect your database to save leads and enable account
              connections. Until then, explore with sample data.
            </p>
          </div>
          <a
            className="button"
            href="/setup-guide.html"
            target="_blank"
            rel="noreferrer"
          >
            Setup guide <ExternalLink size={14} />
          </a>
        </div>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <div className="connection-grid">
        {["outlook", "pipedrive"].map((provider) => {
          const c = info.connections.find((c) => c.provider === provider);
          return (
            <section className="card connection" key={provider}>
              <div className="connection-top">
                <ChannelMark
                  channel={provider === "outlook" ? "Email" : "Pipedrive"}
                />
                <span className={"status " + (c ? "qualified" : "")}>
                  {c ? "Connected" : "Not connected"}
                </span>
              </div>
              <h2>{provider === "outlook" ? "Outlook" : "Pipedrive"}</h2>
              <p>
                {provider === "outlook"
                  ? "Read outreach emails and replies from the “Outreach” category, matched to your saved leads."
                  : "Bring your contacts, deals, stages, and CRM activities into a single workspace."}
              </p>
              <ul>
                <li>
                  <Check size={14} />{" "}
                  {provider === "outlook"
                    ? "Read-only access · no sending"
                    : "Uses your existing Pipedrive account"}
                </li>
                <li>
                  <Check size={14} />{" "}
                  {provider === "outlook"
                    ? "Subject and preview text · last 90 days"
                    : "Repeated syncs update existing records"}
                </li>
              </ul>
              {c && (
                <div className="connection-account">
                  <b>{c.account}</b>
                  <small>
                    Last complete sync:{" "}
                    {c.last_sync
                      ? new Date(c.last_sync).toLocaleString()
                      : "Not synced yet"}
                  </small>
                  {c.last_error && (
                    <p className="error-message">{c.last_error}</p>
                  )}
                </div>
              )}
              <div className="connection-actions">
                {c ? (
                  <>
                    <button
                      disabled={!!busy}
                      className="button primary"
                      onClick={() => void sync(provider)}
                    >
                      <RefreshCw
                        size={14}
                        className={busy === provider ? "spin" : ""}
                      />
                      {busy === provider
                        ? "Syncing…"
                        : c.pending
                          ? "Resume sync"
                          : "Sync now"}
                    </button>
                    <button
                      disabled={!!busy}
                      className="button"
                      aria-label={"Disconnect " + provider}
                      onClick={() => setDisconnect(provider)}
                    >
                      <Unplug size={14} />
                    </button>
                  </>
                ) : (
                  <button
                    className="button primary"
                    disabled={
                      !!busy ||
                      !info.ready ||
                      !info.encryptionReady ||
                      (provider === "outlook" && !info.microsoftReady)
                    }
                    onClick={() =>
                      provider === "outlook"
                        ? void connectOutlook()
                        : setModal(true)
                    }
                  >
                    Connect {provider === "outlook" ? "Outlook" : "Pipedrive"}{" "}
                    <ExternalLink size={14} />
                  </button>
                )}
              </div>
              {!c && (
                <small className="subtle">
                  {!info.ready
                    ? "Available after Supabase setup"
                    : !info.encryptionReady
                      ? "Integration encryption key needs configuration"
                      : provider === "outlook" && !info.microsoftReady
                        ? "Microsoft app credentials need configuration"
                        : "Account owner authorization required"}
                </small>
              )}
            </section>
          );
        })}
        {["LinkedIn", "WhatsApp"].map((channel) => (
          <section className="card connection" key={channel}>
            <div className="connection-top">
              <ChannelMark channel={channel} />
              <span className="status">Manual + CSV</span>
            </div>
            <h2>{channel}</h2>
            <p>
              {channel === "LinkedIn"
                ? "Track connection requests, messages, and replies without paying for an automation tool."
                : "Keep WhatsApp conversations visible alongside your email and LinkedIn outreach."}
            </p>
            <ul>
              <li>
                <Check size={14} /> No API subscription required
              </li>
              <li>
                <Check size={14} /> Message text and outcomes in every timeline
              </li>
            </ul>
            <div className="connection-actions">
              <button className="button" onClick={openLog}>
                Log activity
              </button>
              <button className="text-button" onClick={openImport}>
                Import CSV ↗
              </button>
            </div>
          </section>
        ))}
      </div>
      {progress && (
        <p className="sync-progress" role="status">
          {progress} Keep this page open until sync finishes.
        </p>
      )}
      <div className="connection-note">
        <b>A simple, honest sync</b>
        <p>
          Sync runs when you click “Sync now”; the client dashboard refreshes
          saved data every minute. Outlook imports only categorized messages
          that match a saved lead. LinkedIn and WhatsApp stay manual to avoid
          paid or restricted messaging integrations.
        </p>
      </div>
      <Dialog open={modal} onOpenChange={setModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect Pipedrive</DialogTitle>
            <DialogDescription>
              Find your API token under Personal preferences → API. It is
              encrypted on the server and never returned to the browser.
            </DialogDescription>
          </DialogHeader>
          <form className="form-stack" onSubmit={connectPipedrive}>
            <label>
              Company subdomain
              <input
                required
                name="domain"
                pattern="[a-z0-9][a-z0-9-]*"
                placeholder="your-company"
                autoComplete="off"
              />
              <small>For your-company.pipedrive.com, enter your-company.</small>
            </label>
            <label>
              API token
              <input
                required
                type="password"
                name="token"
                minLength={20}
                maxLength={300}
                autoComplete="new-password"
              />
            </label>
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <button className="button primary" disabled={!!busy}>
              {busy ? "Verifying account…" : "Verify and connect"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!disconnect}
        onOpenChange={(open) => {
          if (!open) setDisconnect("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect this account?</AlertDialogTitle>
            <AlertDialogDescription>
              Future syncs will stop. Your saved outreach history will remain in
              the dashboard. For Outlook, remove the app’s consent in your
              Microsoft account if you also want to revoke Microsoft access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove(disconnect)}>
              Disconnect account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
