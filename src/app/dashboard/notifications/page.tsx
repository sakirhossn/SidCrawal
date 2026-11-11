import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PhaseShellNotice } from "@/components/dashboard/phase-shell-notice";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentAccountContext } from "@/lib/auth/session";
import { getResendConfig } from "@/lib/email/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Notification History",
};

interface NotificationRow {
  id: string;
  monitor_id: string | null;
  detected_change_id: string | null;
  notification_type: string;
  recipient_email: string;
  subject: string;
  status: "queued" | "sent" | "failed" | "suppressed_duplicate";
  provider_message_id: string | null;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

async function NotificationHistoryContent() {
  const [account, emailConfig] = await Promise.all([
    getCurrentAccountContext(),
    Promise.resolve(getResendConfig()),
  ]);

  let rows: NotificationRow[] = [];
  if (account.configured && account.user) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data } = await supabase
        .from("notifications")
        .select(
          "id, monitor_id, detected_change_id, notification_type, recipient_email, subject, status, provider_message_id, error_message, sent_at, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(50);
      rows = (data ?? []) as NotificationRow[];
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Notification History
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit log for Resend email deliveries, monitor activation confirmations, and
          suppressed duplicate change alerts.
        </p>
      </div>

      {(!account.configured || !emailConfig.configured) && (
        <PhaseShellNotice
          phase="Phase 5 Ready"
          title="Connect Resend credentials to deliver live change alert emails"
          description={
            emailConfig.configured
              ? "Add Supabase credentials in .env.local to view persisted notification logs."
              : "Set RESEND_API_KEY and a verified EMAIL_FROM domain in .env.local to send verification, password reset, activation, and screenshot diff alerts via Resend."
          }
        />
      )}

      <Card>
        <CardHeader className="border-b border-border">
          <CardTitle>Email Delivery Ledger</CardTitle>
          <CardDescription>
            {rows.length} logged dispatch{rows.length === 1 ? "" : "es"} • Change alerts
            include inline before/after screenshots, visual diff masks, and deduplication.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-xs text-muted-foreground">
              No email notifications logged yet. Delivery statuses (queued, sent, failed,
              suppressed_duplicate) and Resend message IDs appear here automatically.
            </div>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {rows.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-start justify-between gap-3 p-3.5 text-xs"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {item.status}
                      </Badge>
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {item.notification_type}
                      </Badge>
                      {item.monitor_id ? (
                        <Link
                          href={`/dashboard/monitors/${item.monitor_id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {item.subject}
                        </Link>
                      ) : (
                        <span className="font-medium text-foreground">
                          {item.subject}
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      To: {item.recipient_email}
                      {item.provider_message_id
                        ? ` • Resend ID: ${item.provider_message_id}`
                        : ""}
                    </div>
                    {item.error_message && (
                      <div className="text-destructive">{item.error_message}</div>
                    )}
                  </div>
                  <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {new Date(item.sent_at ?? item.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function NotificationHistoryPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <NotificationHistoryContent />
    </Suspense>
  );
}
