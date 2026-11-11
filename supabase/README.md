# SidCrawal Supabase Migrations & Auth Configuration

## Applying Migrations to a Hosted Supabase Project

1. Open your Supabase Dashboard -> **SQL Editor** (or link via Supabase CLI: `npx supabase link --project-ref <your-ref>`).
2. Run the migration files in order:
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_rls_and_storage.sql`
   - `supabase/migrations/0003_monitor_activation_trigger.sql`
   - `supabase/migrations/0004_crawler_scheduling_and_rpcs.sql`
3. Under **Authentication -> URL Configuration** in Supabase Dashboard:
   - **Site URL:** `http://localhost:3000` (local) or your production Vercel URL.
   - **Redirect URLs:** add:
     - `http://localhost:3000/auth/callback`
     - `https://your-production-domain.vercel.app/auth/callback`
4. Ensure **Authentication -> Providers -> Email** has **Confirm email** enabled so email ownership verification runs on registration.
5. Copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.
