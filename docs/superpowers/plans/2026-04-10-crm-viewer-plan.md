# Anchor Leads CRM Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js 15 + Supabase CRM viewer deployed to Vercel with split-view layout, saved filter lenses, call outcome logging, markdown script loader, and team performance page — all reading from the existing scraper Supabase database.

**Architecture:** Sibling Next.js app under `/crm/` in the `anchor-leads` repo. App Router with React Server Components for all data reads, client components only where state is needed (selected lead, filter state, forms). Supabase SSR for auth + data. Three new tables added to the existing Supabase project. Shared DB is the contract between scraper and CRM — no code sharing.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, @supabase/ssr, Zustand, react-markdown, recharts, Vitest for unit tests, deployed to Vercel.

**Spec:** `docs/superpowers/specs/2026-04-10-crm-viewer-design.md`

---

## File Structure

```
anchor-leads/
├── crm/                              # NEW — Next.js project root
│   ├── app/
│   │   ├── layout.tsx                # root layout with providers
│   │   ├── page.tsx                  # main split view (server component)
│   │   ├── globals.css               # tailwind directives + shadcn vars
│   │   ├── login/page.tsx            # email/password login
│   │   ├── bootstrap/page.tsx        # first-user signup (conditional)
│   │   ├── team/page.tsx             # leaderboard + chart + invite
│   │   ├── actions/
│   │   │   ├── call-logs.ts          # server action: insert call log
│   │   │   ├── saved-views.ts        # server action: CRUD saved views
│   │   │   └── invite.ts             # server action: invite teammate
│   │   └── scripts/                  # markdown cold-call scripts
│   │       ├── website.md
│   │       ├── mcb.md
│   │       ├── chat_ai.md
│   │       ├── reputation.md
│   │       └── ghl_crm.md
│   ├── components/
│   │   ├── ui/                       # shadcn components
│   │   ├── top-bar.tsx
│   │   ├── sidebar.tsx               # saved views + user menu
│   │   ├── filter-chips.tsx
│   │   ├── lead-list.tsx             # virtualized list
│   │   ├── lead-detail/
│   │   │   ├── index.tsx
│   │   │   ├── intel-tab.tsx
│   │   │   ├── script-tab.tsx
│   │   │   └── call-log-tab.tsx
│   │   └── team/
│   │       ├── leaderboard.tsx
│   │       ├── calls-chart.tsx
│   │       └── invite-dialog.tsx
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts             # RSC-safe client
│   │   │   ├── client.ts             # browser client
│   │   │   └── middleware.ts         # session refresh
│   │   ├── filters.ts                # filter JSON → query builder
│   │   ├── filters.test.ts
│   │   ├── store.ts                  # zustand store
│   │   └── types.ts                  # hand-written DB types
│   ├── middleware.ts                 # next.js middleware auth
│   ├── migrations/                   # new SQL migrations
│   │   ├── 005_team_members.sql
│   │   ├── 006_call_logs.sql
│   │   ├── 007_saved_views.sql
│   │   └── 008_leads_view.sql
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── postcss.config.mjs
│   ├── next.config.ts
│   ├── vitest.config.ts
│   ├── components.json               # shadcn config
│   └── .env.local.example
```

---

## Task 1: Scaffold Next.js + deps + Tailwind + shadcn

**Files:** Many — entire `/crm/` directory structure.

- [ ] **Step 1: Create crm directory and initialize Next.js**

```bash
cd /Users/projectatlas/projects/anchor-leads
mkdir -p crm
cd crm
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*" --yes
```

Accept defaults. This creates `app/`, `components/`, `public/`, `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`.

- [ ] **Step 2: Install additional deps**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm install @supabase/supabase-js @supabase/ssr zustand react-markdown recharts react-hook-form @hookform/resolvers zod
npm install -D vitest @vitest/ui @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 3: Initialize shadcn/ui**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npx shadcn@latest init -d
```

Accept defaults (New York style, Neutral color, yes to CSS vars). This creates `components.json`, updates `globals.css`, updates `tailwind.config.ts`, creates `lib/utils.ts`.

- [ ] **Step 4: Add shadcn components we'll need**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npx shadcn@latest add button input label textarea select tabs card badge dialog toast dropdown-menu table separator scroll-area sonner
```

- [ ] **Step 5: Create vitest.config.ts**

```ts
// crm/vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './') },
  },
});
```

Add to `crm/package.json` scripts:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run"
}
```

- [ ] **Step 6: Create .env.local.example**

```
NEXT_PUBLIC_SUPABASE_URL=https://tfhfzwwyoezpcmbyfnqm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key_here>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key_here>
```

And `.env.local` with real values (copy from `/Users/projectatlas/projects/anchor-leads/.env` for the URL + service_role, anon key must come from Supabase dashboard → Settings → API).

- [ ] **Step 7: Update crm/.gitignore to exclude .env.local**

Next.js already includes this by default; verify by checking `.gitignore` contains `.env*.local`.

- [ ] **Step 8: Verify build**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm run build
```

Expected: clean build with the default Next.js starter page.

- [ ] **Step 9: Commit**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/
git commit -m "feat(crm): scaffold Next.js 15 + shadcn/ui + vitest"
```

---

## Task 2: CRM database migrations

**Files:** `crm/migrations/005_team_members.sql`, `006_call_logs.sql`, `007_saved_views.sql`, `008_leads_view.sql`

- [ ] **Step 1: Write 005_team_members.sql**

```sql
create table if not exists team_members (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'caller',
  created_at  timestamptz not null default now()
);

-- RLS: only team members can read team_members
alter table team_members enable row level security;
create policy "team members can read team" on team_members
  for select using (auth.uid() in (select id from team_members));
create policy "owners can insert team" on team_members
  for insert with check (
    auth.uid() in (select id from team_members where role in ('owner','admin'))
    or not exists (select 1 from team_members)
  );
```

- [ ] **Step 2: Write 006_call_logs.sql**

```sql
create table if not exists call_logs (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  caller_id   uuid not null references team_members(id),
  outcome     text not null,
  notes       text,
  pitch_used  text,
  duration_s  int,
  created_at  timestamptz not null default now()
);
create index if not exists call_logs_lead_idx on call_logs (lead_id, created_at desc);
create index if not exists call_logs_caller_idx on call_logs (caller_id, created_at desc);
create index if not exists call_logs_created_idx on call_logs (created_at desc);

alter table call_logs enable row level security;
create policy "team members read call logs" on call_logs
  for select using (auth.uid() in (select id from team_members));
