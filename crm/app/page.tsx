// crm/app/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/top-bar';
import { Sidebar } from '@/components/sidebar';
import type { SavedView, LeadRow, TeamMember } from '@/lib/types';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: memberData } = await supabase.from('team_members').select('*').eq('id', user.id).single();
  const member = memberData as TeamMember | null;
  if (!member) redirect('/login');

  const { data: viewsData } = await supabase.from('saved_views').select('*').order('sort_order', { ascending: true });
  const views = (viewsData ?? []) as SavedView[];

  const { data: leadsData } = await supabase
    .from('leads_with_latest_call')
    .select('*')
    .eq('status', 'scored')
    .order('digital_maturity', { ascending: true, nullsFirst: false })
    .limit(500);
  const leads = (leadsData ?? []) as LeadRow[];

  return (
    <div className="h-screen flex flex-col">
      <TopBar userName={member.full_name ?? member.email} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar views={views} />
        {/* Lead list + detail panel added in Task 7/8 */}
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <div className="text-lg">{leads.length} leads loaded</div>
            <div className="text-sm">Lead list and detail panel coming in next tasks</div>
          </div>
        </div>
      </div>
    </div>
  );
}
