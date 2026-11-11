import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, parseValidatedJson } from "@/lib/auth/http";
import { processQueuedNotifications } from "@/lib/email/notifications";
import { verifyBearerSecret } from "@/lib/security/internal-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const drainSchema = z
  .object({
    limit: z.number().int().min(1).max(50).default(20),
    detectedChangeId: z.string().uuid().optional(),
  })
  .default({ limit: 20 });

export async function POST(request: Request) {
  if (
    !verifyBearerSecret(
      request.headers.get("authorization"),
      process.env.CLOUDFLARE_DISPATCH_SECRET
    )
  ) {
    return jsonError(
      "UNAUTHORIZED_DISPATCHER",
      "Invalid or missing dispatcher authorization token.",
      401
    );
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    return jsonError(
      "SUPABASE_ADMIN_UNCONFIGURED",
      "SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL are required.",
      503
    );
  }

  let input: z.infer<typeof drainSchema> = { limit: 20 };
  const contentLen = request.headers.get("content-length");
  if (contentLen && Number(contentLen) > 0) {
    const parsed = await parseValidatedJson(request, drainSchema);
    if ("response" in parsed) {
      return parsed.response;
    }
    input = parsed.data;
  }

  const summary = await processQueuedNotifications(supabaseAdmin, input);
  return NextResponse.json({ ok: true, ...summary }, { status: 200 });
}
