import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "./env";

let browserClient: SupabaseClient | null = null;

/**
 * Creates or returns a cached browser Supabase client when public env vars are configured.
 * Returns `null` during Phase 1 unconfigured preview instead of throwing runtime errors.
 */
export function createSupabaseBrowserClient(): SupabaseClient | null {
  const { url, anonKey, configured } = getPublicSupabaseConfig();
  if (!configured) {
    return null;
  }

  if (!browserClient) {
    browserClient = createBrowserClient(url, anonKey);
  }

  return browserClient;
}
