import { createClient } from '@/lib/supabase/server';
import { TopBar } from '@/components/top-bar';
import { Sidebar } from '@/components/sidebar';
import { LeadList } from '@/components/lead-list';
import { LeadDetail } from '@/components/lead-detail';
import { loadAllScripts } from '@/lib/scripts';
import type { SavedView, LeadRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();

  const { data: viewsData } = await supabase
    .from('saved_views')
    .select('*')
    .order('sort_order', { ascending: true });
  const views = (viewsData ?? []) as SavedView[];

  const { data: leadsData } = await supabase
    .from('leads_with_latest_call')
    .select('*')
    .in('status', ['scored', 'enriched'])
    .order('digital_maturity', { ascending: true, nullsFirst: false })
    .limit(500);
  const leads = (leadsData ?? []) as LeadRow[];

  const scripts = loadAllScripts();

  return (
    <div className="h-screen flex flex-col">
      <TopBar userName="Anchor Leads" />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar views={views} />
        <LeadList leads={leads} />
        <LeadDetail leads={leads} scripts={scripts} />
      </div>
    </div>
  );
}
