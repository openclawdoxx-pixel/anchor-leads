// crm/lib/funnel/types.ts

export type Lead = {
  id: string;
  company_name: string;
  owner_name: string | null;
  city: string | null;
  state: string;
  phone: string;
  website: string | null;
  email: string;
  raw_site_text: string | null;
  review_samples: string[] | null;
  facebook_url: string | null;
  rating: number | null;
  review_count: number | null;
};

export type ResearchOutput = {
  best_review_quote: string | null;
  best_review_attribution: string | null;
  distinctive_services: string[];
  local_callout: string | null;
  tone_hint: "professional" | "folksy" | "urgent" | "established";
  visual_color_hint: string | null;
};

export type PersonalizationOutput = {
  hero_tagline: string;
  review_block_html: string;
  city_callout: string;
  color_overrides: { primary?: string; accent?: string } | null;
};

export type AuditResult = {
  approved: boolean;
  rejection_reason: string | null;
  fixed_personalization: PersonalizationOutput | null;
};

export type AgentTokenUsage = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
};

export type RunSummary = {
  run_date: string;
  leads_attempted: number;
  leads_sent: number;
  leads_failed: number;
  duration_ms: number;
  agent_token_usage: {
    research: AgentTokenUsage;
    personalize: AgentTokenUsage;
    audit: AgentTokenUsage;
  };
};

export type FunnelPhase = 1 | 2 | 3 | 4;
