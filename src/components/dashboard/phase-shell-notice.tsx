import Link from "next/link";
import { Info } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PhaseShellNoticeProps {
  phase: string;
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}

export function PhaseShellNotice({
  phase,
  title,
  description,
  actionHref,
  actionLabel,
  className,
}: PhaseShellNoticeProps) {
  return (
    <Alert className={cn(className)}>
      <Info className="size-4" aria-hidden="true" />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        <span>{title}</span>
        <Badge variant="outline" className="font-mono text-[11px] font-normal">
          {phase}
        </Badge>
      </AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{description}</p>
        {actionHref && actionLabel ? (
          <p>
            <Link
              href={actionHref}
              className="text-xs font-medium text-foreground underline underline-offset-4 hover:text-emerald-600 dark:hover:text-emerald-400"
            >
              {actionLabel}
            </Link>
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
