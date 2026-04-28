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

function requireApiKey(): string {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  if (!apiKey) throw new Error("SMARTLEAD_API_KEY must be set");
  return apiKey;
}

async function smartleadFetch(
  path: string,
  init: RequestInit,
  ctx: string,
  opts: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const apiKey = requireApiKey();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${SMARTLEAD_BASE}${path}${sep}api_key=${apiKey}`;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);
    if (res.ok) return res;
    if (res.status === 429 && attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
    // Don't echo URL or body — both contain the api_key.
    throw new Error(`${ctx}: HTTP ${res.status}`);
  }
  throw new Error(`${ctx}: exhausted retries`);
}

export async function pushLeads(
  leads: SmartleadLead[],
  opts: PushOptions & { campaignId?: number } = {},
): Promise<PushResult> {
  const campaignId = opts.campaignId ?? Number(process.env.SMARTLEAD_CAMPAIGN_ID);
  if (!campaignId || Number.isNaN(campaignId)) {
    throw new Error("SMARTLEAD_CAMPAIGN_ID must be set or campaignId must be passed");
  }

  const CHUNK = 50;
  let totalUploaded = 0;
  let totalFailed = 0;

  for (let i = 0; i < leads.length; i += CHUNK) {
    const slice = leads.slice(i, i + CHUNK);
    const res = await smartleadFetch(
      `/campaigns/${campaignId}/leads`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_list: slice }),
      },
      `Smartlead push chunk ${i / CHUNK + 1}`,
      { maxRetries: opts.maxRetries, baseDelayMs: opts.baseDelayMs },
    );
    const data = (await res.json()) as { uploaded?: number; failed?: number };
    totalUploaded += data.uploaded ?? slice.length;
    totalFailed += data.failed ?? 0;
  }

  return { uploaded: totalUploaded, failed: totalFailed };
}

// ─── Threading API ──────────────────────────────────────────────────────────
//
// Smartlead's sequence engine sends each step as a NEW thread (new subject,
// no In-Reply-To headers). To get Email 2 (Day 3) and Email 6 (Day 21) to
// thread under Email 1 / Email 5 in Gmail/Outlook, we use this endpoint.
//
// Endpoint verified 2026-04-27 against
// https://api.smartlead.ai/reference/reply-to-lead-from-master-inbox-via-api

export type SendReplyArgs = {
  campaignId: number;
  emailStatsId: string;
  body: string;
};

export async function sendInboxReply(args: SendReplyArgs): Promise<void> {
  await smartleadFetch(
    `/campaigns/${args.campaignId}/reply-email-thread`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email_stats_id: args.emailStatsId,
        email_body: args.body,
        add_signature: false,
      }),
    },
    `Smartlead reply campaign=${args.campaignId} stats=${args.emailStatsId}`,
  );
}

// ─── Message-history fallback ──────────────────────────────────────────────
//
// EMAIL_SENT webhook payload may not include email_stats_id (it isn't in the
// docs example as of 2026-04-27, though real payloads often have more fields
// than docs show). Fallback: query message history for the lead at reply time
// and grab the email_stats_id matching sequence_number. One extra API hit per
// reply — fine at <50 replies/hour.

export type MessageHistoryItem = {
  email_stats_id: string;
  sequence_number: number;
  sent_at?: string;
  type?: string;
};

export async function getMessageHistory(args: {
  campaignId: number;
  leadId: number;
}): Promise<MessageHistoryItem[]> {
  const res = await smartleadFetch(
    `/campaigns/${args.campaignId}/leads/${args.leadId}/message-history`,
    { method: "GET" },
    `Smartlead message-history campaign=${args.campaignId} lead=${args.leadId}`,
  );
  const data = (await res.json()) as { history?: MessageHistoryItem[] } | MessageHistoryItem[];
  if (Array.isArray(data)) return data;
  return data.history ?? [];
}

// ─── Mailbox listing for capacity-cap ──────────────────────────────────────
//
// Returns email accounts attached to a campaign. We count the warmed/active
// ones and feed that into the dynamic intake cap.
// Per docs scan: there's no documented `GET /campaigns/{id}/email-accounts`,
// but `GET /email-accounts/?username=...` exists and there's a campaign-scoped
// version on most Smartlead deployments. We try campaign-scoped first; if it
// 404s, fall back to listing all and the caller can filter.

export type SmartleadMailbox = {
  id: number;
  from_email?: string;
  warmup_details?: {
    status?: string;
    total_sent_count?: number;
    total_received_count?: number;
  };
  is_smtp_success?: boolean;
  is_imap_success?: boolean;
};

export async function listCampaignMailboxes(campaignId: number): Promise<SmartleadMailbox[]> {
  try {
    const res = await smartleadFetch(
      `/campaigns/${campaignId}/email-accounts`,
      { method: "GET" },
      `Smartlead campaign mailboxes campaign=${campaignId}`,
      { maxRetries: 0 },
    );
    const data = (await res.json()) as SmartleadMailbox[] | { email_accounts?: SmartleadMailbox[] };
    return Array.isArray(data) ? data : (data.email_accounts ?? []);
  } catch {
    // Fallback to global list. Caller filters by `from_email` domain.
    const res = await smartleadFetch(
      `/email-accounts/`,
      { method: "GET" },
      `Smartlead all mailboxes`,
    );
    const data = (await res.json()) as SmartleadMailbox[] | { email_accounts?: SmartleadMailbox[] };
    return Array.isArray(data) ? data : (data.email_accounts ?? []);
  }
}

/**
 * Count "warmed" mailboxes — those with a clean SMTP+IMAP connection and a
 * warmup status that has progressed past initial setup. The Smartlead warmup
 * status string varies by deployment ("ACTIVE", "RUNNING", "1-WEEK", etc),
 * so the test is "not paused/failed/setup" rather than a positive whitelist.
 */
export function countWarmedMailboxes(mailboxes: SmartleadMailbox[]): number {
  const NOT_WARMED = new Set(["PAUSED", "FAILED", "SETUP", "INACTIVE", ""]);
  return mailboxes.filter((m) => {
    if (m.is_smtp_success === false || m.is_imap_success === false) return false;
    const status = (m.warmup_details?.status ?? "").toUpperCase();
    return !NOT_WARMED.has(status);
  }).length;
}
