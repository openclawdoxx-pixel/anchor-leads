// crm/app/api/webhooks/smartlead/route.ts
//
// Receives Smartlead webhook events. Each event is recorded into
// lead_funnel_state via the threading module's idempotent recorders.
//
// Smartlead delivers at-least-once, so duplicate events are expected. The
// recorders are designed to be safe under replay (set-if-null patterns + jsonb
// merges).

import { NextResponse } from "next/server";
import {
  recordEmailSent,
  recordEmailClicked,
  recordTerminalEvent,
} from "@/lib/funnel/threading";

export const runtime = "nodejs";
// Webhook handlers must finish quickly; Smartlead times out > a few seconds.
export const maxDuration = 30;

type SmartleadWebhook = {
  event: string;
  timestamp?: string;
  campaign_id?: number;
  lead_id?: number;
  email_account_id?: number;
  sequence_number?: number;
  email_stats_id?: string;
  // Real-world payloads sometimes nest the email under different keys.
  email?: string;
  lead?: { email?: string; first_name?: string; last_name?: string };
  link?: { url?: string; clicked_at?: string };
  reply?: { subject?: string; body?: string; received_at?: string; message_id?: string };
};

function leadEmailFrom(payload: SmartleadWebhook): string | null {
  return payload.lead?.email ?? payload.email ?? null;
}

export async function POST(request: Request): Promise<NextResponse> {
  // Shared-secret check. Smartlead's webhook config supports a custom header
  // value — we set it to SMARTLEAD_WEBHOOK_SECRET via Vercel env. Without it,
  // anyone could POST events at us and corrupt state.
  const secret = process.env.SMARTLEAD_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      request.headers.get("x-smartlead-secret")
      ?? request.headers.get("x-webhook-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  let payload: SmartleadWebhook;
  try {
    payload = (await request.json()) as SmartleadWebhook;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const email = leadEmailFrom(payload);
  if (!email) {
    // Some events (e.g. campaign-level) won't have a lead email. Ack and skip.
    return NextResponse.json({ ok: true, skipped: "no lead email" });
  }

  try {
    switch (payload.event) {
      case "EMAIL_SENT":
        if (
          payload.campaign_id == null
          || payload.sequence_number == null
          || payload.lead_id == null
        ) {
          return NextResponse.json({ ok: true, skipped: "EMAIL_SENT missing required fields" });
        }
        await recordEmailSent({
          email,
          smartleadLeadId: payload.lead_id,
          campaignId: payload.campaign_id,
          sequenceNumber: payload.sequence_number,
          emailStatsId: payload.email_stats_id,
        });
        break;

      case "EMAIL_CLICKED":
        if (payload.sequence_number == null) {
          return NextResponse.json({ ok: true, skipped: "EMAIL_CLICKED missing sequence_number" });
        }
        await recordEmailClicked({
          email,
          sequenceNumber: payload.sequence_number,
        });
        break;

      case "EMAIL_REPLIED":
        await recordTerminalEvent({ email, kind: "replied" });
        break;

      case "EMAIL_BOUNCED":
        await recordTerminalEvent({ email, kind: "bounced" });
        break;

      case "EMAIL_UNSUBSCRIBED":
        await recordTerminalEvent({ email, kind: "unsubscribed" });
        break;

      case "EMAIL_OPENED":
        // Don't currently use opens for routing decisions. Ack only.
        break;

      default:
        // Unknown event — ack to avoid Smartlead retrying forever, but log.
        console.warn(`[webhook] unknown Smartlead event: ${payload.event}`);
    }
  } catch (err) {
    console.error(
      `[webhook] handler error for event=${payload.event} email=${email}:`,
      err instanceof Error ? err.message : String(err),
    );
    // 500 so Smartlead retries (they back off automatically).
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
