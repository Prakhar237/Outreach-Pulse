"use client";
import { ArrowUpRight } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { Activity, Lead } from "@/lib/outreach";

function field(value: unknown) { return typeof value === "string" ? value : ""; }
function websiteLink(value: string) {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export function MeetingsSheet({ open, onOpenChange, meetings, leads }: {
  open: boolean; onOpenChange: (open: boolean) => void; meetings: Activity[]; leads: Lead[];
}) {
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent className="lead-sheet meetings-sheet">
      <SheetHeader>
        <SheetTitle>Meetings booked ({meetings.length})</SheetTitle>
        <SheetDescription>Client details and sales preparation for the selected date and channel filters.</SheetDescription>
      </SheetHeader>
      <div className="meeting-list">
        {!meetings.length && <p className="empty-timeline">No meetings booked in this selection.</p>}
        {[...meetings].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).map((meeting, index) => {
          const lead = leads.find((item) => item.id === meeting.lead_id);
          const raw = lead?.source_data?.meeting_brief;
          const brief = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
          const website = field(brief.website);
          const href = website ? websiteLink(website) : undefined;
          return <article className="meeting-card" key={meeting.id}>
            <p className="eyebrow">MEETING {index + 1}</p>
            <h2>{lead?.name || "Client details unavailable"}</h2>
            <dl>
              <div><dt>Client name</dt><dd>{lead?.name || "—"}</dd></div>
              <div><dt>Company</dt><dd>{lead?.company || "—"}</dd></div>
              {website && <div><dt>Website</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{website.replace(/^https?:\/\//i, "").replace(/\/$/, "")} <ArrowUpRight size={14} aria-hidden="true" /></a> : website}</dd></div>}
              {field(brief.overview) && <div><dt>Basic overview</dt><dd>{field(brief.overview)}</dd></div>}
              {field(brief.selling_pitch) && <div><dt>Selling pitch</dt><dd>{field(brief.selling_pitch)}</dd></div>}
              {field(brief.fallback_offer) && <div><dt>Fallback offer</dt><dd>{field(brief.fallback_offer)}</dd></div>}
              {!field(brief.overview) && <div><dt>Meeting notes</dt><dd>{meeting.message || "No notes added yet."}</dd></div>}
            </dl>
            <p className="meeting-recorded">Booking logged {new Date(meeting.occurred_at).toLocaleDateString()} · {meeting.channel}</p>
          </article>;
        })}
      </div>
    </SheetContent>
  </Sheet>;
}
