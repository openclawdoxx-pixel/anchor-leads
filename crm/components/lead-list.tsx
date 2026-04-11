// crm/components/lead-list.tsx
'use client';
import { useEffect, useMemo } from 'react';
import { useStore } from '@/lib/store';
import type { LeadRow, FilterState } from '@/lib/types';
import { FilterChips } from './filter-chips';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function matchesFilter(lead: LeadRow, f: FilterState): boolean {
  if (f.state?.length && !f.state.includes(lead.state)) return false;
  if (f.best_pitch?.length && (!lead.best_pitch || !f.best_pitch.includes(lead.best_pitch))) return false;
  if (typeof f.review_count_max === 'number' && (lead.review_count ?? Infinity) > f.review_count_max) return false;
  if (typeof f.review_count_min === 'number' && (lead.review_count ?? -1) < f.review_count_min) return false;
  if (f.has_owner_name === true && !lead.owner_name) return false;
  if (f.site_builder?.length && (!lead.site_builder || !f.site_builder.includes(lead.site_builder))) return false;
  if (f.call_status === 'never_called' && lead.latest_outcome !== null) return false;
  return true;
}

const outcomeDot: Record<string, string> = {
  no_answer: 'bg-gray-400',
  voicemail: 'bg-blue-400',
  bad_number: 'bg-red-500',
  gatekeeper: 'bg-yellow-500',
  rejected: 'bg-red-600',
  callback: 'bg-purple-500',
  interested: 'bg-green-400',
  booked_demo: 'bg-green-500',
  closed_won: 'bg-emerald-600',
  do_not_call: 'bg-zinc-700',
};

export function LeadList({ leads }: { leads: LeadRow[] }) {
  const { selectedLeadId, setSelectedLead, filters } = useStore();
  const filtered = useMemo(() => leads.filter((l) => matchesFilter(l, filters)), [leads, filters]);

  useEffect(() => {
    if (!selectedLeadId && filtered[0]) setSelectedLead(filtered[0].id);
  }, [filtered, selectedLeadId, setSelectedLead]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = filtered.findIndex((l) => l.id === selectedLeadId);
      if ((e.key === 'j' || e.key === 'ArrowDown') && idx < filtered.length - 1) {
        setSelectedLead(filtered[idx + 1].id);
        e.preventDefault();
      }
      if ((e.key === 'k' || e.key === 'ArrowUp') && idx > 0) {
        setSelectedLead(filtered[idx - 1].id);
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedLeadId, setSelectedLead]);

  return (
    <div className="w-96 border-r flex flex-col overflow-hidden">
      <FilterChips />
      <div className="px-3 py-2 text-xs text-muted-foreground border-b">{filtered.length} leads</div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((lead) => (
          <button
            key={lead.id}
            onClick={() => setSelectedLead(lead.id)}
            className={cn(
              'w-full text-left px-3 py-2 border-b hover:bg-muted transition block',
              selectedLeadId === lead.id && 'bg-muted'
            )}
          >
            <div className="flex items-center gap-2">
              <div className="font-medium truncate flex-1">{lead.company_name}</div>
              {lead.latest_outcome && (
                <span className={cn('h-2 w-2 rounded-full', outcomeDot[lead.latest_outcome] ?? 'bg-gray-300')} />
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
              <span>{lead.city ?? '—'}, {lead.state}</span>
              <span>·</span>
              <span>{lead.review_count ?? 0} reviews</span>
              {lead.best_pitch && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto">{lead.best_pitch}</Badge>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
