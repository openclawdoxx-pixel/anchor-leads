// crm/components/team/leaderboard.tsx
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Row = {
  caller_id: string;
  name: string;
  calls: number;
  interested: number;
  booked: number;
  won: number;
};

export function Leaderboard({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-muted-foreground">No team members yet.</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead className="text-right">Calls</TableHead>
          <TableHead className="text-right">Interested</TableHead>
          <TableHead className="text-right">Booked</TableHead>
          <TableHead className="text-right">Won</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.caller_id}>
            <TableCell className="font-medium">{r.name}</TableCell>
            <TableCell className="text-right">{r.calls}</TableCell>
            <TableCell className="text-right">{r.interested}</TableCell>
            <TableCell className="text-right">{r.booked}</TableCell>
            <TableCell className="text-right">{r.won}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
