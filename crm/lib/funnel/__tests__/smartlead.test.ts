import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  pushLeads,
  sendInboxReply,
  countWarmedMailboxes,
  type SmartleadLead,
  type SmartleadMailbox,
} from "../smartlead";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  process.env.SMARTLEAD_API_KEY = "sl-test";
  process.env.SMARTLEAD_CAMPAIGN_ID = "12345";
});

afterEach(() => fetchMock.mockReset());

const lead: SmartleadLead = {
  email: "owner@acme.com", first_name: "John", last_name: "Doe",
  company_name: "Acme Plumbing",
  custom_fields: { landing_url: "https://example.com/l/acme-1" },
};

describe("pushLeads", () => {
  it("posts leads to the configured campaign", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ uploaded: 1 }) });
    const r = await pushLeads([lead]);
    expect(r.uploaded).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/campaigns/12345/leads?api_key=sl-test"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("retries on 429 with backoff and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ uploaded: 1 }) });
    const r = await pushLeads([lead], { baseDelayMs: 1 });
    expect(r.uploaded).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on non-429 error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "server" }) });
    await expect(pushLeads([lead])).rejects.toThrow(/500/);
  });

  it("chunks pushes into batches of 50", async () => {
    const big = Array.from({ length: 125 }, (_, i) => ({ ...lead, email: `lead${i}@x.com` }));
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ uploaded: 50 }) });
    const r = await pushLeads(big);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 50 + 50 + 25
    expect(r.uploaded).toBe(150); // mock returns 50 each call, 3 calls
  });

  it("uses passed campaignId over env var", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ uploaded: 1 }) });
    await pushLeads([lead], { campaignId: 9999 });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/campaigns/9999/leads?api_key=sl-test"),
      expect.objectContaining({ method: "POST" })
    );
  });
});

describe("sendInboxReply", () => {
  it("posts to reply-email-thread with email_stats_id and email_body", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await sendInboxReply({ campaignId: 3224195, emailStatsId: "stats-abc", body: "<p>hi</p>" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/campaigns/3224195/reply-email-thread?api_key=sl-test"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("stats-abc"),
      }),
    );
  });
});

describe("countWarmedMailboxes", () => {
  it("counts only mailboxes with successful SMTP+IMAP and a warmup status that's progressing", () => {
    const mboxes: SmartleadMailbox[] = [
      { id: 1, is_smtp_success: true, is_imap_success: true, warmup_details: { status: "ACTIVE" } },
      { id: 2, is_smtp_success: true, is_imap_success: true, warmup_details: { status: "1-WEEK" } },
      { id: 3, is_smtp_success: false, is_imap_success: true, warmup_details: { status: "ACTIVE" } }, // SMTP fail → not warmed
      { id: 4, is_smtp_success: true, is_imap_success: true, warmup_details: { status: "PAUSED" } }, // paused → not warmed
      { id: 5, is_smtp_success: true, is_imap_success: true, warmup_details: { status: "SETUP" } }, // not ready
      { id: 6, is_smtp_success: true, is_imap_success: true }, // missing warmup_details → status=""=not warmed
    ];
    expect(countWarmedMailboxes(mboxes)).toBe(2);
  });
});
