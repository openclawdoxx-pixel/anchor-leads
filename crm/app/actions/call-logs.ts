// crm/app/actions/call-logs.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function logCall(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };

  const lead_id = formData.get('lead_id') as string;
  const outcome = formData.get('outcome') as string;
  const notes = (formData.get('notes') as string) || null;
  const pitch_used = (formData.get('pitch_used') as string) || null;

  const { error } = await supabase.from('call_logs').insert({
    lead_id,
    caller_id: user.id,
    outcome,
    notes,
    pitch_used,
  });
  if (error) return { error: error.message };

  const terminal: Record<string, string> = {
    bad_number: 'rejected',
    booked_demo: 'scored',
    closed_won: 'scored',
    do_not_call: 'rejected',
  };
  if (terminal[outcome]) {
    await supabase.from('leads').update({ status: terminal[outcome] }).eq('id', lead_id);
  }

  revalidatePath('/');
  return { ok: true };
}
