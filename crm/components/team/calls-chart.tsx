// crm/components/team/calls-chart.tsx
'use client';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

type Point = { day: string; [caller: string]: number | string };

function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 60%, 55%)`;
}

export function CallsChart({ data, callers }: { data: Point[]; callers: { id: string; name: string }[] }) {
  if (callers.length === 0) {
    return <div className="text-sm text-muted-foreground">No call data yet.</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <XAxis dataKey="day" />
        <YAxis allowDecimals={false} />
        <Tooltip />
        <Legend />
        {callers.map((c) => (
          <Area
            key={c.id}
            type="monotone"
            dataKey={c.name}
            stackId="1"
            stroke={colorForId(c.id)}
            fill={colorForId(c.id)}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
