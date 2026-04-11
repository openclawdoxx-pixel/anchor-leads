// crm/app/actions/invite.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

export async function inviteTeammate(formData: FormData) {
  const cookieStore = await cookies();

  // Admin client with service role key — required for auth.admin.inviteUserByEmail
  const admin = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );

  // Regular client to check the caller's role
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };

  const { data: me } = await supabase.from('team_members').select('role').eq('id', user.id).single();
  if (!me || !['owner', 'admin'].includes(me.role)) return { error: 'Only owners/admins can invite' };

  const email = formData.get('email') as string;
  const full_name = formData.get('full_name') as string;
  const role = (formData.get('role') as string) || 'caller';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin.auth as any).admin.inviteUserByEmail(email);
  if (error || !data?.user) return { error: error?.message ?? 'Invite failed' };

  await admin.from('team_members').insert({
    id: data.user.id,
    email,
    full_name,
    role,
  });

  revalidatePath('/team');
  return { ok: true };
}
