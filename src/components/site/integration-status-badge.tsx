import { AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface IntegrationStatusBadgeProps {
  configured: boolean;
  label?: string;
  className?: string;
}

export function IntegrationStatusBadge({
  configured,
  label,
  className,
}: IntegrationStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight",
        configured
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        className
      )}
    >
      {configured ? (
        <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span>
        {label ?? (configured ? "Supabase Connected" : "Phase 1 Shell • Integrations Pending")}
      </span>
    </span>
  );
}