create policy "team members insert own call logs" on call_logs
  for insert with check (caller_id = auth.uid());
```

- [ ] **Step 3: Write 007_saved_views.sql**

```sql
create table if not exists saved_views (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  filters     jsonb not null,
  created_by  uuid references team_members(id),
  is_shared   boolean default true,
  sort_order  int default 0,
  created_at  timestamptz not null default now()
);

alter table saved_views enable row level security;
create policy "team members read views" on saved_views
  for select using (auth.uid() in (select id from team_members));
create policy "team members write views" on saved_views
  for all using (auth.uid() in (select id from team_members));

-- Seed five starter views
insert into saved_views (name, filters, sort_order) values
  ('Never Called', '{"call_status":"never_called"}'::jsonb, 1),
  ('Bad Website, Owner Known', '{"site_builder":["wix","godaddy","none"],"has_owner_name":true}'::jsonb, 2),
  ('Low Reviews', '{"review_count_max":25}'::jsonb, 3),
  ('MCB Pitch, NY+PA', '{"best_pitch":["mcb"],"state":["NY","PA"]}'::jsonb, 4),
  ('No Answer - Retry Today', '{"call_status":"no_answer_recent"}'::jsonb, 5)
on conflict do nothing;
```

- [ ] **Step 4: Write 008_leads_view.sql**

```sql
create or replace view leads_with_latest_call as
select
  l.*,
  e.review_count,
  e.rating,
  e.owner_name,
  e.site_builder,
  e.booking_path_quality,
  n.best_pitch,
  n.digital_maturity,
  n.ai_summary,
  (select outcome from call_logs cl where cl.lead_id = l.id order by cl.created_at desc limit 1) as latest_outcome,
  (select created_at from call_logs cl where cl.lead_id = l.id order by cl.created_at desc limit 1) as latest_call_at
from leads l
left join lead_enrichment e on e.lead_id = l.id
left join lead_notes n on n.lead_id = l.id;
```

- [ ] **Step 5: Instruct user to run migrations**

After creating the files, print to console:

```
MIGRATIONS READY. Paste each file into Supabase SQL Editor in order:
1. crm/migrations/005_team_members.sql
2. crm/migrations/006_call_logs.sql
3. crm/migrations/007_saved_views.sql
4. crm/migrations/008_leads_view.sql
```

The subagent does not run these — the user pastes them manually.

- [ ] **Step 6: Commit**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/migrations/
git commit -m "feat(crm): add migrations for team_members, call_logs, saved_views, leads view"
```

---

## Task 3: Supabase client + types + middleware

**Files:** `crm/lib/supabase/server.ts`, `client.ts`, `middleware.ts`, `crm/middleware.ts`, `crm/lib/types.ts`

- [ ] **Step 1: Write crm/lib/types.ts (hand-written DB types)**

```ts
// crm/lib/types.ts
export type LeadStatus = 'discovered' | 'qualified' | 'rejected' | 'enriched' | 'enrichment_failed' | 'scored';
export type BestPitch = 'website' | 'mcb' | 'chat_ai' | 'reputation' | 'ghl_crm';
export type BookingPathQuality = 'strong' | 'weak' | 'none';
export type TeamRole = 'owner' | 'admin' | 'caller';
export type CallOutcome = 'no_answer' | 'voicemail' | 'bad_number' | 'gatekeeper' | 'rejected' | 'callback' | 'interested' | 'booked_demo' | 'closed_won' | 'do_not_call';

export type LeadRow = {
  id: string;
  company_name: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  state: string;
  status: LeadStatus;
  review_count: number | null;
  rating: number | null;
  owner_name: string | null;
  site_builder: string | null;
  booking_path_quality: BookingPathQuality | null;
  best_pitch: BestPitch | null;
  digital_maturity: number | null;
  ai_summary: string | null;
  latest_outcome: CallOutcome | null;
  latest_call_at: string | null;
};

export type LeadEnrichmentRow = {
  lead_id: string;
  owner_name: string | null;
  review_count: number | null;
  rating: number | null;
  site_builder: string | null;
  has_chat_widget: boolean | null;
  chat_widget_vendor: string | null;
  last_site_update_year: number | null;
  booking_path_quality: BookingPathQuality | null;
  facebook_url: string | null;
  facebook_last_post: string | null;
  review_samples: Array<{ text: string; rating?: number }>;
  hero_snapshot: { hero_text?: string; above_fold_ctas?: string[]; has_phone_link?: boolean; has_booking_form?: boolean } | null;
};

export type LeadNotesRow = {
  lead_id: string;
  attack_angles: string[];
  review_themes: string[];
  digital_maturity: number;
  ai_summary: string;
  best_pitch: BestPitch;
};

export type CallLogRow = {
  id: string;
  lead_id: string;
  caller_id: string;
  outcome: CallOutcome;
  notes: string | null;
  pitch_used: BestPitch | null;
  created_at: string;
  caller_name?: string;
};

export type SavedView = {
  id: string;
  name: string;
  filters: FilterState;
  sort_order: number;
};

export type FilterState = {
  state?: string[];
  city?: string;
  best_pitch?: BestPitch[];
  review_count_max?: number;
  review_count_min?: number;
  has_owner_name?: boolean;
  site_builder?: string[];
  booking_path_quality?: BookingPathQuality[];
  call_status?: 'never_called' | 'no_answer_recent' | 'called_today' | 'any';
  digital_maturity_max?: number;
};

export type TeamMember = {
  id: string;
  email: string;
  full_name: string | null;
  role: TeamRole;
};
```

- [ ] **Step 2: Write crm/lib/supabase/server.ts**

```ts
// crm/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // server component — can't set cookies, fine
          }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Write crm/lib/supabase/client.ts**

```ts
// crm/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 4: Write crm/lib/supabase/middleware.ts**

```ts
// crm/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicRoute = pathname === '/login' || pathname === '/bootstrap' || pathname.startsWith('/_next') || pathname.startsWith('/api/auth');

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return response;
}
```

- [ ] **Step 5: Write crm/middleware.ts (Next.js entry point)**

```ts
// crm/middleware.ts
import { updateSession } from '@/lib/supabase/middleware';
import type { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm run build
```

Expected: clean build. Any type errors → fix before committing.

- [ ] **Step 7: Commit**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/lib/ crm/middleware.ts
git commit -m "feat(crm): add supabase server/client/middleware + hand-written types"
```

---

## Task 4: Filter module (TDD)

**Files:** `crm/lib/filters.ts`, `crm/lib/filters.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// crm/lib/filters.test.ts
import { describe, it, expect } from 'vitest';
import { buildQueryFromFilters } from './filters';
import type { FilterState } from './types';

