// crm/components/team/invite-dialog.tsx
'use client';
import { useState, useTransition } from 'react';
import { inviteTeammate } from '@/app/actions/invite';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const r = await inviteTeammate(fd);
      if (r?.error) toast.error(r.error);
      else {
        toast.success('Invited');
        setOpen(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Invite teammate</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite teammate</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="inv-email">Email</Label><Input id="inv-email" name="email" type="email" required /></div>
          <div className="space-y-2"><Label htmlFor="inv-name">Full name</Label><Input id="inv-name" name="full_name" required /></div>
          <div className="space-y-2">
            <Label htmlFor="inv-role">Role</Label>
            <Select name="role" defaultValue="caller">
              <SelectTrigger id="inv-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="caller">Caller</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={pending}>{pending ? 'Inviting…' : 'Send invite'}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
