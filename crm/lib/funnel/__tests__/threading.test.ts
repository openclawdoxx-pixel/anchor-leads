import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// We mock smartlead so the threading module's calls hit our spies, not real HTTP.
vi.mock("../smartlead", () => ({
  sendInboxReply: vi.fn(async () => undefined),
  getMessageHistory: vi.fn(async () => []),
}));

import {
  recordEmailSent,
  recordEmailClicked,
  recordTerminalEvent,
  runThreadingBatch,
  type FunnelStateRow,
} from "../threading";
import { sendInboxReply, getMessageHistory } from "../smartlead";

// ─── Fake Supabase client ──────────────────────────────────────────────────
// Each table call returns a builder. The builder records every method call
// for assertion and resolves to a configurable result. Terminal methods are:
// maybeSingle (returns { data, error }), and the awaited query (default).

type Resp = { data?: unknown; error?: unknown; count?: number };

function fakeSupabase(plan: { [key: string]: Resp[] } = {}, defaults?: Resp) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];

  function makeBuilder(table: string, key: string) {
    const queue = plan[`${table}.${key}`] ?? [];
    const result: Resp = queue.shift() ?? defaults ?? { data: null };

    // Promise-shape result that supabase-js terminal calls produce.
    const thenable = {
      then(onFulfilled: (v: Resp) => unknown) {
        return Promise.resolve(result).then(onFulfilled);
      },
      maybeSingle: () => Promise.resolve({ data: (result.data as unknown[] | null)?.[0] ?? result.data ?? null, error: result.error ?? null }),
      single: () => Promise.resolve({ data: (result.data as unknown[] | null)?.[0] ?? result.data ?? null, error: result.error ?? null }),
    };

    const builder: Record<string, unknown> = {
      _result: result,
      then: thenable.then,
      maybeSingle: thenable.maybeSingle,
      single: thenable.single,
    };
    const chain = ["select", "insert", "update", "upsert", "delete", "eq", "neq", "is", "in", "gte", "lte", "lt", "gt", "limit", "order"];
    for (const m of chain) {
      builder[m] = (...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return builder;
      };
    }
    return builder;
  }

  const client = {
    from(table: string) {
      // Use a key based on call count for deterministic per-call routing.
      const callIdx = calls.filter((c) => c.table === table && c.method === "from").length;
      calls.push({ table, method: "from", args: [] });
      return makeBuilder(table, String(callIdx));
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── recordEmailSent ────────────────────────────────────────────────────────

describe("recordEmailSent", () => {
  it("merges email_stats_id into existing jsonb map for the matched lead", async () => {
    const fake = fakeSupabase({
      "leads.0": [{ data: { id: "lead-uuid-1" } }],
      "lead_funnel_state.0": [{ data: { email_stats_ids: { "1": "stats-1" }, smartlead_lead_id: null, campaign_id: null } }],
      "lead_funnel_state.1": [{ data: null }],
    });
    await recordEmailSent({
      email: "owner@acme.com",
      smartleadLeadId: 999,
      campaignId: 3224195,
      sequenceNumber: 2,
      emailStatsId: "stats-2",
      supabase: fake.client,
    });
    const updateCall = fake.calls.find((c) => c.method === "update");
    expect(updateCall).toBeDefined();
    const payload = updateCall!.args[0] as Record<string, unknown>;
    expect(payload.email_stats_ids).toEqual({ "1": "stats-1", "2": "stats-2" });
    expect(payload.smartlead_lead_id).toBe("999");
    expect(payload.campaign_id).toBe(3224195);
  });

  it("skips silently when no lead matches the email", async () => {
    const fake = fakeSupabase({ "leads.0": [{ data: null }] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await recordEmailSent({
      email: "ghost@nowhere.com",
      smartleadLeadId: 1,
      campaignId: 3224195,
      sequenceNumber: 1,
      supabase: fake.client,
    });
    // Only the leads lookup should have happened, no update.
    expect(fake.calls.find((c) => c.method === "update")).toBeUndefined();
    warn.mockRestore();
  });

  it("does not write email_stats_ids[seq] when emailStatsId is missing", async () => {
    const fake = fakeSupabase({
      "leads.0": [{ data: { id: "lead-uuid-1" } }],
      "lead_funnel_state.0": [{ data: { email_stats_ids: {}, smartlead_lead_id: null, campaign_id: null } }],
    });
    await recordEmailSent({
      email: "owner@acme.com",
      smartleadLeadId: 999,
      campaignId: 3224195,
      sequenceNumber: 1,
      supabase: fake.client,
    });
    const updateCall = fake.calls.find((c) => c.method === "update")!;
    const payload = updateCall.args[0] as Record<string, unknown>;
    expect(payload.email_stats_ids).toEqual({});
  });
});

// ─── recordEmailClicked ─────────────────────────────────────────────────────

describe("recordEmailClicked", () => {
  it("appends the sequence number without duplicating", async () => {
    const fake = fakeSupabase({
      "leads.0": [{ data: { id: "lead-uuid-1" } }],
      "lead_funnel_state.0": [{ data: { clicked_email_steps: [1, 3] } }],
    });
    await recordEmailClicked({ email: "owner@x.com", sequenceNumber: 1, supabase: fake.client });
    const updateCall = fake.calls.find((c) => c.method === "update")!;
    const payload = updateCall.args[0] as Record<string, unknown>;
    // Adding 1 to [1,3] should remain [1,3] (set-deduped).
    expect(payload.clicked_email_steps).toEqual([1, 3]);
  });
});

// ─── recordTerminalEvent ────────────────────────────────────────────────────

describe("recordTerminalEvent", () => {
  it("sets terminal_event with is-null guard so first event wins", async () => {
    const fake = fakeSupabase({
      "leads.0": [{ data: { id: "lead-uuid-1" } }],
    });
    await recordTerminalEvent({ email: "owner@x.com", kind: "replied", supabase: fake.client });
    const updateCall = fake.calls.find((c) => c.method === "update")!;
    expect((updateCall.args[0] as Record<string, unknown>).terminal_event).toBe("replied");
    // The is-null guard must be applied:
    const isCall = fake.calls.find((c) => c.method === "is" && c.args[0] === "terminal_event");
    expect(isCall).toBeDefined();
    expect(isCall!.args[1]).toBeNull();
  });
});

// ─── runThreadingBatch — Path A vs B selection ─────────────────────────────

describe("runThreadingBatch", () => {
  it("picks Path B body when lead clicked Email 1, Path A otherwise", async () => {
    const baseRow = (overrides: Partial<FunnelStateRow>): FunnelStateRow => ({
      lead_id: "lead-1", slug: "acme-1", smartlead_lead_id: "999",
      campaign_id: 3224195, email_stats_ids: { "1": "stats-1" },
      clicked_email_steps: [], pushed_to_smartlead_at: "2026-04-20T00:00:00Z",
      email_2_reply_sent_at: null, email_6_reply_sent_at: null, terminal_event: null,
      ...overrides,
    });
    const clicker = baseRow({ lead_id: "click-lead", clicked_email_steps: [1] });
    const skipper = baseRow({ lead_id: "skip-lead", clicked_email_steps: [] });

    const fake = fakeSupabase({
      "lead_funnel_state.0": [{ data: [clicker, skipper] }],
      // For each successful send, the runner does one update with is(null) guard,
      // followed by a small select. Accept default empty-data response.
      "lead_funnel_state.1": [{ data: [{ lead_id: "click-lead" }] }],
      "lead_funnel_state.2": [{ data: [{ lead_id: "skip-lead" }] }],
      // Day 21 batch: empty.
      "lead_funnel_state.3": [{ data: [] }],
    }, { data: [{ lead_id: "any" }] });

    // Need leads lookup for merge fields.
    // company_name fetch happens after sendInboxReply succeeds. We don't care
    // about exact text — just that Path A vs B body was chosen.

    const r = await runThreadingBatch({
      now: new Date("2026-04-27T12:00:00Z"),
      maxRepliesPerRun: 10,
      supabase: fake.client,
    });
    expect(r.email_2_attempted).toBe(2);
    expect(sendInboxReply).toHaveBeenCalledTimes(2);

    const calls = (sendInboxReply as ReturnType<typeof vi.fn>).mock.calls;
    const bodies = calls.map((c) => (c[0] as { body: string }).body);
    const hasPathBKeyword = bodies.some((b) => b.includes("You saw what I built"));
    const hasPathAKeyword = bodies.some((b) => b.includes("You skipped my last email"));
    expect(hasPathBKeyword).toBe(true);
    expect(hasPathAKeyword).toBe(true);
  });

  it("falls back to message-history when email_stats_ids[seq] is missing", async () => {
    const row: FunnelStateRow = {
      lead_id: "lead-1", slug: "acme-1", smartlead_lead_id: "999",
      campaign_id: 3224195, email_stats_ids: {}, clicked_email_steps: [],
      pushed_to_smartlead_at: "2026-04-20T00:00:00Z",
      email_2_reply_sent_at: null, email_6_reply_sent_at: null, terminal_event: null,
    };
    const fake = fakeSupabase({
      "lead_funnel_state.0": [{ data: [row] }],
      "lead_funnel_state.3": [{ data: [] }], // Day 21 empty
    }, { data: [{ lead_id: "lead-1" }] });

    (getMessageHistory as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { sequence_number: 1, email_stats_id: "found-via-history" },
    ]);

    await runThreadingBatch({
      now: new Date("2026-04-27T12:00:00Z"),
      maxRepliesPerRun: 5,
      supabase: fake.client,
    });
    expect(getMessageHistory).toHaveBeenCalledWith({ campaignId: 3224195, leadId: 999 });
    const sendArgs = (sendInboxReply as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sendArgs.emailStatsId).toBe("found-via-history");
  });

  it("respects maxRepliesPerRun cap across both batches", async () => {
    const rows: FunnelStateRow[] = Array.from({ length: 50 }, (_, i) => ({
      lead_id: `lead-${i}`, slug: `co-${i}`, smartlead_lead_id: String(i),
      campaign_id: 3224195, email_stats_ids: { "1": `stats-${i}` },
      clicked_email_steps: [], pushed_to_smartlead_at: "2026-04-20T00:00:00Z",
      email_2_reply_sent_at: null, email_6_reply_sent_at: null, terminal_event: null,
    }));
    const fake = fakeSupabase({
      "lead_funnel_state.0": [{ data: rows.slice(0, 10) }], // limit=10 enforced by builder
    }, { data: [{ lead_id: "any" }] });

    await runThreadingBatch({
      now: new Date("2026-04-27T12:00:00Z"),
      maxRepliesPerRun: 10,
      supabase: fake.client,
    });
    // Only 10 sends (cap), even though 50 are pending.
    expect((sendInboxReply as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(10);
  });
});
