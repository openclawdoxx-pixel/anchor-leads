// crm/app/actions/auth.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Redirect back to login with error in search params
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
  redirect('/');
}

export async function bootstrap(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = formData.get('full_name') as string;

  // only allow if no team_members exist yet
  const { count } = await supabase.from('team_members').select('*', { count: 'exact', head: true });
  if ((count ?? 0) > 0) {
    redirect('/login?error=Bootstrap+already+completed');
  }

  const { data: auth, error: signupErr } = await supabase.auth.signUp({ email, password });
  if (signupErr || !auth.user) {
    redirect(`/bootstrap?error=${encodeURIComponent(signupErr?.message ?? 'Signup failed')}`);
  }

  const { error: insertErr } = await supabase.from('team_members').insert({
    id: auth.user!.id,
    email,
    full_name: fullName,
    role: 'owner',
  });
  if (insertErr) {
    redirect(`/bootstrap?error=${encodeURIComponent(insertErr.message)}`);
  }
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
