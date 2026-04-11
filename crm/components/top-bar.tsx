// crm/components/top-bar.tsx
import Link from 'next/link';
import { signOut } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';

export function TopBar({ userName }: { userName: string }) {
  return (
    <header className="h-14 border-b flex items-center px-4 gap-4 shrink-0">
      <Link href="/" className="font-semibold">Anchor Leads</Link>
      <div className="flex-1" />
      <Link href="/team" className="text-sm text-muted-foreground hover:text-foreground">Team</Link>
      <span className="text-sm text-muted-foreground">{userName}</span>
      <form action={signOut}>
        <Button variant="ghost" size="sm" type="submit">Sign out</Button>
      </form>
    </header>
  );
}
