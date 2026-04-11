'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const sb = createClient();
      const { error: authErr } = await sb.auth.signInWithPassword({ email, password });
      if (authErr) {
        setError(authErr.message);
        setPending(false);
        return;
      }
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setPending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Anchor Leads</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
              />
            </div>
            {error && <p className="text-sm text-destructive break-words">{error}</p>}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              First time? Go to <a href="/bootstrap" className="underline">/bootstrap</a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
