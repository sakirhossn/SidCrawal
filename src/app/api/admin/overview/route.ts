import { NextResponse } from "next/server";
import {
  fetchAdminOperationalMetrics,
  requireAdminSession,
} from "@/lib/admin/metrics";
import { applyRateLimit } from "@/lib/security/rate-limit";

export async function GET(request: Request) {
  const rateLimit = await applyRateLimit(request, "monitor_write");
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  const admin = await requireAdminSession();
  if ("response" in admin) {
    return admin.response;
  }

  const metrics = await fetchAdminOperationalMetrics(admin.supabaseAdmin);
  return NextResponse.json(
    {
      ok: true,
      metrics,
    },
    { status: 200, headers: rateLimit.headers }
  );
}
