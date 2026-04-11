// crm/components/filter-chips.tsx
'use client';
import { useStore } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';

export function FilterChips() {
  const { filters, setFilters } = useStore();
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];

  if (filters.state?.length) chips.push({ key: 'state', label: `State: ${filters.state.join(', ')}`, remove: () => setFilters({ ...filters, state: undefined }) });
  if (filters.best_pitch?.length) chips.push({ key: 'bp', label: `Pitch: ${filters.best_pitch.join(', ')}`, remove: () => setFilters({ ...filters, best_pitch: undefined }) });
  if (filters.review_count_max) chips.push({ key: 'rm', label: `≤${filters.review_count_max} reviews`, remove: () => setFilters({ ...filters, review_count_max: undefined }) });
  if (filters.has_owner_name) chips.push({ key: 'own', label: 'Owner known', remove: () => setFilters({ ...filters, has_owner_name: undefined }) });
  if (filters.call_status === 'never_called') chips.push({ key: 'nc', label: 'Never called', remove: () => setFilters({ ...filters, call_status: undefined }) });
  if (filters.site_builder?.length) chips.push({ key: 'sb', label: `Site: ${filters.site_builder.join(', ')}`, remove: () => setFilters({ ...filters, site_builder: undefined }) });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border-b">
      {chips.map((c) => (
        <Badge key={c.key} variant="secondary" className="gap-1">
          {c.label}
          <button onClick={c.remove} className="ml-1 hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
    </div>
  );
}
