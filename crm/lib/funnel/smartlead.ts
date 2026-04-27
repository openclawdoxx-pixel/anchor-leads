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
  const CHUNK = 50;

  let totalUploaded = 0;
  let totalFailed = 0;

  for (let i = 0; i < leads.length; i += CHUNK) {
    const slice = leads.slice(i, i + CHUNK);
    let chunkDone = false;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_list: slice }),
      });
      if (res.ok) {
        const data = (await res.json()) as { uploaded?: number; failed?: number };
        totalUploaded += data.uploaded ?? slice.length;
        totalFailed += data.failed ?? 0;
        chunkDone = true;
        break;
      }
      if (res.status === 429 && attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      // I6 fix: don't echo URL or response body that may contain key
      throw new Error(`Smartlead push failed for chunk ${i / CHUNK + 1}: HTTP ${res.status}`);
    }
    if (!chunkDone) throw new Error(`Smartlead push exhausted retries on chunk ${i / CHUNK + 1}`);
  }

  return { uploaded: totalUploaded, failed: totalFailed };
}
