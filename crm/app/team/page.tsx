// crm/app/team/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/top-bar';
import { Leaderboard } from '@/components/team/leaderboard';
import { CallsChart } from '@/components/team/calls-chart';
import { InviteDialog } from '@/components/team/invite-dialog';
import type { TeamMember } from '@/lib/types';

type MemberRow = { id: string; full_name: string | null; email: string; role: string };
type CallRow = { caller_id: string; outcome: string; created_at: string };

export default async function TeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: memberData } = await supabase.from('team_members').select('*').eq('id', user.id).single();
  const member = memberData as TeamMember | null;
  if (!member) redirect('/login');

  const { data: membersData } = await supabase.from('team_members').select('id, full_name, email, role');
  const members = (membersData ?? []) as MemberRow[];

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const { data: callsData } = await supabase
    .from('call_logs')
    .select('caller_id, outcome, created_at')
    .gte('created_at', thirtyDaysAgo);
  const calls = (callsData ?? []) as CallRow[];

  // Weekly leaderboard
  const weekStart = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const weekRows = members.map((m) => {
    const my = calls.filter((c) => c.caller_id === m.id && c.created_at >= weekStart);
    return {
      caller_id: m.id,
      name: m.full_name ?? m.email,
      calls: my.length,
      interested: my.filter((c) => c.outcome === 'interested').length,
      booked: my.filter((c) => c.outcome === 'booked_demo').length,
      won: my.filter((c) => c.outcome === 'closed_won').length,
    };
  }).sort((a, b) => b.calls - a.calls);

  // 30-day stacked chart
  const byDay: Record<string, Record<string, number>> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
    byDay[d] = {};
  }
  for (const c of calls) {
    const day = c.created_at.slice(0, 10);
    const name = members.find((m) => m.id === c.caller_id)?.full_name ?? 'unknown';
    byDay[day] = byDay[day] ?? {};
    byDay[day][name] = (byDay[day][name] ?? 0) + 1;
  }
  const chartData = Object.entries(byDay).map(([day, counts]) => ({ day: day.slice(5), ...counts }));
  const callers = members.map((m) => ({ id: m.id, name: m.full_name ?? m.email }));

  const canInvite = member.role === 'owner' || member.role === 'admin';

  return (
    <div className="h-screen flex flex-col">
      <TopBar userName={member.full_name ?? member.email} />
      <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Team</h1>
          {canInvite && <InviteDialog />}
        </div>
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">This week</h2>
          <Leaderboard rows={weekRows} />
        </section>
        <section>
          <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">Last 30 days</h2>
          <CallsChart data={chartData} callers={callers} />
        </section>
      </div>
    </div>
  );
}
