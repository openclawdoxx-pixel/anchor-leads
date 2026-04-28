import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../smartlead", () => ({
  listCampaignMailboxes: vi.fn(async () => []),
  countWarmedMailboxes: vi.fn(() => 0),
}));

import { computeDailyIntakeCap } from "../capacity";
import { listCampaignMailboxes, countWarmedMailboxes } from "../smartlead";

function fakeSupabaseWithCount(count: number): SupabaseClient {
  const builder: Record<string, unknown> = {
    then(onFulfilled: (v: { count: number }) => unknown) {
      return Promise.resolve({ count }).then(onFulfilled);
    },
  };
  for (const m of ["select", "eq", "is", "gte", "lte", "limit", "order"]) {
    builder[m] = () => builder;
  }
  return { from: () => builder } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeDailyIntakeCap", () => {
  it("caps at the config ceiling when capacity is huge", async () => {
    (listCampaignMailboxes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (countWarmedMailboxes as ReturnType<typeof vi.fn>).mockReturnValue(100); // 100 mailboxes
    const cap = await computeDailyIntakeCap({
      now: new Date("2026-04-27T12:00:00Z"),
      supabase: fakeSupabaseWithCount(0),
    });
    // 100 × 25 × 0.8 / 6 = 333; ceiling is funnelConfig.max_daily_sends = 75.
    expect(cap.raw_capacity).toBe(333);
    expect(cap.config_ceiling).toBe(75);
    expect(cap.remaining_intake).toBe(75);
  });

  it("returns zero remaining when daily ceiling already met", async () => {
    (listCampaignMailboxes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (countWarmedMailboxes as ReturnType<typeof vi.fn>).mockReturnValue(100);
    const cap = await computeDailyIntakeCap({
      now: new Date("2026-04-27T12:00:00Z"),
      supabase: fakeSupabaseWithCount(75),
    });
    expect(cap.pushed_today).toBe(75);
    expect(cap.remaining_intake).toBe(0);
  });

  it("uses raw capacity when fewer mailboxes than ceiling implies", async () => {
    (listCampaignMailboxes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (countWarmedMailboxes as ReturnType<typeof vi.fn>).mockReturnValue(3); // Week 1 reality
    const cap = await computeDailyIntakeCap({
      now: new Date("2026-04-27T12:00:00Z"),
      supabase: fakeSupabaseWithCount(0),
    });
    // 3 × 25 × 0.8 / 6 = 10 (floor)
    expect(cap.raw_capacity).toBe(10);
    expect(cap.remaining_intake).toBe(10);
  });

  it("subtracts pushed_today from target and never goes negative", async () => {
    (listCampaignMailboxes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (countWarmedMailboxes as ReturnType<typeof vi.fn>).mockReturnValue(3);
    const cap = await computeDailyIntakeCap({
      now: new Date("2026-04-27T12:00:00Z"),
      supabase: fakeSupabaseWithCount(20), // already pushed > raw cap
    });
    expect(cap.remaining_intake).toBe(0);
  });
});
