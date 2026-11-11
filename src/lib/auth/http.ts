import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export function jsonError(
  code: string,
  message: string,
  status: number
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function parseValidatedJson<T>(
  request: Request,
  schema: ZodType<T>
): Promise<{ data: T } | { response: NextResponse }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: jsonError("INVALID_JSON", "Invalid JSON payload.", 400) };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      response: jsonError(
        "VALIDATION_ERROR",
        parsed.error.issues[0]?.message ?? "Check your form inputs.",
        400
      ),
    };
  }

  return { data: parsed.data };
}

export async function requireSupabaseClient(): Promise<
  { supabase: SupabaseClient } | { response: NextResponse }
> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return {
      response: jsonError(
        "SUPABASE_UNCONFIGURED",
        "Supabase authentication is not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local.",
        503
      ),
    };
  }
  return { supabase };
}
