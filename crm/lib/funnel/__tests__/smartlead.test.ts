import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pushLeads, type SmartleadLead } from "../smartlead";

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
});
