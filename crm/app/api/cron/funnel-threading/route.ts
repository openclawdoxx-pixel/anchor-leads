// crm/app/api/cron/funnel-threading/route.ts
//
// Hourly cron entry point for the threading reply runner. Vercel cron hits
// this at HH:00 between 08:00 and 17:00 ET (configured in vercel.ts), at
// most ~10 replies per run = ≤100 replies/day total — well below any
// per-mailbox throttle and spaced enough to look like a human reading
// inbox replies in the morning.

import { NextResponse } from "next/server";
import { runThreadingBatch } from "@/lib/funnel/threading";

export const runtime = "nodejs";
// Threading batch with 10 replies is fast (~1s/reply with API + DB updates).
// 60s ceiling is plenty even with retries.
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runThreadingBatch();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "threading run failed";
    console.error(`[cron/funnel-threading] failed:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Vercel cron sends GET by default; accept both so manual curl works too.
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request);
}
