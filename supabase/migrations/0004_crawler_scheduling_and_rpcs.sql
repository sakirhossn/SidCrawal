-- ============================================================================
-- SidCrawal Phase 4 Migration 0004: Immediate Baseline Trigger & Atomic Dispatch
-- ============================================================================

-- Ensure newly activated monitors without a baseline run immediately on next dispatch
create or replace function public.sync_crawl_job_from_monitor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'active' then
    insert into public.crawl_jobs (monitor_id, user_id, state, next_run_at)
    values (
      new.id,
      new.user_id,
      'idle',
      case
        when new.active_baseline_snapshot_id is null then timezone('utc', now())
        else timezone('utc', now()) + make_interval(mins => new.check_interval_minutes)
      end
    )
    on conflict (monitor_id) do update
      set state = case
            when public.crawl_jobs.state = 'running' then 'running'
            else 'idle'
          end,
          next_run_at = case
            when new.active_baseline_snapshot_id is null then timezone('utc', now())
            when public.crawl_jobs.state = 'paused' then timezone('utc', now())
            else coalesce(
              public.crawl_jobs.next_run_at,
              timezone('utc', now()) + make_interval(mins => new.check_interval_minutes)
            )
          end;
  elsif new.status in ('paused', 'draft', 'blocked') then
    update public.crawl_jobs
      set state = 'paused',
          locked_at = null,
          locked_by = null
      where monitor_id = new.id;
  end if;

  return new;
end;
$$;

-- Atomically claim due crawl jobs for scheduled/baseline execution (service_role only)
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
  -- Recover stale locks left behind by crashed/timed-out workers after 10 minutes
  update public.crawl_jobs
    set state = 'backoff',
        locked_at = null,
        locked_by = null
    where state in ('queued', 'running')
      and locked_at < (v_now - interval '10 minutes');

  return query
  with due_candidates as (
    select
      j.id as candidate_job_id,
      j.monitor_id as candidate_monitor_id
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
    limit v_limit
    for update of j skip locked
  ),
  claimed as (
    update public.crawl_jobs j
      set state = 'queued',
          locked_at = v_now,
          locked_by = coalesce(nullif(trim(p_worker_id), ''), 'dispatcher'),
          last_dispatched_at = v_now
      from due_candidates d
      where j.id = d.candidate_job_id
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

-- Increment monthly crawl counter with automatic cycle reset
create or replace function public.increment_monthly_crawl_usage(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
begin
  update public.usage_limits
    set current_month_crawls = case
          when quota_reset_at <= v_now then 1
          else current_month_crawls + 1
        end,
        quota_reset_at = case
          when quota_reset_at <= v_now then date_trunc('month', v_now) + interval '1 month'
          else quota_reset_at
        end
    where user_id = p_user_id;
end;
$$;

revoke all on function public.claim_due_crawl_jobs(integer, text) from public, anon, authenticated;
grant execute on function public.claim_due_crawl_jobs(integer, text) to service_role;

revoke all on function public.increment_monthly_crawl_usage(uuid) from public, anon, authenticated;
grant execute on function public.increment_monthly_crawl_usage(uuid) to service_role;
