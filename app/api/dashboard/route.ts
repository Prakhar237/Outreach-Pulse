import {
  allRows,
  authorize,
  configured,
  db,
  failure,
  input,
  response,
  sameOrigin,
  AppError,
} from "@/lib/server";
import { activityInput, leadInput, importRow } from "@/lib/validation";
import { z } from "zod";
export async function GET() {
  try {
    if (!configured()) throw new AppError("Database settings are missing. Configure SUPABASE_URL and SUPABASE_SECRET_KEY on the server.", 503);
    const user = await authorize();
    const [leads, activities, deals] = await Promise.all([
      allRows("outreach_leads"),
      allRows("outreach_activities"),
      allRows("outreach_deals"),
    ]);
    return response({
      leads,
      activities,
      deals,
      mode: "live",
      admin: user.admin,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    await authorize(true);
    if (!configured())
      throw new AppError("Connect Supabase before saving real data.", 409);
    const body = await input(req);
    switch (body.action) {
      case "lead": {
        const lead = leadInput.parse(body.lead);
        await db("rpc/outreach_import", "POST", { payload: [lead] });
        break;
      }
      case "activity": {
        const activity = activityInput.parse(body.activity);
        await db("outreach_activities", "POST", activity);
        break;
      }
      case "status": {
        const { id, status } = z
          .object({
            id: z.string().uuid(),
            status: z.enum([
              "New",
              "Contacted",
              "Replied",
              "Qualified",
              "Meeting booked",
              "Won",
              "Lost",
            ]),
          })
          .parse(body);
        const changed = await db<unknown[]>(
          `outreach_leads?id=eq.${id}`,
          "PATCH",
          { status },
          "return=representation",
        );
        if (!changed.length)
          throw new AppError("This lead no longer exists.", 404);
        break;
      }
      case "import": {
        const rows = z.array(importRow).min(1).max(500).parse(body.rows);
        const summary = await db("rpc/outreach_import", "POST", {
          payload: rows,
        });
        return response({ ok: true, summary });
      }
      default:
        throw new AppError("Unknown action.");
    }
    return response({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
