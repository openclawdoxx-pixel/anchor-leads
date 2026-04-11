// crm/components/lead-detail/intel-tab.tsx
import type { LeadRow, LeadEnrichmentRow, LeadNotesRow } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

export function IntelTab({ lead, enrichment, notes }: {
  lead: LeadRow;
  enrichment: LeadEnrichmentRow | null;
  notes: LeadNotesRow | null;
}) {
  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div>
        <h2 className="text-xl font-semibold">{lead.company_name}</h2>
        <div className="text-sm text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          {lead.phone && <a href={`tel:${lead.phone}`} className="text-primary hover:underline font-medium">{lead.phone}</a>}
          {lead.rating !== null && lead.rating !== undefined && <span>★ {lead.rating.toFixed(1)}</span>}
          {lead.review_count !== null && <span>{lead.review_count} reviews</span>}
          {lead.owner_name && <span className="font-medium text-foreground">Owner: {lead.owner_name}</span>}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{lead.city ?? '—'}, {lead.state}</div>
        {lead.website && (
          <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline block mt-1">
            {lead.website}
          </a>
        )}
      </div>

      {notes?.ai_summary && (
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Summary</div>
          <p className="text-sm leading-relaxed">{notes.ai_summary}</p>
        </div>
      )}

      {notes?.attack_angles && notes.attack_angles.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Attack Angles</div>
          <ul className="text-sm space-y-1">
            {notes.attack_angles.map((a, i) => <li key={i}>• {a}</li>)}
          </ul>
        </div>
      )}

      {notes?.review_themes && notes.review_themes.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Review Themes</div>
          <ul className="text-sm space-y-1">
            {notes.review_themes.map((t, i) => <li key={i}>• {t}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 pt-1">
        {enrichment?.site_builder && <Badge variant="outline">{enrichment.site_builder}</Badge>}
        {enrichment?.booking_path_quality && <Badge variant="outline">booking: {enrichment.booking_path_quality}</Badge>}
        {enrichment?.has_chat_widget && <Badge variant="outline">chat: {enrichment.chat_widget_vendor}</Badge>}
        {enrichment?.last_site_update_year && <Badge variant="outline">site updated {enrichment.last_site_update_year}</Badge>}
        {notes?.best_pitch && <Badge>pitch: {notes.best_pitch}</Badge>}
        {notes?.digital_maturity !== undefined && notes?.digital_maturity !== null && (
          <Badge variant="outline">maturity: {notes.digital_maturity}/10</Badge>
        )}
      </div>

      {enrichment?.facebook_url && (
        <div className="text-sm">
          <a href={enrichment.facebook_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Facebook</a>
          {enrichment.facebook_last_post && <span className="text-muted-foreground"> · last post {enrichment.facebook_last_post}</span>}
        </div>
      )}
    </div>
  );
}
