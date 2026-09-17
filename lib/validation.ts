import { z } from "zod";
import { channels, statuses, kinds } from "./outreach";
const short = z.string().trim().max(250);
export const leadInput = z
  .object({
    name: short.min(1, "Name is required"),
    company: short.default(""),
    position: short.default(""),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .email()
      .or(z.literal(""))
      .default(""),
    phone: z.string().trim().max(40).default(""),
    linkedin_url: z
      .string()
      .trim()
      .max(500)
      .url()
      .or(z.literal(""))
      .default(""),
    status: z
      .string()
      .refine((s) => statuses.includes(s), "Choose a valid status")
      .default("New"),
    owner: short.default("Your agency"),
  })
  .refine(
    (l) => l.email || l.phone || l.linkedin_url,
    "Include an email, phone number, or LinkedIn URL.",
  );
export const activityInput = z.object({
  lead_id: z.string().uuid(),
  channel: z
    .string()
    .refine(
      (s) => [...channels, "Pipedrive", "Other"].includes(s),
      "Choose a valid channel",
    ),
  kind: z.string().refine((s) => kinds.includes(s), "Choose a valid activity"),
  message: z.string().trim().min(1).max(10000),
  occurred_at: z
    .string()
    .datetime({ offset: true })
    .refine(
      (s) => Date.parse(s) <= Date.now() + 60000,
      "Activity time cannot be in the future",
    ),
});
export const importRow = z
  .object({
    name: short.min(1),
    company: short.default(""),
    position: short.default(""),
    email: z.string().trim().toLowerCase().email(),
    phone: short.default(""),
    linkedin_url: z.string().url().or(z.literal("")).default(""),
    status: z
      .string()
      .refine((s) => statuses.includes(s), "Invalid status")
      .default("New"),
    owner: short.default("Your agency"),
    channel: z
      .string()
      .refine(
        (s) => ["", ...channels, "Pipedrive", "Other"].includes(s),
        "Invalid channel",
      )
      .default(""),
    kind: z
      .string()
      .refine((s) => ["", ...kinds].includes(s), "Invalid activity kind")
      .default(""),
    message: z.string().max(10000).default(""),
    occurred_at: z.string().default(""),
  })
  .superRefine((r, ctx) => {
    if (r.channel || r.kind || r.message || r.occurred_at) {
      if (
        !r.channel ||
        !r.kind ||
        !r.message ||
        !r.occurred_at ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.occurred_at) ||
        !Number.isFinite(Date.parse(r.occurred_at)) ||
        Date.parse(r.occurred_at) > Date.now() + 60000
      )
        ctx.addIssue({
          code: "custom",
          message:
            "An activity requires channel, kind, message and a past ISO timestamp with timezone.",
        });
    }
  });
