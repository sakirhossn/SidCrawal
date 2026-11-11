import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");

const REQUIRED_TABLES = [
  "profiles",
  "user_settings",
  "usage_limits",
  "monitors",
  "monitor_selections",
  "crawl_jobs",
  "crawl_runs",
  "snapshots",
  "detected_changes",
  "notifications",
];

describe("Supabase SQL migrations & RLS policies", () => {
  const schemaSql = fs
    .readFileSync(path.join(MIGRATIONS_DIR, "0001_initial_schema.sql"), "utf8")
    .toLowerCase();
  const rlsSql = fs
    .readFileSync(path.join(MIGRATIONS_DIR, "0002_rls_and_storage.sql"), "utf8")
    .toLowerCase();
  const triggerSql = fs
    .readFileSync(
      path.join(MIGRATIONS_DIR, "0003_monitor_activation_trigger.sql"),
      "utf8"
    )
    .toLowerCase();
  const phase4Sql = fs
    .readFileSync(
      path.join(MIGRATIONS_DIR, "0004_crawler_scheduling_and_rpcs.sql"),
      "utf8"
    )
    .toLowerCase();
  const phase6Sql = fs
    .readFileSync(
      path.join(MIGRATIONS_DIR, "0005_phase6_concurrency_and_telemetry.sql"),
      "utf8"
    )
    .toLowerCase();

  it("defines all 10 schema tables and automatic profile provisioning trigger", () => {
    for (const table of REQUIRED_TABLES) {
      expect(schemaSql).toContain(`create table if not exists public.${table}`);
    }
    expect(schemaSql).toContain("create or replace function public.handle_new_user()");
    expect(schemaSql).toContain("create trigger on_auth_user_created");
    expect(triggerSql).toContain("sync_crawl_job_from_monitor");
    expect(phase4Sql).toContain("claim_due_crawl_jobs");
    expect(phase4Sql).toContain("for update of j skip locked");
    expect(phase4Sql).toContain("increment_monthly_crawl_usage");
    expect(phase4Sql).toContain("grant execute on function public.claim_due_crawl_jobs");
  });

  it("enables RLS on every table, blocks role escalation, and keeps storage private", () => {
    for (const table of REQUIRED_TABLES) {
      expect(rlsSql).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(rlsSql).toContain("prevent_profile_role_escalation");
    expect(rlsSql).toContain("'monitor-snapshots'");
    expect(rlsSql).toContain("public = false");
  });

  it("defines Phase 6 per-user concurrency caps, stale lock recovery, and API error telemetry RLS", () => {
    expect(phase6Sql).toContain("max_concurrent_jobs");
    expect(phase6Sql).toContain("create table if not exists public.api_error_events");
    expect(phase6Sql).toContain("alter table public.api_error_events enable row level security;");
    expect(phase6Sql).toContain("recover_stale_crawl_jobs");
    expect(phase6Sql).toContain("remaining_user_slots");
    expect(phase6Sql).toContain("grant execute on function public.recover_stale_crawl_jobs(integer) to service_role");
  });
});
