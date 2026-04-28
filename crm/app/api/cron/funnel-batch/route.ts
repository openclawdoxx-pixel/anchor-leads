// crm/app/api/cron/funnel-batch/route.ts
//
// Nightly cron entry. Computes today's dynamic intake cap, selects that
// many fresh leads, runs them through the personalize → push pipeline,
// and logs the run to funnel_runs. Vercel cron schedule lives in vercel.ts.

import { NextResponse } from "next/server";
import { computeDailyIntakeCap } from "@/lib/funnel/capacity";
import { selectNextBatch } from "@/lib/funnel/lead-selector";
import { runFunnelBatch } from "@/lib/funnel/orchestrator";
import { startRun, completeRun, failRun } from "@/lib/funnel/supabase-funnel";
import { funnelConfig } from "@/lib/funnel/config";

export const runtime = "nodejs";
export const maxDuration = 300;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const runDate = todayUtc();
  let runId: string | null = null;

  try {
    const cap = await computeDailyIntakeCap();
    if (cap.remaining_intake <= 0) {
      return NextResponse.json({
        ok: true,
        skipped: "daily intake cap already met",
        capacity: cap,
      });
    }

    const { id } = await startRun(runDate);
    runId = id;

    const leads = await selectNextBatch(cap.remaining_intake);
    if (leads.length === 0) {
      const summary = {
        run_date: runDate,
        leads_attempted: 0,
        leads_sent: 0,
        leads_failed: 0,
        duration_ms: 0,
        agent_token_usage: {
          research: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          personalize: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          audit: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
        },
      };
      await completeRun(id, summary);
      return NextResponse.json({
        ok: true,
        skipped: "no eligible leads",
        capacity: cap,
      });
    }

    const summary = await runFunnelBatch(leads, {
      runDate,
      concurrency: funnelConfig.agent_concurrency,
    });
    await completeRun(id, summary);

    return NextResponse.json({
      ok: true,
      capacity: cap,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "funnel batch failed";
    console.error(`[cron/funnel-batch] failed:`, message);
    if (runId) {
      try { await failRun(runId, message); } catch { /* secondary */ }
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
