-- ============================================================================
-- SidCrawal Phase 2 Migration 0002: Row Level Security (RLS) & Private Storage
-- ============================================================================

-- Enable RLS across every table
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.usage_limits enable row level security;
alter table public.monitors enable row level security;
alter table public.monitor_selections enable row level security;
alter table public.crawl_jobs enable row level security;
alter table public.crawl_runs enable row level security;
alter table public.snapshots enable row level security;
alter table public.detected_changes enable row level security;
alter table public.notifications enable row level security;

-- Prevent non-service-role sessions from escalating profiles.role
create or replace function public.prevent_profile_role_escalation()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only service_role may modify user roles.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_role_on_update on public.profiles;
create trigger protect_profile_role_on_update
  before update on public.profiles
  for each row execute function public.prevent_profile_role_escalation();

-- 1. profiles policies
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can insert own standard profile" on public.profiles;
create policy "Users can insert own standard profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id and role = 'user');

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 2. user_settings policies
drop policy if exists "Users can view own settings" on public.user_settings;
create policy "Users can view own settings"
  on public.user_settings for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own settings" on public.user_settings;
create policy "Users can insert own settings"
  on public.user_settings for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own settings" on public.user_settings;
create policy "Users can update own settings"
  on public.user_settings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. usage_limits policies (read-only for authenticated users; mutated by service_role)
drop policy if exists "Users can view own usage limits" on public.usage_limits;
create policy "Users can view own usage limits"
  on public.usage_limits for select
  to authenticated
  using (auth.uid() = user_id);

-- 4. monitors policies
drop policy if exists "Users can view own monitors" on public.monitors;
create policy "Users can view own monitors"
  on public.monitors for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own monitors" on public.monitors;
create policy "Users can insert own monitors"
  on public.monitors for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own monitors" on public.monitors;
create policy "Users can update own monitors"
  on public.monitors for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own monitors" on public.monitors;
create policy "Users can delete own monitors"
  on public.monitors for delete
  to authenticated
  using (auth.uid() = user_id);

-- 5. monitor_selections policies (verify both user_id and parent monitor ownership)
drop policy if exists "Users can view own monitor selections" on public.monitor_selections;
create policy "Users can view own monitor selections"
  on public.monitor_selections for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own monitor selections" on public.monitor_selections;
create policy "Users can insert own monitor selections"
  on public.monitor_selections for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.monitors m
      where m.id = monitor_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Users can update own monitor selections" on public.monitor_selections;
create policy "Users can update own monitor selections"
  on public.monitor_selections for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.monitors m
      where m.id = monitor_id and m.user_id = auth.uid()
    )
  );

drop policy if exists "Users can delete own monitor selections" on public.monitor_selections;
create policy "Users can delete own monitor selections"
  on public.monitor_selections for delete
  to authenticated
  using (auth.uid() = user_id);

-- 6. crawl_jobs policies (read-only to users; managed by dispatcher/worker service_role)
drop policy if exists "Users can view own crawl jobs" on public.crawl_jobs;
create policy "Users can view own crawl jobs"
  on public.crawl_jobs for select
  to authenticated
  using (auth.uid() = user_id);

-- 7. crawl_runs policies (immutable user read-only)
drop policy if exists "Users can view own crawl runs" on public.crawl_runs;
create policy "Users can view own crawl runs"
  on public.crawl_runs for select
  to authenticated
  using (auth.uid() = user_id);

-- 8. snapshots policies (immutable user read-only)
drop policy if exists "Users can view own snapshots" on public.snapshots;
create policy "Users can view own snapshots"
  on public.snapshots for select
  to authenticated
  using (auth.uid() = user_id);

-- 9. detected_changes policies (immutable user read-only)
drop policy if exists "Users can view own detected changes" on public.detected_changes;
create policy "Users can view own detected changes"
  on public.detected_changes for select
  to authenticated
  using (auth.uid() = user_id);

-- 10. notifications policies (immutable user read-only)
drop policy if exists "Users can view own notifications" on public.notifications;
create policy "Users can view own notifications"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

-- ============================================================================
-- Private Storage Bucket & Object Policies for Monitor Snapshots
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'monitor-snapshots',
  'monitor-snapshots',
  false,
  15728640,
  array['image/png', 'image/webp', 'image/jpeg']
)
on conflict (id) do update
  set public = false,
      file_size_limit = 15728640,
      allowed_mime_types = array['image/png', 'image/webp', 'image/jpeg'];

drop policy if exists "Users can read own monitor snapshots" on storage.objects;
create policy "Users can read own monitor snapshots"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'monitor-snapshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
