const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";

export type SmartleadLead = {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  custom_fields?: Record<string, string>;
};

export type PushOptions = { maxRetries?: number; baseDelayMs?: number };
export type PushResult = { uploaded: number; failed: number };

export async function pushLeads(leads: SmartleadLead[], opts: PushOptions = {}): Promise<PushResult> {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  const campaignId = process.env.SMARTLEAD_CAMPAIGN_ID;
  if (!apiKey || !campaignId) {
    throw new Error("SMARTLEAD_API_KEY and SMARTLEAD_CAMPAIGN_ID must be set");
  }

  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const url = `${SMARTLEAD_BASE}/campaigns/${campaignId}/leads?api_key=${apiKey}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_list: leads }),
    });

    if (res.ok) {
      const data = (await res.json()) as { uploaded?: number; failed?: number };
      return { uploaded: data.uploaded ?? leads.length, failed: data.failed ?? 0 };
    }

    if (res.status === 429 && attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const body = await res.json().catch(() => ({}));
    throw new Error(`Smartlead push failed: ${res.status} ${JSON.stringify(body)}`);
  }

  throw new Error("Smartlead push exhausted retries");
}
