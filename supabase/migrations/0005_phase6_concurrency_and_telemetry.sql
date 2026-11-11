-- ============================================================================
-- SidCrawal Phase 6 Migration 0005: Per-User Concurrency, Stale Lock Recovery & API Error Telemetry
-- ============================================================================

-- 1. Add per-user concurrent crawler job cap to usage_limits
alter table public.usage_limits
  add column if not exists max_concurrent_jobs integer not null default 2
  check (max_concurrent_jobs >= 1);

-- 2. Operational API / SSRF / Rate-Limit error telemetry (admin-only audit ledger)
create table if not exists public.api_error_events (
  id uuid primary key default gen_random_uuid(),
  route text not null,
  method text not null,
  status_code integer not null,
  error_code text not null,
  message text not null,
  user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_api_error_events_created_at
  on public.api_error_events(created_at desc);
create index if not exists idx_api_error_events_error_code
  on public.api_error_events(error_code, created_at desc);

alter table public.api_error_events enable row level security;

-- 3. Explicit stale worker lock recovery (never mutates active_baseline_snapshot_id)
create or replace function public.recover_stale_crawl_jobs(
  p_stale_minutes integer default 10
)
returns table (
  recovered_job_id uuid,
  monitor_id uuid,
  new_consecutive_failures integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_cutoff timestamptz := v_now - make_interval(mins => greatest(1, coalesce(p_stale_minutes, 10)));
begin
  return query
  update public.crawl_jobs j
    set state = 'backoff',
        locked_at = null,
        locked_by = null,
        consecutive_failures = j.consecutive_failures + 1,
        next_run_at = v_now + make_interval(
          mins => least(60, 2 * power(2, least(j.consecutive_failures, 4))::integer)
        )
    where j.state in ('queued', 'running')
      and j.locked_at is not null
      and j.locked_at < v_cutoff
    returning j.id as recovered_job_id, j.monitor_id, j.consecutive_failures as new_consecutive_failures;
end;
$$;

-- 4. Update claim_due_crawl_jobs to recover stale locks AND enforce per-user concurrency quotas
create or replace function public.claim_due_crawl_jobs(
  p_limit integer default 10,
  p_worker_id text default 'dispatcher'
)
returns table (
  job_id uuid,
  monitor_id uuid,
  user_id uuid,
  url text,
  monitor_name text,
  check_interval_minutes integer,
  consecutive_failures integer,
  active_baseline_snapshot_id uuid,
  trigger_source text,
  selection_id uuid,
  selection_type text,
  css_selector text,
  selectors_json jsonb,
  bounding_box jsonb,
  viewport_dimensions jsonb,
  normalization_rules jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
begin
  perform public.recover_stale_crawl_jobs(10);

  return query
  with due_candidates as (
    select
      j.id as candidate_job_id,
      j.monitor_id as candidate_monitor_id,
      row_number() over (partition by j.user_id order by j.next_run_at asc) as user_rank,
      u.max_concurrent_jobs - (
        select count(*)::integer
        from public.crawl_jobs aj
        where aj.user_id = j.user_id
          and aj.state in ('queued', 'running')
      ) as remaining_user_slots
    from public.crawl_jobs j
    join public.monitors m on m.id = j.monitor_id
    join public.usage_limits u on u.user_id = j.user_id
    join public.monitor_selections ms
      on ms.monitor_id = m.id
     and ms.is_active = true
    where j.state in ('idle', 'backoff')
      and j.next_run_at <= v_now
      and m.status in ('active', 'error')
      and (
        u.quota_reset_at <= v_now
        or u.current_month_crawls < u.max_monthly_crawls
      )
    order by j.next_run_at asc
  ),
  fair_candidates as (
    select candidate_job_id
    from due_candidates
    where remaining_user_slots > 0
      and user_rank <= remaining_user_slots
    limit v_limit
  ),
  claimed as (
    update public.crawl_jobs j
      set state = 'queued',
          locked_at = v_now,
          locked_by = coalesce(nullif(trim(p_worker_id), ''), 'dispatcher'),
          last_dispatched_at = v_now
      from fair_candidates d
      where j.id = d.candidate_job_id
        and j.state in ('idle', 'backoff')
      returning j.id, j.monitor_id, j.user_id, j.consecutive_failures
  )
  select
    c.id as job_id,
    m.id as monitor_id,
    m.user_id as user_id,
    m.url as url,
    m.name as monitor_name,
    m.check_interval_minutes as check_interval_minutes,
    c.consecutive_failures as consecutive_failures,
    m.active_baseline_snapshot_id as active_baseline_snapshot_id,
    case
      when m.active_baseline_snapshot_id is null then 'baseline'
      else 'scheduled'
    end as trigger_source,
    ms.id as selection_id,
    ms.selection_type as selection_type,
    ms.css_selector as css_selector,
    ms.selectors_json as selectors_json,
    ms.bounding_box as bounding_box,
    ms.viewport_dimensions as viewport_dimensions,
    ms.normalization_rules as normalization_rules
  from claimed c
  join public.monitors m on m.id = c.monitor_id
  join lateral (
    select s.*
    from public.monitor_selections s
    where s.monitor_id = m.id
      and s.is_active = true
    order by s.created_at desc
    limit 1
  ) ms on true;
end;
$$;

revoke all on function public.recover_stale_crawl_jobs(integer) from public, anon, authenticated;
grant execute on function public.recover_stale_crawl_jobs(integer) to service_role;

revoke all on function public.claim_due_crawl_jobs(integer, text) from public, anon, authenticated;
grant execute on function public.claim_due_crawl_jobs(integer, text) to service_role;
