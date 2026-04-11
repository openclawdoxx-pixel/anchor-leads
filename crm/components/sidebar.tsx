// crm/components/sidebar.tsx
'use client';
import { useStore } from '@/lib/store';
import type { SavedView } from '@/lib/types';
import { cn } from '@/lib/utils';

export function Sidebar({ views }: { views: SavedView[] }) {
  const { activeViewId, applyView } = useStore();
  return (
    <aside className="w-56 border-r bg-muted/30 shrink-0 overflow-y-auto">
      <div className="p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Lenses</div>
        <ul className="space-y-0.5">
          {views.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => applyView(v)}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted transition',
                  activeViewId === v.id && 'bg-muted font-medium'
                )}
              >
                {v.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
