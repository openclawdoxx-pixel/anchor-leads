// crm/lib/types.ts
export type LeadStatus = 'discovered' | 'qualified' | 'rejected' | 'enriched' | 'enrichment_failed' | 'scored';
export type BestPitch = 'website' | 'mcb' | 'chat_ai' | 'reputation' | 'ghl_crm';
export type BookingPathQuality = 'strong' | 'weak' | 'none';
export type TeamRole = 'owner' | 'admin' | 'caller';
export type CallOutcome = 'no_answer' | 'voicemail' | 'bad_number' | 'gatekeeper' | 'rejected' | 'callback' | 'interested' | 'booked_demo' | 'closed_won' | 'do_not_call';

export type LeadRow = {
  id: string;
  company_name: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string;
  status: LeadStatus;
  review_count: number | null;
  rating: number | null;
  owner_name: string | null;
  site_builder: string | null;
  booking_path_quality: BookingPathQuality | null;
  best_pitch: BestPitch | null;
  digital_maturity: number | null;
  ai_summary: string | null;
  latest_outcome: CallOutcome | null;
  latest_call_at: string | null;
};

export type LeadEnrichmentRow = {
  lead_id: string;
  owner_name: string | null;
  review_count: number | null;
  rating: number | null;
  site_builder: string | null;
  has_chat_widget: boolean | null;
  chat_widget_vendor: string | null;
  last_site_update_year: number | null;
  booking_path_quality: BookingPathQuality | null;
  facebook_url: string | null;
  facebook_last_post: string | null;
  review_samples: Array<{ text: string; rating?: number }>;
  hero_snapshot: { hero_text?: string; above_fold_ctas?: string[]; has_phone_link?: boolean; has_booking_form?: boolean } | null;
};

export type LeadNotesRow = {
  lead_id: string;
  attack_angles: string[];
  review_themes: string[];
  digital_maturity: number;
  ai_summary: string;
  best_pitch: BestPitch;
};

export type CallLogRow = {
  id: string;
  lead_id: string;
  caller_id: string;
  outcome: CallOutcome;
  notes: string | null;
  pitch_used: BestPitch | null;
  created_at: string;
  caller_name?: string;
};

export type SavedView = {
  id: string;
  name: string;
  filters: FilterState;
  sort_order: number;
};

export type FilterState = {
  state?: string[];
  city?: string;
  best_pitch?: BestPitch[];
  review_count_max?: number;
  review_count_min?: number;
  has_owner_name?: boolean;
  site_builder?: string[];
  booking_path_quality?: BookingPathQuality[];
  call_status?: 'never_called' | 'no_answer_recent' | 'called_today' | 'any';
  digital_maturity_max?: number;
};

export type TeamMember = {
  id: string;
  email: string;
  full_name: string | null;
  role: TeamRole;
};
