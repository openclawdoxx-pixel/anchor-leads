import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    // Verify session was actually set by reading it back
    const { data: userData } = await supabase.auth.getUser();

    return NextResponse.json({
      ok: true,
      userId: data.user?.id,
      verifiedUserId: userData.user?.id,
      sessionActive: !!userData.user,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sign in failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
