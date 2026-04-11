// crm/components/lead-detail/call-log-tab.tsx
'use client';
import { useTransition } from 'react';
import { logCall } from '@/app/actions/call-logs';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CallLogRow, BestPitch } from '@/lib/types';

const OUTCOMES: { value: string; label: string }[] = [
  { value: 'no_answer', label: 'No answer' },
  { value: 'voicemail', label: 'Voicemail' },
  { value: 'bad_number', label: 'Bad number' },
  { value: 'gatekeeper', label: 'Gatekeeper' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'callback', label: 'Callback' },
  { value: 'interested', label: 'Interested' },
  { value: 'booked_demo', label: 'Booked demo' },
  { value: 'closed_won', label: 'Closed won' },
  { value: 'do_not_call', label: 'Do not call' },
];

const PITCHES: BestPitch[] = ['website', 'mcb', 'chat_ai', 'reputation', 'ghl_crm'];

export function CallLogTab({ leadId, defaultPitch, priorCalls }: {
  leadId: string;
  defaultPitch: BestPitch | null;
  priorCalls: CallLogRow[];
}) {
  const [pending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('lead_id', leadId);
    const form = e.currentTarget;
    startTransition(async () => {
      const result = await logCall(fd);
      if (result?.error) toast.error(result.error);
      else {
        toast.success('Call logged');
        form.reset();
      }
    });
  }

  return (
    <div className="p-4 space-y-6 overflow-y-auto h-full">
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="outcome">Outcome</Label>
          <Select name="outcome" required>
            <SelectTrigger id="outcome"><SelectValue placeholder="Pick an outcome" /></SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pitch_used">Pitch used</Label>
          <Select name="pitch_used" defaultValue={defaultPitch ?? undefined}>
            <SelectTrigger id="pitch_used"><SelectValue placeholder="Pitch" /></SelectTrigger>
            <SelectContent>
              {PITCHES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" name="notes" rows={3} />
        </div>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
      </form>

      <div>
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Prior calls ({priorCalls.length})</div>
        <ul className="space-y-2">
          {priorCalls.map((c) => (
            <li key={c.id} className="border-l-2 border-muted pl-3">
              <div className="text-sm font-medium">
                {c.outcome.replace(/_/g, ' ')}
                {c.pitch_used && <span className="text-muted-foreground"> · {c.pitch_used}</span>}
              </div>
              {c.notes && <div className="text-sm text-muted-foreground">{c.notes}</div>}
              <div className="text-xs text-muted-foreground">
                {new Date(c.created_at).toLocaleString()}
                {c.caller_name && ` · ${c.caller_name}`}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