describe('buildQueryFromFilters', () => {
  it('returns no conditions for empty filters', () => {
    const result = buildQueryFromFilters({});
    expect(result).toEqual({});
  });

  it('handles state multi-select', () => {
    const result = buildQueryFromFilters({ state: ['NY', 'PA'] });
    expect(result.in).toEqual([['state', ['NY', 'PA']]]);
  });

  it('handles review_count_max as lte', () => {
    const result = buildQueryFromFilters({ review_count_max: 25 });
    expect(result.lte).toEqual([['review_count', 25]]);
  });

  it('handles has_owner_name=true as not-null', () => {
    const result = buildQueryFromFilters({ has_owner_name: true });
    expect(result.notNull).toEqual(['owner_name']);
  });

  it('handles never_called call_status', () => {
    const result = buildQueryFromFilters({ call_status: 'never_called' });
    expect(result.isNull).toEqual(['latest_outcome']);
  });

  it('combines multiple filters', () => {
    const f: FilterState = {
      state: ['NY'],
      review_count_max: 50,
      has_owner_name: true,
    };
    const result = buildQueryFromFilters(f);
    expect(result.in).toEqual([['state', ['NY']]]);
    expect(result.lte).toEqual([['review_count', 50]]);
    expect(result.notNull).toEqual(['owner_name']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm test
```

Expected: ImportError.

- [ ] **Step 3: Write crm/lib/filters.ts**

```ts
// crm/lib/filters.ts
import type { FilterState } from './types';

export type QueryPlan = {
  in?: Array<[string, string[] | number[]]>;
  lte?: Array<[string, number]>;
  gte?: Array<[string, number]>;
  eq?: Array<[string, string | number | boolean]>;
  notNull?: string[];
  isNull?: string[];
  ilike?: Array<[string, string]>;
};

export function buildQueryFromFilters(f: FilterState): QueryPlan {
  const plan: QueryPlan = {};

  if (f.state?.length) {
    (plan.in ??= []).push(['state', f.state]);
  }
  if (f.city) {
    (plan.ilike ??= []).push(['city', `%${f.city}%`]);
  }
  if (f.best_pitch?.length) {
    (plan.in ??= []).push(['best_pitch', f.best_pitch]);
  }
  if (f.site_builder?.length) {
    (plan.in ??= []).push(['site_builder', f.site_builder]);
  }
  if (f.booking_path_quality?.length) {
    (plan.in ??= []).push(['booking_path_quality', f.booking_path_quality]);
  }
  if (typeof f.review_count_max === 'number') {
    (plan.lte ??= []).push(['review_count', f.review_count_max]);
  }
  if (typeof f.review_count_min === 'number') {
    (plan.gte ??= []).push(['review_count', f.review_count_min]);
  }
  if (typeof f.digital_maturity_max === 'number') {
    (plan.lte ??= []).push(['digital_maturity', f.digital_maturity_max]);
  }
  if (f.has_owner_name === true) {
    (plan.notNull ??= []).push('owner_name');
  } else if (f.has_owner_name === false) {
    (plan.isNull ??= []).push('owner_name');
  }
  if (f.call_status === 'never_called') {
    (plan.isNull ??= []).push('latest_outcome');
  }

  return plan;
}

export function applyPlanToQuery<T>(query: any, plan: QueryPlan): any {
  let q = query;
  for (const [col, values] of plan.in ?? []) q = q.in(col, values);
  for (const [col, v] of plan.lte ?? []) q = q.lte(col, v);
  for (const [col, v] of plan.gte ?? []) q = q.gte(col, v);
  for (const [col, v] of plan.eq ?? []) q = q.eq(col, v);
  for (const col of plan.notNull ?? []) q = q.not(col, 'is', null);
  for (const col of plan.isNull ?? []) q = q.is(col, null);
  for (const [col, pattern] of plan.ilike ?? []) q = q.ilike(col, pattern);
  return q;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm test
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/lib/filters.ts crm/lib/filters.test.ts
git commit -m "feat(crm): add filter state → query plan translator with tests"
```

---

## Task 5: Auth pages (login + bootstrap)

**Files:** `crm/app/login/page.tsx`, `crm/app/bootstrap/page.tsx`, `crm/app/actions/auth.ts`

- [ ] **Step 1: Write crm/app/actions/auth.ts**

```ts
// crm/app/actions/auth.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export async function signIn(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect('/');
}

export async function bootstrap(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const fullName = formData.get('full_name') as string;

  // only allow if no team_members exist
  const { count } = await supabase.from('team_members').select('*', { count: 'exact', head: true });
  if ((count ?? 0) > 0) return { error: 'Bootstrap already completed' };

  const { data: auth, error: signupErr } = await supabase.auth.signUp({ email, password });
  if (signupErr || !auth.user) return { error: signupErr?.message ?? 'Signup failed' };

  const { error: insertErr } = await supabase.from('team_members').insert({
    id: auth.user.id,
    email,
    full_name: fullName,
    role: 'owner',
  });
  if (insertErr) return { error: insertErr.message };
  redirect('/');
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
```

- [ ] **Step 2: Write crm/app/login/page.tsx**

```tsx
// crm/app/login/page.tsx
import { signIn } from '@/app/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Anchor Leads</CardTitle></CardHeader>
        <CardContent>
          <form action={signIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            <Button type="submit" className="w-full">Sign in</Button>
            <p className="text-xs text-muted-foreground text-center">
              First time? Go to <a href="/bootstrap" className="underline">/bootstrap</a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Write crm/app/bootstrap/page.tsx**

```tsx
// crm/app/bootstrap/page.tsx
import { bootstrap } from '@/app/actions/auth';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function BootstrapPage() {
  const supabase = await createClient();
  const { count } = await supabase.from('team_members').select('*', { count: 'exact', head: true });
  if ((count ?? 0) > 0) redirect('/login');

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Create Owner Account</CardTitle></CardHeader>
        <CardContent>
          <form action={bootstrap} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="full_name">Your name</Label>
              <Input id="full_name" name="full_name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required minLength={8} />
            </div>
            <Button type="submit" className="w-full">Create account</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Update middleware to allow /bootstrap**

Already handled — the `isPublicRoute` check in Task 3 Step 4 already includes `/bootstrap`.

- [ ] **Step 5: Build check**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm run build
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/app/login/ crm/app/bootstrap/ crm/app/actions/auth.ts
git commit -m "feat(crm): add login and bootstrap pages with server actions"
```

---

## Task 6: Zustand store + main page shell

**Files:** `crm/lib/store.ts`, `crm/app/page.tsx`, `crm/app/layout.tsx`, `crm/components/top-bar.tsx`, `crm/components/sidebar.tsx`

- [ ] **Step 1: Write crm/lib/store.ts**

```ts
// crm/lib/store.ts
'use client';
import { create } from 'zustand';
import type { FilterState, SavedView } from './types';

type State = {
  selectedLeadId: string | null;
  filters: FilterState;
  activeViewId: string | null;
  setSelectedLead: (id: string | null) => void;
  setFilters: (f: FilterState) => void;
  applyView: (v: SavedView) => void;
};

export const useStore = create<State>((set) => ({
  selectedLeadId: null,
  filters: {},
  activeViewId: null,
  setSelectedLead: (id) => set({ selectedLeadId: id }),
  setFilters: (f) => set({ filters: f, activeViewId: null }),
  applyView: (v) => set({ filters: v.filters, activeViewId: v.id }),
}));
```

- [ ] **Step 2: Write crm/app/layout.tsx (update the generated one)**

```tsx
// crm/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'Anchor Leads',
  description: 'Plumber lead CRM',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Write crm/components/top-bar.tsx**

```tsx
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
```

- [ ] **Step 4: Write crm/components/sidebar.tsx**

```tsx
// crm/components/sidebar.tsx
'use client';
import { useStore } from '@/lib/store';
import type { SavedView } from '@/lib/types';
import { cn } from '@/lib/utils';

export function Sidebar({ views }: { views: SavedView[] }) {
  const { activeViewId, applyView } = useStore();
  return (
    <aside className="w-56 border-r bg-muted/30 shrink-0 overflow-y-auto">
      <div className="p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Lenses</div>
        <ul className="space-y-0.5">
          {views.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => applyView(v)}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted transition',
                  activeViewId === v.id && 'bg-muted font-medium'
                )}
              >
                {v.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Write crm/app/page.tsx (main split view)**

```tsx
// crm/app/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/top-bar';
import { Sidebar } from '@/components/sidebar';
import { LeadList } from '@/components/lead-list';
import { LeadDetail } from '@/components/lead-detail';
import type { SavedView, LeadRow, TeamMember } from '@/lib/types';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: memberData } = await supabase.from('team_members').select('*').eq('id', user.id).single();
  const member = memberData as TeamMember | null;
  if (!member) redirect('/login');

  const { data: viewsData } = await supabase.from('saved_views').select('*').order('sort_order', { ascending: true });
  const views = (viewsData ?? []) as SavedView[];

  const { data: leadsData } = await supabase
    .from('leads_with_latest_call')
    .select('*')
    .eq('status', 'scored')
    .order('digital_maturity', { ascending: true, nullsFirst: false })
    .limit(500);
  const leads = (leadsData ?? []) as LeadRow[];

  return (
    <div className="h-screen flex flex-col">
      <TopBar userName={member.full_name ?? member.email} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar views={views} />
        <LeadList leads={leads} />
        <LeadDetail leads={leads} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/lib/store.ts crm/app/layout.tsx crm/app/page.tsx crm/components/top-bar.tsx crm/components/sidebar.tsx
git commit -m "feat(crm): add main page shell, zustand store, top bar, sidebar"
```

Note: `LeadList` and `LeadDetail` are imported but not yet created — the build will fail until Task 7. That's fine; the commit is a checkpoint.

---

## Task 7: Lead list component

**Files:** `crm/components/lead-list.tsx`, `crm/components/filter-chips.tsx`

- [ ] **Step 1: Write crm/components/filter-chips.tsx**

```tsx
// crm/components/filter-chips.tsx
'use client';
import { useStore } from '@/lib/store';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';

export function FilterChips() {
  const { filters, setFilters } = useStore();
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];

  if (filters.state?.length) chips.push({ key: 'state', label: `State: ${filters.state.join(', ')}`, remove: () => setFilters({ ...filters, state: undefined }) });
  if (filters.best_pitch?.length) chips.push({ key: 'bp', label: `Pitch: ${filters.best_pitch.join(', ')}`, remove: () => setFilters({ ...filters, best_pitch: undefined }) });
  if (filters.review_count_max) chips.push({ key: 'rm', label: `≤${filters.review_count_max} reviews`, remove: () => setFilters({ ...filters, review_count_max: undefined }) });
  if (filters.has_owner_name) chips.push({ key: 'own', label: 'Owner known', remove: () => setFilters({ ...filters, has_owner_name: undefined }) });
  if (filters.call_status === 'never_called') chips.push({ key: 'nc', label: 'Never called', remove: () => setFilters({ ...filters, call_status: undefined }) });

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border-b">
      {chips.map((c) => (
        <Badge key={c.key} variant="secondary" className="gap-1">
          {c.label}
          <button onClick={c.remove}><X className="h-3 w-3" /></button>
        </Badge>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write crm/components/lead-list.tsx**

```tsx
// crm/components/lead-list.tsx
'use client';
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/lib/store';
import type { LeadRow, FilterState } from '@/lib/types';
import { FilterChips } from './filter-chips';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function matchesFilter(lead: LeadRow, f: FilterState): boolean {
  if (f.state?.length && !f.state.includes(lead.state)) return false;
  if (f.best_pitch?.length && (!lead.best_pitch || !f.best_pitch.includes(lead.best_pitch))) return false;
  if (typeof f.review_count_max === 'number' && (lead.review_count ?? Infinity) > f.review_count_max) return false;
  if (typeof f.review_count_min === 'number' && (lead.review_count ?? -1) < f.review_count_min) return false;
  if (f.has_owner_name === true && !lead.owner_name) return false;
  if (f.site_builder?.length && (!lead.site_builder || !f.site_builder.includes(lead.site_builder))) return false;
  if (f.call_status === 'never_called' && lead.latest_outcome !== null) return false;
  return true;
}

const outcomeDot: Record<string, string> = {
  no_answer: 'bg-gray-400',
  voicemail: 'bg-blue-400',
  bad_number: 'bg-red-500',
  gatekeeper: 'bg-yellow-500',
  rejected: 'bg-red-600',
  callback: 'bg-purple-500',
  interested: 'bg-green-400',
  booked_demo: 'bg-green-500',
  closed_won: 'bg-emerald-600',
  do_not_call: 'bg-zinc-700',
};

export function LeadList({ leads }: { leads: LeadRow[] }) {
  const { selectedLeadId, setSelectedLead, filters } = useStore();
  const filtered = useMemo(() => leads.filter((l) => matchesFilter(l, filters)), [leads, filters]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedLeadId && filtered[0]) setSelectedLead(filtered[0].id);
  }, [filtered, selectedLeadId, setSelectedLead]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const idx = filtered.findIndex((l) => l.id === selectedLeadId);
      if ((e.key === 'j' || e.key === 'ArrowDown') && idx < filtered.length - 1) {
        setSelectedLead(filtered[idx + 1].id);
        e.preventDefault();
      }
      if ((e.key === 'k' || e.key === 'ArrowUp') && idx > 0) {
        setSelectedLead(filtered[idx - 1].id);
        e.preventDefault();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedLeadId, setSelectedLead]);

  return (
    <div className="w-96 border-r flex flex-col overflow-hidden">
      <FilterChips />
      <div className="px-3 py-2 text-xs text-muted-foreground border-b">{filtered.length} leads</div>
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {filtered.map((lead) => (
          <button
            key={lead.id}
            onClick={() => setSelectedLead(lead.id)}
            className={cn(
              'w-full text-left px-3 py-2 border-b hover:bg-muted transition block',
              selectedLeadId === lead.id && 'bg-muted'
            )}
          >
            <div className="flex items-center gap-2">
              <div className="font-medium truncate flex-1">{lead.company_name}</div>
              {lead.latest_outcome && (
                <span className={cn('h-2 w-2 rounded-full', outcomeDot[lead.latest_outcome] ?? 'bg-gray-300')} />
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
              <span>{lead.city ?? '—'}, {lead.state}</span>
              <span>·</span>
              <span>{lead.review_count ?? 0} reviews</span>
              {lead.best_pitch && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto">{lead.best_pitch}</Badge>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit (build still broken until Task 8)**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/components/lead-list.tsx crm/components/filter-chips.tsx
git commit -m "feat(crm): add lead list with filters, keyboard nav, and outcome dots"
```

---

## Task 8: Lead detail panel (all 3 tabs)

**Files:** `crm/components/lead-detail/index.tsx`, `intel-tab.tsx`, `script-tab.tsx`, `call-log-tab.tsx`, `crm/app/actions/call-logs.ts`, `crm/app/scripts/*.md`

- [ ] **Step 1: Create the 5 seed script files**

Create `crm/app/scripts/website.md`:

```markdown
# Website Pitch

## Opener
Hey, is this [OWNER]? This is [YOUR NAME] — quick one, saw you don't have a website right now and I help plumbers get their phone ringing with a full site setup. Got 30 seconds?

## Discovery
- How are you getting jobs right now? Mostly word of mouth?
- When someone Googles you and can't find a real site, what do you think they do?
- How many calls a week do you think you're missing because of that?

## Pitch
I build plumbers like you a clean website that actually books jobs — not a brochure. It connects to your phone, texts back missed calls automatically, and handles online bookings 24/7. Free to set up, I only make money when it books you a job — $75 per booked job. No retainer, no monthly fee. Want to see what it looks like?

## Objections
### "I already have a Facebook / Google listing"
Those are great for being found, but they don't convert someone who's in a pipe emergency at 9pm. A website with instant booking is what turns the curious into an actual job.

### "I'm too busy"
I hear you — that's exactly the problem. Too busy means missing calls, and missing calls means lost money. My setup handles the phone so you don't have to. Takes me ~2 hours, zero effort from you.

### "I don't trust the internet for jobs"
Totally fair. That's why it's $0 upfront. I eat the cost until it actually books you a paid job. No risk, you just answer the calls it sends you.
```

Create `crm/app/scripts/mcb.md`:

```markdown
# Missed-Call Text-Back Pitch

## Opener
Hey [OWNER], [YOUR NAME] here — I'm going to be real with you, I saw your Google reviews and a couple of them mentioned "no one called back" or "couldn't reach you after hours." Got 30 seconds?

## Discovery
- On a typical day, how many calls do you miss when you're in the truck or on a job?
- What happens to those callers — do any of them call back, or do they just call the next plumber?
- How would you feel about a system that texts them back in 5 seconds automatically?

## Pitch
It's a missed-call text-back system. Someone calls, you don't pick up, they get an SMS within 5 seconds: "Hey this is [YOUR COMPANY], saw your call — how can I help?" Then an AI handles the conversation and books them if it's a real job. Free to set up, $75 per booked job. That's it.

## Objections
### "I already answer most calls"
Most isn't all. The ones you miss are the ones going to your competitors. Even one extra booked job per week is $300-500 a month extra.

### "AI can't handle plumbing questions"
It doesn't need to handle plumbing questions. It asks name, address, what's wrong, when they need you — same questions you'd ask. Then it pings you with the details. You show up and fix it.

### "What if it books something I can't do?"
You get the details first and can decline. Nothing locks in until you confirm on your end.
```

Create `crm/app/scripts/chat_ai.md`:

```markdown
# Chat AI Pitch

## Opener
Hey [OWNER] — saw your site doesn't have any way for someone to chat or book online. Is that right? Got 30 seconds?

## Discovery
- When someone lands on your site at midnight with a burst pipe, what happens?
- If they can't reach you, do you think they're calling the next plumber on Google?
- Would it help if a system could greet them and take their info instantly, any hour?

## Pitch
I add a chat widget to your site that handles inbound leads 24/7. When someone lands on your site, they get a friendly "what's going on?" message. The AI asks the right questions and texts you with the whole conversation + contact info. Free setup, $75 per booked job.

## Objections
### "I don't want to deal with chat all day"
You don't. The AI handles it. You only see the summary — a text with name, number, address, what's wrong.

### "My website doesn't get much traffic"
That's something I can help with too. But even a few visitors a month, if half of them book instead of leaving, that's real money.
```

Create `crm/app/scripts/reputation.md`:

```markdown
# Reputation Management Pitch

## Opener
Hey [OWNER], [YOUR NAME] — quick one. I noticed you've only got [X] reviews on Google, and most of your competitors in [CITY] have 200+. That's costing you jobs. 30 seconds?

## Discovery
- Do you ever ask happy customers to leave reviews?
- Out of 10 customers, how many actually leave one?
- What if a system sent them the review link automatically right after the job?

## Pitch
I set up automated review requests that text every customer after you finish the job. Just a friendly "thanks for letting us help, could you leave us a quick review?" with a one-click link. Most plumbers go from 2-3 reviews a month to 15-20. More reviews = more Google trust = more calls. Free to set up, $75 per booked job that flows from the extra ranking.

## Objections
### "I don't want to bother customers"
It's one text after the job is done, and customers who had a good experience are happy to leave a review when asked. You just don't ask right now.

### "I already ask in person"
In-person asks get forgotten by the time they get home. A text 30 minutes later, when they're sitting down and relieved the pipe is fixed — that's when you get 5 stars.
```

Create `crm/app/scripts/ghl_crm.md`:

```markdown
# GHL CRM Pitch

## Opener
Hey [OWNER], [YOUR NAME] — how are you tracking your leads right now? Spreadsheet? Memory? Paper?

## Discovery
- How many calls come in per week?
- How many slip through the cracks — no follow-up, forgotten quote?
- What would it mean if none of them slipped?

## Pitch
I set you up with GoHighLevel — a proper CRM where every lead gets tracked, followed up, and booked. It connects to your phone, your missed-call text-back, your website, your reviews — everything in one place. Free to set up, $75 per booked job that comes out of it. No monthly fee ever.

## Objections
### "I've tried CRMs, they're a pain"
This one I set up FOR you. Zero configuration on your end. You just get a dashboard with your leads and their status. If you hate it, toss it.

### "I don't have time to learn software"
It's a phone number and a list of leads. That's it. No training needed.
```

- [ ] **Step 2: Write crm/app/actions/call-logs.ts**

```ts
// crm/app/actions/call-logs.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function logCall(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };

  const lead_id = formData.get('lead_id') as string;
  const outcome = formData.get('outcome') as string;
  const notes = (formData.get('notes') as string) || null;
  const pitch_used = (formData.get('pitch_used') as string) || null;

  const { error } = await supabase.from('call_logs').insert({
    lead_id,
    caller_id: user.id,
    outcome,
    notes,
    pitch_used,
  });
  if (error) return { error: error.message };

  const terminal: Record<string, string> = {
    bad_number: 'rejected',
    booked_demo: 'scored',
    closed_won: 'scored',
    do_not_call: 'rejected',
  };
  if (terminal[outcome]) {
    await supabase.from('leads').update({ status: terminal[outcome] }).eq('id', lead_id);
  }

  revalidatePath('/');
  return { ok: true };
}
```

- [ ] **Step 3: Write crm/components/lead-detail/intel-tab.tsx**

```tsx
// crm/components/lead-detail/intel-tab.tsx
import type { LeadRow, LeadEnrichmentRow, LeadNotesRow } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

export function IntelTab({ lead, enrichment, notes }: {
  lead: LeadRow;
  enrichment: LeadEnrichmentRow | null;
  notes: LeadNotesRow | null;
}) {
  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div>
        <h2 className="text-xl font-semibold">{lead.company_name}</h2>
        <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
          {lead.phone && <a href={`tel:${lead.phone}`} className="text-primary hover:underline">{lead.phone}</a>}
          {lead.rating && <span>★ {lead.rating.toFixed(1)}</span>}
          {lead.review_count !== null && <span>{lead.review_count} reviews</span>}
          {lead.owner_name && <span className="font-medium text-foreground">Owner: {lead.owner_name}</span>}
        </div>
        <div className="text-sm text-muted-foreground mt-1">{lead.city}, {lead.state}</div>
        {lead.website && <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">{lead.website}</a>}
      </div>

      {notes?.ai_summary && (
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Summary</div>
          <p className="text-sm">{notes.ai_summary}</p>
        </div>
      )}

      {notes?.attack_angles && notes.attack_angles.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Attack Angles</div>
          <ul className="text-sm space-y-1">
            {notes.attack_angles.map((a, i) => <li key={i}>• {a}</li>)}
          </ul>
        </div>
      )}

      {notes?.review_themes && notes.review_themes.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Review Themes</div>
          <ul className="text-sm space-y-1">
            {notes.review_themes.map((t, i) => <li key={i}>• {t}</li>)}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {enrichment?.site_builder && <Badge variant="outline">{enrichment.site_builder}</Badge>}
        {enrichment?.booking_path_quality && <Badge variant="outline">booking: {enrichment.booking_path_quality}</Badge>}
        {enrichment?.has_chat_widget && <Badge variant="outline">chat: {enrichment.chat_widget_vendor}</Badge>}
        {enrichment?.last_site_update_year && <Badge variant="outline">site updated {enrichment.last_site_update_year}</Badge>}
        {notes?.best_pitch && <Badge>pitch: {notes.best_pitch}</Badge>}
        {notes?.digital_maturity !== undefined && notes?.digital_maturity !== null && <Badge variant="outline">maturity: {notes.digital_maturity}/10</Badge>}
      </div>

      {enrichment?.facebook_url && (
        <div className="text-sm">
          <a href={enrichment.facebook_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Facebook</a>
          {enrichment.facebook_last_post && <span className="text-muted-foreground"> · last post {enrichment.facebook_last_post}</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write crm/components/lead-detail/script-tab.tsx**

```tsx
// crm/components/lead-detail/script-tab.tsx
'use client';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { BestPitch } from '@/lib/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Static imports — webpack will bundle these
import websiteScript from '@/app/scripts/website.md';
import mcbScript from '@/app/scripts/mcb.md';
import chatAiScript from '@/app/scripts/chat_ai.md';
import reputationScript from '@/app/scripts/reputation.md';
import ghlCrmScript from '@/app/scripts/ghl_crm.md';

const SCRIPTS: Record<BestPitch, string> = {
  website: websiteScript as unknown as string,
  mcb: mcbScript as unknown as string,
  chat_ai: chatAiScript as unknown as string,
  reputation: reputationScript as unknown as string,
  ghl_crm: ghlCrmScript as unknown as string,
};

const LABELS: Record<BestPitch, string> = {
  website: 'Website',
  mcb: 'Missed-Call Text-Back',
  chat_ai: 'Chat AI',
  reputation: 'Reputation',
  ghl_crm: 'GHL CRM',
};

export function ScriptTab({ defaultPitch }: { defaultPitch: BestPitch | null }) {
  const [pitch, setPitch] = useState<BestPitch>(defaultPitch ?? 'website');

  return (
    <div className="p-4 overflow-y-auto">
      <div className="mb-4">
        <Select value={pitch} onValueChange={(v) => setPitch(v as BestPitch)}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(LABELS) as BestPitch[]).map((p) => (
              <SelectItem key={p} value={p}>{LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown>{SCRIPTS[pitch]}</ReactMarkdown>
      </div>
    </div>
  );
}
```

Note: importing `.md` as modules requires a webpack loader. Add to `crm/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.module.rules.push({
      test: /\.md$/,
      type: 'asset/source',
    });
    return config;
  },
};

export default nextConfig;
```

Also add to `crm/global.d.ts`:

```ts
declare module '*.md' {
  const content: string;
  export default content;
}
```

- [ ] **Step 5: Write crm/components/lead-detail/call-log-tab.tsx**

```tsx
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
    startTransition(async () => {
      const result = await logCall(fd);
      if (result?.error) toast.error(result.error);
      else toast.success('Call logged');
      (e.target as HTMLFormElement).reset();
    });
  }

  return (
    <div className="p-4 space-y-6 overflow-y-auto">
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="outcome">Outcome</Label>
          <Select name="outcome" required>
            <SelectTrigger><SelectValue placeholder="Pick an outcome" /></SelectTrigger>
            <SelectContent>
              {OUTCOMES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pitch_used">Pitch used</Label>
          <Select name="pitch_used" defaultValue={defaultPitch ?? undefined}>
            <SelectTrigger><SelectValue placeholder="Pitch" /></SelectTrigger>
            <SelectContent>
              {PITCHES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="notes">Notes</Label>
          <Textarea name="notes" rows={3} />
        </div>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
      </form>

      <div>
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Prior calls ({priorCalls.length})</div>
        <ul className="space-y-2">
          {priorCalls.map((c) => (
            <li key={c.id} className="border-l-2 border-muted pl-3">
              <div className="text-sm font-medium">{c.outcome.replace(/_/g, ' ')} {c.pitch_used && <span className="text-muted-foreground">· {c.pitch_used}</span>}</div>
              {c.notes && <div className="text-sm text-muted-foreground">{c.notes}</div>}
              <div className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString()} {c.caller_name && `· ${c.caller_name}`}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write crm/components/lead-detail/index.tsx**

```tsx
// crm/components/lead-detail/index.tsx
'use client';
import { useEffect, useState } from 'react';
import { useStore } from '@/lib/store';
import type { LeadRow, LeadEnrichmentRow, LeadNotesRow, CallLogRow } from '@/lib/types';
import { createClient } from '@/lib/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { IntelTab } from './intel-tab';
import { ScriptTab } from './script-tab';
import { CallLogTab } from './call-log-tab';

export function LeadDetail({ leads }: { leads: LeadRow[] }) {
  const { selectedLeadId } = useStore();
  const lead = leads.find((l) => l.id === selectedLeadId) ?? null;
  const [enrichment, setEnrichment] = useState<LeadEnrichmentRow | null>(null);
  const [notes, setNotes] = useState<LeadNotesRow | null>(null);
  const [priorCalls, setPriorCalls] = useState<CallLogRow[]>([]);

  useEffect(() => {
    if (!lead) { setEnrichment(null); setNotes(null); setPriorCalls([]); return; }
    const sb = createClient();
    (async () => {
      const [e, n, c] = await Promise.all([
        sb.from('lead_enrichment').select('*').eq('lead_id', lead.id).maybeSingle(),
        sb.from('lead_notes').select('*').eq('lead_id', lead.id).maybeSingle(),
        sb.from('call_logs').select('*, team_members(full_name)').eq('lead_id', lead.id).order('created_at', { ascending: false }),
      ]);
      setEnrichment((e.data as LeadEnrichmentRow) ?? null);
      setNotes((n.data as LeadNotesRow) ?? null);
      setPriorCalls(((c.data ?? []) as any[]).map((r) => ({ ...r, caller_name: r.team_members?.full_name })));
    })();
  }, [lead?.id]);

  if (!lead) return <div className="flex-1 flex items-center justify-center text-muted-foreground">Pick a lead</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Tabs defaultValue="intel" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-3">
          <TabsTrigger value="intel">Intel</TabsTrigger>
          <TabsTrigger value="script">Script</TabsTrigger>
          <TabsTrigger value="call">Call Log</TabsTrigger>
        </TabsList>
        <TabsContent value="intel" className="flex-1 overflow-hidden"><IntelTab lead={lead} enrichment={enrichment} notes={notes} /></TabsContent>
        <TabsContent value="script" className="flex-1 overflow-hidden"><ScriptTab defaultPitch={lead.best_pitch} /></TabsContent>
        <TabsContent value="call" className="flex-1 overflow-hidden"><CallLogTab leadId={lead.id} defaultPitch={lead.best_pitch} priorCalls={priorCalls} /></TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 7: Build check**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm run build
```

Fix any type errors. Expected: clean build now that all imports exist.

- [ ] **Step 8: Commit**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/
git commit -m "feat(crm): add lead detail tabs (intel + script + call log) + seed scripts"
```

---

## Task 9: Team page + invite flow

**Files:** `crm/app/team/page.tsx`, `crm/components/team/leaderboard.tsx`, `crm/components/team/calls-chart.tsx`, `crm/components/team/invite-dialog.tsx`, `crm/app/actions/invite.ts`

- [ ] **Step 1: Write crm/app/actions/invite.ts**

```ts
// crm/app/actions/invite.ts
'use server';

import { createClient } from '@/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

export async function inviteTeammate(formData: FormData) {
  const cookieStore = await cookies();
  // Use service role key for admin invite
  const admin = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in' };

  const { data: me } = await supabase.from('team_members').select('role').eq('id', user.id).single();
  if (!me || !['owner', 'admin'].includes(me.role)) return { error: 'Only owners/admins can invite' };

  const email = formData.get('email') as string;
  const full_name = formData.get('full_name') as string;
  const role = (formData.get('role') as string) || 'caller';

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email);
  if (error || !data.user) return { error: error?.message ?? 'Invite failed' };

  await admin.from('team_members').insert({
    id: data.user.id,
    email,
    full_name,
    role,
  });

  revalidatePath('/team');
  return { ok: true };
}
```

- [ ] **Step 2: Write crm/components/team/leaderboard.tsx**

```tsx
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
```

- [ ] **Step 3: Write crm/components/team/calls-chart.tsx**

```tsx
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
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data}>
        <XAxis dataKey="day" />
        <YAxis />
        <Tooltip />
        <Legend />
        {callers.map((c) => (
          <Area key={c.id} type="monotone" dataKey={c.name} stackId="1" stroke={colorForId(c.id)} fill={colorForId(c.id)} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 4: Write crm/components/team/invite-dialog.tsx**

```tsx
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
      else { toast.success('Invited'); setOpen(false); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>Invite teammate</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Invite teammate</DialogTitle></DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2"><Label>Email</Label><Input name="email" type="email" required /></div>
          <div className="space-y-2"><Label>Full name</Label><Input name="full_name" required /></div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select name="role" defaultValue="caller">
              <SelectTrigger><SelectValue /></SelectTrigger>
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
```

- [ ] **Step 5: Write crm/app/team/page.tsx**

```tsx
// crm/app/team/page.tsx
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { TopBar } from '@/components/top-bar';
import { Leaderboard } from '@/components/team/leaderboard';
import { CallsChart } from '@/components/team/calls-chart';
import { InviteDialog } from '@/components/team/invite-dialog';
import type { TeamMember } from '@/lib/types';

export default async function TeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: member } = await supabase.from('team_members').select('*').eq('id', user.id).single<TeamMember>();
  if (!member) redirect('/login');

  const { data: members } = await supabase.from('team_members').select('*');
  const { data: calls } = await supabase
    .from('call_logs')
    .select('caller_id, outcome, created_at')
    .gte('created_at', new Date(Date.now() - 30 * 86400 * 1000).toISOString());

  // Build leaderboard (this week)
  const weekStart = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const weekRows = (members ?? []).map((m: any) => {
    const my = (calls ?? []).filter((c: any) => c.caller_id === m.id && c.created_at >= weekStart);
    return {
      caller_id: m.id,
      name: m.full_name ?? m.email,
      calls: my.length,
      interested: my.filter((c: any) => c.outcome === 'interested').length,
      booked: my.filter((c: any) => c.outcome === 'booked_demo').length,
      won: my.filter((c: any) => c.outcome === 'closed_won').length,
    };
  }).sort((a, b) => b.calls - a.calls);

  // Build chart data (30 days)
  const byDay: Record<string, Record<string, number>> = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000).toISOString().slice(0, 10);
    byDay[d] = {};
  }
  for (const c of calls ?? []) {
    const day = (c.created_at as string).slice(0, 10);
    const name = (members ?? []).find((m: any) => m.id === c.caller_id)?.full_name ?? 'unknown';
    byDay[day] = byDay[day] ?? {};
    byDay[day][name] = (byDay[day][name] ?? 0) + 1;
  }
  const chartData = Object.entries(byDay).map(([day, counts]) => ({ day: day.slice(5), ...counts }));
  const callers = (members ?? []).map((m: any) => ({ id: m.id, name: m.full_name ?? m.email }));

  const canInvite = member.role === 'owner' || member.role === 'admin';

  return (
    <div className="h-screen flex flex-col">
      <TopBar userName={member.full_name ?? member.email} />
      <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Team</h1>
          {canInvite && <InviteDialog />}
        </div>
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">This week</h2>
          <Leaderboard rows={weekRows} />
        </section>
        <section>
          <h2 className="text-sm font-semibold uppercase text-muted-foreground mb-3">Last 30 days</h2>
          <CallsChart data={chartData} callers={callers} />
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Build check**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm run build
```

- [ ] **Step 7: Commit**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add crm/app/team/ crm/components/team/ crm/app/actions/invite.ts
git commit -m "feat(crm): add team page with leaderboard, calls chart, invite flow"
```

---

## Task 10: Local dev test + Vercel deploy

No new code — this is the manual verification and deployment task.

- [ ] **Step 1: Run migrations against Supabase**

The user pastes `crm/migrations/005`, `006`, `007`, `008` into Supabase SQL Editor manually. Verify:

```sql
select count(*) from team_members;   -- expect 0
select count(*) from call_logs;       -- expect 0
select count(*) from saved_views;     -- expect 5 (seeded)
select * from leads_with_latest_call limit 1;  -- expect 1 row
```

- [ ] **Step 2: Start dev server**

```bash
cd /Users/projectatlas/projects/anchor-leads/crm
npm run dev
```

Open http://localhost:3000. Expected: redirected to `/login`.

- [ ] **Step 3: Bootstrap owner account**

Navigate to http://localhost:3000/bootstrap. Fill in name + email + password. Click Create account. Expected: redirected to main page, see lead list on left, lead detail on right.

- [ ] **Step 4: Click through a few leads**

Verify: clicking a lead updates the detail panel. Switch tabs (Intel/Script/Call Log). Log a test call. Check Supabase `call_logs` table → should see 1 row.

- [ ] **Step 5: Visit /team**

Should see the leaderboard with 1 row (yourself with 1 call). Chart shows today's spike.

- [ ] **Step 6: Log any obvious bugs and fix inline**

This is a manual pass. Common issues: missing env vars, RLS blocking reads, chart not rendering, script markdown not importing. Fix, commit, retry.

- [ ] **Step 7: User creates Vercel account + links repo**

User action (not subagent):
1. Sign in to https://vercel.com with GitHub
2. Click "New Project" → import the `anchor-leads` repo
3. Root directory: **`crm`**
4. Framework preset: Next.js (auto-detected)
5. Environment variables: paste `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
6. Click Deploy

- [ ] **Step 8: Verify production deploy**

Open the Vercel URL. Sign in with the account created in Step 3. Same flow as dev should work.

- [ ] **Step 9: Commit any dev-fix patches**

```bash
cd /Users/projectatlas/projects/anchor-leads
git add -A
git commit -m "fix(crm): dev pass bug fixes"
```

---

## Self-Review

**Spec coverage:**
- §1 Purpose → Tasks 1–9 (the whole CRM)
- §2 Scope → matches — no Twilio, no transcription, no per-user assignment
- §3 Tech stack → Task 1
- §4 Data model → Task 2 (migrations) + Task 3 (types)
- §5 Layout → Task 6 (shell) + Tasks 7–8 (list, detail)
- §6 Filters + saved views → Task 4 (pure logic) + Task 7 (UI) + Task 2 (seeds)
- §7 Call outcomes → Task 8 (call log tab) — all 10 outcomes, terminal logic
- §8 Script loader → Task 8 (script tab + seed files + webpack config)
- §9 Team page → Task 9
- §10 Auth & session → Task 3 (middleware) + Task 5 (login/bootstrap) + Task 9 (invite)
- §11 File structure → matches Task 1 scaffold output
- §12 Deployment → Task 10
- §13 Error handling → toast error handling in server actions, middleware redirects on auth fail

**Placeholder scan:** no TBD/TODO/"implement later" in the plan. All code blocks complete.

**Type consistency:** `FilterState`, `LeadRow`, `SavedView`, `CallOutcome`, `BestPitch` defined once in Task 3 (`lib/types.ts`) and imported consistently in Tasks 4, 6, 7, 8, 9.

**Known gaps accepted:** The "+ Save this view" button from the spec §6 is not in Task 7 (only `applyView` is wired up). Add a small follow-up task later if the user needs it during dogfooding. Flagging inline rather than blocking the plan.
