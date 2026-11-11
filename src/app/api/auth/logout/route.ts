import { NextResponse } from "next/server";
import { formatAuthError } from "@/lib/auth/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, redirectTo: "/login" });
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json(
      {
        error: {
          code: "LOGOUT_FAILED",
          message: formatAuthError(error, "Unable to sign out cleanly. Try again."),
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    redirectTo: "/login",
  });
}
