// crm/app/actions/auth.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
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

  // Use service-role admin client so we can:
  // 1. Create the auth user as confirmed (no email verification step)
  // 2. Insert into team_members bypassing RLS (no session exists yet)
  const admin = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    redirect(`/bootstrap?error=${encodeURIComponent(createErr?.message ?? 'Signup failed')}`);
  }

  const { error: insertErr } = await admin.from('team_members').insert({
    id: created.user!.id,
    email,
    full_name: fullName,
    role: 'owner',
  });
  if (insertErr) {
    redirect(`/bootstrap?error=${encodeURIComponent(insertErr.message)}`);
  }

  // Now sign the user in so they get a session cookie and land on the main page
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    redirect(`/login?error=${encodeURIComponent('Account created. Please sign in.')}`);
  }
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
