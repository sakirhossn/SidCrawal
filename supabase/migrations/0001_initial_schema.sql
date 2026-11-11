-- ============================================================================
-- SidCrawal Phase 2 Migration 0001: Core Relational Schema & Auth Triggers
-- ============================================================================

create extension if not exists pgcrypto;

-- Shared updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- 1. profiles (1:1 with auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  email_verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 2. user_settings (1:1 with profiles)
create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  default_check_interval_minutes integer not null default 60 check (default_check_interval_minutes >= 5),
  email_notifications_enabled boolean not null default true,
  weekly_digest_enabled boolean not null default false,
  timezone text not null default 'UTC',
  theme_preference text not null default 'system' check (theme_preference in ('light', 'dark', 'system')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger set_user_settings_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- 3. usage_limits (1:1 with profiles)
create table if not exists public.usage_limits (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan_tier text not null default 'free' check (plan_tier in ('free', 'pro', 'enterprise')),
  max_monitors integer not null default 5 check (max_monitors > 0),
  min_interval_minutes integer not null default 60 check (min_interval_minutes >= 5),
  max_monthly_crawls integer not null default 2000 check (max_monthly_crawls >= 0),
  current_month_crawls integer not null default 0 check (current_month_crawls >= 0),
  quota_reset_at timestamptz not null default (date_trunc('month', timezone('utc', now())) + interval '1 month'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger set_usage_limits_updated_at
  before update on public.usage_limits
  for each row execute function public.set_updated_at();

-- 4. monitors (active_baseline_snapshot_id FK added after snapshots table exists)
create table if not exists public.monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  url text not null check (url ~* '^https?://'),
  normalized_host text not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'error', 'blocked')),
  check_interval_minutes integer not null default 60 check (check_interval_minutes >= 5),
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_error_code text,
  last_error_message text,
  active_baseline_snapshot_id uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_monitors_user_status on public.monitors(user_id, status);
create index if not exists idx_monitors_normalized_host on public.monitors(normalized_host);

create trigger set_monitors_updated_at
  before update on public.monitors
  for each row execute function public.set_updated_at();

-- 5. monitor_selections
create table if not exists public.monitor_selections (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  selection_type text not null check (selection_type in ('element', 'multi_element', 'region')),
  css_selector text,
  selectors_json jsonb not null default '[]'::jsonb,
  element_metadata jsonb not null default '{}'::jsonb,
  bounding_box jsonb,
  viewport_dimensions jsonb not null,
  selected_text text,
  normalization_rules jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_monitor_selections_monitor_active on public.monitor_selections(monitor_id, is_active);
create index if not exists idx_monitor_selections_user on public.monitor_selections(user_id);

create trigger set_monitor_selections_updated_at
  before update on public.monitor_selections
  for each row execute function public.set_updated_at();

-- 6. crawl_jobs
create table if not exists public.crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null unique references public.monitors(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  state text not null default 'idle' check (state in ('idle', 'queued', 'running', 'paused', 'backoff')),
  next_run_at timestamptz not null default timezone('utc', now()),
  locked_at timestamptz,
  locked_by text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_dispatched_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_crawl_jobs_due
  on public.crawl_jobs(next_run_at)
  where state in ('idle', 'backoff');

create trigger set_crawl_jobs_updated_at
  before update on public.crawl_jobs
  for each row execute function public.set_updated_at();

-- 7. crawl_runs
create table if not exists public.crawl_runs (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.crawl_jobs(id) on delete set null,
  trigger_source text not null check (trigger_source in ('baseline', 'scheduled', 'manual')),
  status text not null check (status in ('started', 'succeeded', 'failed', 'blocked', 'timeout')),
  http_status integer,
  resolved_ip inet,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  error_code text,
  error_message text,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz
);

create index if not exists idx_crawl_runs_monitor_started on public.crawl_runs(monitor_id, started_at desc);
create index if not exists idx_crawl_runs_user_started on public.crawl_runs(user_id, started_at desc);

-- 8. snapshots
create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  crawl_run_id uuid not null references public.crawl_runs(id) on delete cascade,
  is_baseline boolean not null default false,
  page_title text,
  extracted_html text,
  extracted_text text,
  normalized_text text,
  content_hash text not null,
  element_screenshot_path text,
  full_page_screenshot_path text,
  visual_hash text,
  captured_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_snapshots_monitor_captured on public.snapshots(monitor_id, captured_at desc);
create index if not exists idx_snapshots_content_hash on public.snapshots(content_hash);

-- Complete circular FK on monitors -> snapshots
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'monitors_active_baseline_snapshot_fk'
  ) then
    alter table public.monitors
      add constraint monitors_active_baseline_snapshot_fk
      foreign key (active_baseline_snapshot_id)
      references public.snapshots(id)
      on delete set null;
  end if;
end $$;

-- 9. detected_changes
create table if not exists public.detected_changes (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  previous_snapshot_id uuid not null references public.snapshots(id) on delete restrict,
  current_snapshot_id uuid not null references public.snapshots(id) on delete restrict,
  change_type text not null check (change_type in ('text', 'visual', 'both')),
  visual_diff_percentage numeric(5,2),
  diff_screenshot_path text,
  previous_text_excerpt text,
  current_text_excerpt text,
  diff_summary jsonb not null default '{}'::jsonb,
  change_fingerprint text not null,
  detected_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_detected_changes_monitor_detected on public.detected_changes(monitor_id, detected_at desc);
create index if not exists idx_detected_changes_fingerprint on public.detected_changes(monitor_id, change_fingerprint);

-- 10. notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  monitor_id uuid references public.monitors(id) on delete set null,
  detected_change_id uuid references public.detected_changes(id) on delete set null,
  notification_type text not null check (notification_type in ('activation', 'change_alert', 'crawl_error', 'weekly_digest')),
  recipient_email text not null,
  subject text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'suppressed_duplicate')),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_notifications_user_created on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_detected_change on public.notifications(detected_change_id);

-- ============================================================================
-- Automatic User Profile, Default Settings & Usage Quota Provisioning
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  extracted_name text;
begin
  extracted_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');

  insert into public.profiles (id, email, full_name, role, email_verified_at)
  values (
    new.id,
    coalesce(new.email, ''),
    extracted_name,
    'user',
    new.email_confirmed_at
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        email_verified_at = coalesce(excluded.email_verified_at, public.profiles.email_verified_at);

  insert into public.user_settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.usage_limits (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, email_confirmed_at, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();
