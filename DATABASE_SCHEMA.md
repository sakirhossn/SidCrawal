# SidCrawal — Database Schema Specification

**Database Engine:** PostgreSQL (Supabase)  
**Security Model:** Row Level Security (RLS) enabled on all user-facing tables; `service_role` restricted to backend worker & dispatcher operations.  
**Implementation Status:** SQL migrations implemented in Phase 2 (`supabase/migrations/0001_initial_schema.sql` & `0002_rls_and_storage.sql`).

---

## 1. Entity Relationship Overview

```text
auth.users (Supabase Auth)
  ├── 1:1 ──> profiles
  ├── 1:1 ──> user_settings
  ├── 1:1 ──> usage_limits
  └── 1:N ──> monitors
                ├── 1:N ──> monitor_selections
                ├── 1:1 ──> crawl_jobs
                ├── 1:N ──> crawl_runs
                │             └── 0..N ──> snapshots
                ├── 1:N ──> detected_changes
                └── 1:N ──> notifications
```

---

## 2. Table Specifications

### 2.1 `profiles`
Stores user metadata synchronized from `auth.users` via trigger on signup.
- `id` (`uuid`, PK, FK -> `auth.users.id` ON DELETE CASCADE)
- `email` (`text`, NOT NULL, UNIQUE)
- `full_name` (`text`)
- `role` (`text`, NOT NULL, DEFAULT `'user'`, CHECK `role IN ('user', 'admin')`)
- `email_verified_at` (`timestamptz`)
- `created_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- `updated_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)

### 2.2 `user_settings`
Per-user notification and crawler defaults.
- `user_id` (`uuid`, PK, FK -> `profiles.id` ON DELETE CASCADE)
- `default_check_interval_minutes` (`integer`, NOT NULL, DEFAULT `60`, CHECK `>= 5`)
- `email_notifications_enabled` (`boolean`, NOT NULL, DEFAULT `true`)
- `weekly_digest_enabled` (`boolean`, NOT NULL, DEFAULT `false`)
- `timezone` (`text`, NOT NULL, DEFAULT `'UTC'`)
- `theme_preference` (`text`, NOT NULL, DEFAULT `'system'`, CHECK `IN ('light', 'dark', 'system')`)
- `created_at`, `updated_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)

### 2.3 `usage_limits`
Quota controls enforced by server API and worker dispatcher.
- `user_id` (`uuid`, PK, FK -> `profiles.id` ON DELETE CASCADE)
- `plan_tier` (`text`, NOT NULL, DEFAULT `'free'`, CHECK `IN ('free', 'pro', 'enterprise')`)
- `max_monitors` (`integer`, NOT NULL, DEFAULT `5`)
- `min_interval_minutes` (`integer`, NOT NULL, DEFAULT `60`)
- `max_monthly_crawls` (`integer`, NOT NULL, DEFAULT `2000`)
- `current_month_crawls` (`integer`, NOT NULL, DEFAULT `0`)
- `quota_reset_at` (`timestamptz`, NOT NULL)
- `created_at`, `updated_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)

### 2.4 `monitors`
Top-level monitored URL entity.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`)
- `user_id` (`uuid`, NOT NULL, FK -> `profiles.id` ON DELETE CASCADE)
- `name` (`text`, NOT NULL)
- `url` (`text`, NOT NULL, CHECK `url ~* '^https?://'`)
- `normalized_host` (`text`, NOT NULL)
- `status` (`text`, NOT NULL, DEFAULT `'draft'`, CHECK `IN ('draft', 'active', 'paused', 'error', 'blocked')`)
- `check_interval_minutes` (`integer`, NOT NULL, DEFAULT `60`, CHECK `>= 5`)
- `last_checked_at` (`timestamptz`)
- `last_changed_at` (`timestamptz`)
- `last_error_code` (`text`)
- `last_error_message` (`text`)
- `active_baseline_snapshot_id` (`uuid`, nullable FK -> `snapshots.id` ON DELETE SET NULL)
- `created_at`, `updated_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- **Indexes:** `(user_id, status)`, `(normalized_host)`.

### 2.5 `monitor_selections`
Exact DOM selectors, bounding regions, and preview baselines attached to a monitor.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`)
- `monitor_id` (`uuid`, NOT NULL, FK -> `monitors.id` ON DELETE CASCADE)
- `user_id` (`uuid`, NOT NULL, FK -> `profiles.id` ON DELETE CASCADE)
- `selection_type` (`text`, NOT NULL, CHECK `IN ('element', 'multi_element', 'region')`)
- `css_selector` (`text`) — primary or array serialization in `selectors_json`
- `selectors_json` (`jsonb`, NOT NULL, DEFAULT `'[]'::jsonb`)
- `element_metadata` (`jsonb`, NOT NULL, DEFAULT `'{}'::jsonb`) — tag name, attributes, ARIA label, DOM depth
- `bounding_box` (`jsonb`) — `{ "x": number, "y": number, "width": number, "height": number }`
- `viewport_dimensions` (`jsonb`, NOT NULL) — `{ "width": number, "height": number, "deviceScaleFactor": number }`
- `selected_text` (`text`)
- `normalization_rules` (`jsonb`, NOT NULL, DEFAULT `'{}'::jsonb`) — whitespace, regex strips, visual pixel threshold
- `is_active` (`boolean`, NOT NULL, DEFAULT `true`)
- `created_at`, `updated_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- **Indexes:** `(monitor_id, is_active)`, `(user_id)`.

