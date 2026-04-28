// crm/vercel.ts
//
// Vercel project config in TypeScript. Replaces vercel.json so we get type
// checking + comments + dynamic logic.
//
// Cron schedule design:
//   - Funnel batch  → once daily at 6am ET (11:00 UTC during EDT)
//   - Threading run → hourly 9am–5pm ET (13:00–21:00 UTC during EDT)
//
// 10 threading firings/day × 10 replies/run cap = 100 replies/day max,
// which is plenty of headroom for Day 3 + Day 21 across the intake target.

import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "nextjs",
  crons: [
    {
      // Nightly: compute capacity, select fresh leads, run agents, push to Smartlead.
      path: "/api/cron/funnel-batch",
      schedule: "0 11 * * *",
    },
    {
      // Hourly during US business hours: send Day 3 + Day 21 threaded replies.
      path: "/api/cron/funnel-threading",
      schedule: "0 13-21 * * *",
    },
  ],
};

export default config;
