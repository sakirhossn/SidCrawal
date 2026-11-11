import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getPublicSupabaseConfig } from "./env";

/**
 * Creates a request-scoped server Supabase client via `@supabase/ssr`.
 * Returns `null` when Supabase credentials are not yet configured.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient | null> {
  const { url, anonKey, configured } = getPublicSupabaseConfig();
  if (!configured) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called inside a Server Component; cookie writes are handled by src/proxy.ts.
        }
      },
    },
  });
}
