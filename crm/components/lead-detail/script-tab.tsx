// crm/components/lead-detail/script-tab.tsx
'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { BestPitch } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const LABELS: Record<BestPitch, string> = {
  website: 'Website',
  mcb: 'Missed-Call Text-Back',
  chat_ai: 'Chat AI',
  reputation: 'Reputation',
  ghl_crm: 'GHL CRM',
};

export function ScriptTab({ defaultPitch, scripts }: {
  defaultPitch: BestPitch | null;
  scripts: Record<BestPitch, string>;
}) {
  const [pitch, setPitch] = useState<BestPitch>(defaultPitch ?? 'website');

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="mb-4">
        <Select value={pitch} onValueChange={(v) => setPitch(v as BestPitch)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(LABELS) as BestPitch[]).map((p) => (
              <SelectItem key={p} value={p}>{LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown>{scripts[pitch]}</ReactMarkdown>
      </div>
    </div>
  );
}
