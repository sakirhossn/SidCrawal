import { NextResponse } from "next/server";
import { getServerIntegrationStatus } from "@/lib/integration-status";
import { applyRateLimit } from "@/lib/security/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export async function GET(request: Request) {
  const rateLimit = await applyRateLimit(request, "public_health");
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  const integrations = getServerIntegrationStatus().map(
    ({ id, label, phase, configured }) => ({
      id,
      label,
      phase,
      configured,
    })
  );

  return NextResponse.json(
    {
      service: "sidcrawal-web",
      phase: "phase-6-production-hardening",
      ok: true,
      supabaseConfigured: isSupabaseConfigured(),
      integrations,
    },
    { status: 200, headers: rateLimit.headers }
  );
}