### 2.6 `crawl_jobs`
Scheduler state table polled by Cloudflare Workers.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`)
- `monitor_id` (`uuid`, NOT NULL, UNIQUE, FK -> `monitors.id` ON DELETE CASCADE)
- `user_id` (`uuid`, NOT NULL, FK -> `profiles.id` ON DELETE CASCADE)
- `state` (`text`, NOT NULL, DEFAULT `'idle'`, CHECK `IN ('idle', 'queued', 'running', 'paused', 'backoff')`)
- `next_run_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- `locked_at` (`timestamptz`)
- `locked_by` (`text`)
- `consecutive_failures` (`integer`, NOT NULL, DEFAULT `0`)
- `last_dispatched_at` (`timestamptz`)
- `created_at`, `updated_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- **Indexes:** Partial index on `(next_run_at)` WHERE `state IN ('idle', 'backoff')`.

### 2.7 `crawl_runs`
Immutable execution log for every crawler attempt.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`)
- `monitor_id` (`uuid`, NOT NULL, FK -> `monitors.id` ON DELETE CASCADE)
- `user_id` (`uuid`, NOT NULL, FK -> `profiles.id` ON DELETE CASCADE)
- `job_id` (`uuid`, FK -> `crawl_jobs.id` ON DELETE SET NULL)
- `trigger_source` (`text`, NOT NULL, CHECK `IN ('baseline', 'scheduled', 'manual')`)
- `status` (`text`, NOT NULL, CHECK `IN ('started', 'succeeded', 'failed', 'blocked', 'timeout')`)
- `http_status` (`integer`)
- `resolved_ip` (`inet`)
- `duration_ms` (`integer`)
- `error_code` (`text`)
- `error_message` (`text`)
- `started_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- `completed_at` (`timestamptz`)
- **Indexes:** `(monitor_id, started_at DESC)`, `(user_id, started_at DESC)`.

### 2.8 `snapshots`
Captured DOM/text state and Supabase Storage keys. Baselines remain intact if later runs fail.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`)
- `monitor_id` (`uuid`, NOT NULL, FK -> `monitors.id` ON DELETE CASCADE)
- `user_id` (`uuid`, NOT NULL, FK -> `profiles.id` ON DELETE CASCADE)
- `crawl_run_id` (`uuid`, NOT NULL, FK -> `crawl_runs.id` ON DELETE CASCADE)
- `is_baseline` (`boolean`, NOT NULL, DEFAULT `false`)
- `page_title` (`text`)
- `extracted_html` (`text`)
- `extracted_text` (`text`)
- `normalized_text` (`text`)
- `content_hash` (`text`, NOT NULL)
- `element_screenshot_path` (`text`) — private Supabase Storage path
- `full_page_screenshot_path` (`text`) — private Supabase Storage path
- `visual_hash` (`text`)
- `captured_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- **Indexes:** `(monitor_id, captured_at DESC)`, `(content_hash)`.

### 2.9 `detected_changes`
Meaningful change records comparing a previous snapshot and a newer snapshot.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`)
- `monitor_id` (`uuid`, NOT NULL, FK -> `monitors.id` ON DELETE CASCADE)
- `user_id` (`uuid`, NOT NULL, FK -> `profiles.id` ON DELETE CASCADE)
- `previous_snapshot_id` (`uuid`, NOT NULL, FK -> `snapshots.id` ON DELETE RESTRICT)
- `current_snapshot_id` (`uuid`, NOT NULL, FK -> `snapshots.id` ON DELETE RESTRICT)
- `change_type` (`text`, NOT NULL, CHECK `IN ('text', 'visual', 'both')`)
- `visual_diff_percentage` (`numeric(5,2)`)
- `diff_screenshot_path` (`text`)
- `previous_text_excerpt` (`text`)
- `current_text_excerpt` (`text`)
- `diff_summary` (`jsonb`, NOT NULL, DEFAULT `'{}'::jsonb`)
- `change_fingerprint` (`text`, NOT NULL) — used to deduplicate identical change alerts
- `detected_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- **Indexes:** `(monitor_id, detected_at DESC)`, `(monitor_id, change_fingerprint)`.

### 2.10 `notifications`
Email delivery audit log tied to Resend.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`)
- `user_id` (`uuid`, NOT NULL, FK -> `profiles.id` ON DELETE CASCADE)
- `monitor_id` (`uuid`, FK -> `monitors.id` ON DELETE SET NULL)
- `detected_change_id` (`uuid`, FK -> `detected_changes.id` ON DELETE SET NULL)
- `notification_type` (`text`, NOT NULL, CHECK `IN ('activation', 'change_alert', 'crawl_error', 'weekly_digest')`)
- `recipient_email` (`text`, NOT NULL)
- `subject` (`text`, NOT NULL)
- `status` (`text`, NOT NULL, DEFAULT `'queued'`, CHECK `IN ('queued', 'sent', 'failed', 'suppressed_duplicate')`)
- `provider_message_id` (`text`)
- `error_message` (`text`)
- `sent_at` (`timestamptz`)
- `created_at` (`timestamptz`, NOT NULL, DEFAULT `now()`)
- **Indexes:** `(user_id, created_at DESC)`, `(detected_change_id)`.

---

## 3. Storage Buckets & RLS Policies

- **Bucket `monitor-snapshots` (Private):** Stores `{user_id}/{monitor_id}/{run_id}/full.png`, `element.png`, and `diff.png`.
- **RLS Enforcement:**
  - All 10 tables enable `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`.
  - Users can `SELECT`, `INSERT`, `UPDATE`, `DELETE` only rows where `user_id = auth.uid()` (or `id = auth.uid()` on `profiles`).
  - Immutable audit tables (`crawl_runs`, `snapshots`, `detected_changes`, `notifications`) deny client-side `UPDATE`/`DELETE` and accept inserts only from trusted server/worker `service_role` contexts.
  - Admin read access in `admin` views uses explicit server-side role verification (`profiles.role = 'admin'`) without weakening tenant RLS for regular users.
