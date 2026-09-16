"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Picker, download } from "./outreach-controls";
import { type Lead, channels, kinds, statuses, parseCSV } from "@/lib/outreach";
import { leadInput, importRow } from "@/lib/validation";
type Props = {
  type: string | null;
  close: () => void;
  leads: Lead[];
  demo: boolean;
  save: (body: any) => Promise<void>;
  initialLead?: string;
};
export function OutreachForm({
  type,
  close,
  leads,
  demo,
  save,
  initialLead,
}: Props) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [channel, setChannel] = useState("LinkedIn");
  const [kind, setKind] = useState("Message sent");
  const [status, setStatus] = useState("New");
  const [leadId, setLeadId] = useState(initialLead || leads[0]?.id || "");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [filename, setFilename] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(e.currentTarget));
      if (type === "lead") {
        const parsed = leadInput.safeParse({ ...values, status });
        if (!parsed.success)
          throw new Error(parsed.error.issues.map((i) => i.message).join(" "));
        await save({ action: "lead", lead: parsed.data });
      } else if (type === "activity") {
        if (!leadId) throw new Error("Add a lead first.");
        const date = new Date(String(values.occurred_at));
        if (
          !Number.isFinite(date.valueOf()) ||
          date.valueOf() > Date.now() + 60000
        )
          throw new Error(
            "Choose a valid activity time that is not in the future.",
          );
        await save({
          action: "activity",
          activity: {
            lead_id: leadId,
            channel,
            kind,
            message: String(values.message).trim(),
            occurred_at: date.toISOString(),
          },
        });
      } else if (type === "import") {
        if (!rows.length) throw new Error("Choose a CSV file first.");
        await save({ action: "import", rows });
      }
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  async function read(file?: File) {
    setRows([]);
    setError("");
    if (!file) return;
    setFilename(file.name);
    try {
      if (file.size > 2_000_000)
        throw new Error("Please choose a CSV smaller than 2 MB.");
      const parsed = parseCSV(await file.text());
      if (!parsed.length || parsed.length > 500)
        throw new Error("Import between 1 and 500 rows at a time.");
      const errors = parsed.flatMap((r, i) => {
        const check = importRow.safeParse(r);
        return check.success
          ? []
          : [
              `Row ${i + 2}: ${check.error.issues.map((e) => e.message).join(" ")}`,
            ];
      });
      if (errors.length) throw new Error(errors.slice(0, 6).join("\n"));
      setRows(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read CSV.");
    }
  }
  const localDate = new Date(
    Date.now() - new Date().getTimezoneOffset() * 60000,
  )
    .toISOString()
    .slice(0, 16);
  return (
    <Dialog
      open={!!type}
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className={type === "import" ? "import-dialog" : ""}>
        <DialogHeader>
          <DialogTitle>
            {type === "lead"
              ? "Add a new lead"
              : type === "activity"
                ? "Log an outreach activity"
                : "Import your outreach"}
          </DialogTitle>
          <DialogDescription>
            {demo
              ? "Demo mode: changes are temporary and reset when you reload."
              : type === "import"
                ? "Review your CSV before saving it to the workspace."
                : "Add the details your client needs to see."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="form-stack">
          {type === "lead" ? (
            <>
              <div className="form-grid">
                <label>
                  Full name
                  <input
                    name="name"
                    required
                    maxLength={250}
                    placeholder="Alex Morgan"
                  />
                </label>
                <label>
                  Company
                  <input
                    name="company"
                    maxLength={250}
                    placeholder="Northstar"
                  />
                </label>
              </div>
              <label>
                Position
                <input name="position" maxLength={250} placeholder="Founder" />
              </label>
              <div className="form-grid">
                <label>
                  Email
                  <input
                    type="email"
                    name="email"
                    maxLength={254}
                    placeholder="alex@company.com"
                  />
                </label>
                <label>
                  Phone
                  <input name="phone" maxLength={40} placeholder="+91…" />
                </label>
              </div>
              <label>
                LinkedIn profile
                <input
                  type="url"
                  name="linkedin_url"
                  maxLength={500}
                  placeholder="https://www.linkedin.com/in/…"
                />
              </label>
              <div className="form-grid">
                <label>
                  Status
                  <Picker
                    label="Lead status"
                    value={status}
                    onChange={setStatus}
                    options={statuses}
                  />
                </label>
                <label>
                  Owner
                  <input
                    name="owner"
                    defaultValue="Your agency"
                    maxLength={250}
                  />
                </label>
              </div>
              <small className="subtle">
                Include at least one contact method.
              </small>
            </>
          ) : type === "activity" ? (
            <>
              <label>
                Lead
                <Select value={leadId} onValueChange={setLeadId}>
                  <SelectTrigger aria-label="Activity lead">
                    <SelectValue placeholder="Select a lead" />
                  </SelectTrigger>
                  <SelectContent>
                    {leads.map((l) => (
                      <SelectItem value={l.id} key={l.id}>
                        {l.name} · {l.company}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="form-grid">
                <label>
                  Channel
                  <Picker
                    label="Activity channel"
                    value={channel}
                    onChange={setChannel}
                    options={[...channels, "Pipedrive"]}
                  />
                </label>
                <label>
                  Activity
                  <Picker
                    label="Activity type"
                    value={kind}
                    onChange={setKind}
                    options={kinds}
                  />
                </label>
              </div>
              <label>
                When
                <input
                  name="occurred_at"
                  type="datetime-local"
                  required
                  defaultValue={localDate}
                />
              </label>
              <label>
                Message or notes
                <textarea
                  required
                  name="message"
                  rows={5}
                  maxLength={10000}
                  placeholder="What did you send, or what did they say?"
                />
              </label>
            </>
          ) : (
            <>
              <div className="import-instructions">
                <p>
                  Required columns: <b>name, email</b>. Optional: company,
                  position, phone, linkedin_url, status, owner.
                </p>
                <p>
                  To include activity, add all four columns:{" "}
                  <b>channel, kind, message, occurred_at</b>. Use a timestamp
                  with timezone, such as 2026-09-01T09:30:00Z.
                </p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    download(
                      "outreach-template.csv",
                      'name,email,company,position,phone,linkedin_url,status,owner,channel,kind,message,occurred_at\r\nAlex Morgan,alex@example.com,Northstar,Founder,,,Contacted,Your agency,LinkedIn,Message sent,"Hello Alex, would you be open to a conversation?",2026-09-01T09:30:00Z',
                    )
                  }
                >
                  Download CSV template ↗
                </button>
              </div>
              <label className="upload-zone">
                Choose your CSV
                <input
                  aria-label="Choose CSV file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => void read(e.target.files?.[0])}
                />
                <small>Up to 500 rows · 2 MB</small>
              </label>
              {rows.length > 0 && (
                <>
                  <p className="subtle">
                    {filename} · {rows.length} valid rows · previewing first 5
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Channel</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 5).map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{r.name}</TableCell>
                          <TableCell>{r.email}</TableCell>
                          <TableCell>{r.channel || "Lead only"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  <small className="subtle">
                    Existing contacts are matched by email. Existing statuses
                    are preserved. Identical timestamped activities are skipped.
                  </small>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={busy || (type === "import" && !rows.length)}
            >
              {busy
                ? "Saving…"
                : type === "lead"
                  ? "Add lead"
                  : type === "activity"
                    ? "Save activity"
                    : `Import ${rows.length || ""} rows`}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
