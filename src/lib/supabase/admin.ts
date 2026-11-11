import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "./env";

const PLACEHOLDER_TOKENS = ["placeholder", "your-"];

/**
 * Reads the server-only Supabase service_role key. Never import this module into Client Components.
 */
export function isSupabaseAdminConfigured(): boolean {
  const pub = getPublicSupabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!pub.configured || !serviceKey) return false;
  const lower = serviceKey.toLowerCase();
  return !PLACEHOLDER_TOKENS.some((token) => lower.includes(token));
}

/**
 * Creates a privileged `service_role` Supabase client strictly for internal dispatcher,
 * crawler storage upload, and webhook persistence routes.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  if (!isSupabaseAdminConfigured()) {
    return null;
  }

  const { url } = getPublicSupabaseConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();

  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
