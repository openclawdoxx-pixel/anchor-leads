// crm/components/lead-detail/index.tsx
'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import type { LeadRow, LeadEnrichmentRow, LeadNotesRow, CallLogRow, BestPitch } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IntelTab } from './intel-tab';
import { ScriptTab } from './script-tab';
import { CallLogTab } from './call-log-tab';

export function LeadDetail({ leads, scripts }: {
  leads: LeadRow[];
  scripts: Record<BestPitch, string>;
}) {
  const { selectedLeadId } = useStore();
  const lead = leads.find((l) => l.id === selectedLeadId) ?? null;
  const [enrichment, setEnrichment] = useState<LeadEnrichmentRow | null>(null);
  const [notes, setNotes] = useState<LeadNotesRow | null>(null);
  const [priorCalls, setPriorCalls] = useState<CallLogRow[]>([]);

  useEffect(() => {
    if (!lead) { setEnrichment(null); setNotes(null); setPriorCalls([]); return; }
    const sb = createClient();
    (async () => {
      const [e, n, c] = await Promise.all([
        sb.from('lead_enrichment').select('*').eq('lead_id', lead.id).maybeSingle(),
        sb.from('lead_notes').select('*').eq('lead_id', lead.id).maybeSingle(),
        sb.from('call_logs').select('*, team_members(full_name)').eq('lead_id', lead.id).order('created_at', { ascending: false }),
      ]);
      setEnrichment((e.data as LeadEnrichmentRow) ?? null);
      setNotes((n.data as LeadNotesRow) ?? null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setPriorCalls(((c.data ?? []) as any[]).map((r) => ({ ...r, caller_name: r.team_members?.full_name })));
    })();
  }, [lead]);

  if (!lead) return <div className="flex-1 flex items-center justify-center text-muted-foreground">Pick a lead</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Tabs defaultValue="intel" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3 w-fit">
          <TabsTrigger value="intel">Intel</TabsTrigger>
          <TabsTrigger value="script">Script</TabsTrigger>
          <TabsTrigger value="call">Call Log</TabsTrigger>
        </TabsList>
        <TabsContent value="intel" className="flex-1 overflow-hidden mt-0"><IntelTab lead={lead} enrichment={enrichment} notes={notes} /></TabsContent>
        <TabsContent value="script" className="flex-1 overflow-hidden mt-0"><ScriptTab defaultPitch={lead.best_pitch} scripts={scripts} /></TabsContent>
        <TabsContent value="call" className="flex-1 overflow-hidden mt-0"><CallLogTab leadId={lead.id} defaultPitch={lead.best_pitch} priorCalls={priorCalls} /></TabsContent>
      </Tabs>
    </div>
  );
}
