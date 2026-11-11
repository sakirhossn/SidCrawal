-- ============================================================================
-- SidCrawal Phase 3 Migration 0003: Automatic Crawl Job Sync on Monitor Change
-- ============================================================================

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
      timezone('utc', now()) + make_interval(mins => new.check_interval_minutes)
    )
    on conflict (monitor_id) do update
      set state = case
            when public.crawl_jobs.state = 'running' then 'running'
            else 'idle'
          end,
          next_run_at = coalesce(
            public.crawl_jobs.next_run_at,
            timezone('utc', now()) + make_interval(mins => new.check_interval_minutes)
          );
  elsif new.status in ('paused', 'draft', 'blocked') then
    update public.crawl_jobs
      set state = 'paused'
      where monitor_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_crawl_job_after_monitor_write on public.monitors;
create trigger sync_crawl_job_after_monitor_write
  after insert or update of status, check_interval_minutes on public.monitors
  for each row execute function public.sync_crawl_job_from_monitor();
