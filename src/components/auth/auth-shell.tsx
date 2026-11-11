import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SidCrawalLogo } from "@/components/brand/sidcrawal-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/supabase/env";

interface AuthShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function AuthShell({ title, description, children }: AuthShellProps) {
  const configured = isSupabaseConfigured();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            <span>Back to SidCrawal</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md space-y-6">
          <div className="space-y-2">
            <Link href="/" className="inline-block">
              <SidCrawalLogo />
            </Link>
            <h1 className="pt-2 text-2xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>

          {!configured && (
            <Alert>
              <AlertTitle>Supabase credentials not configured</AlertTitle>
              <AlertDescription>
                Add <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
                and <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
                to <code className="font-mono text-xs">.env.local</code> and apply{" "}
                <code className="font-mono text-xs">supabase/migrations/</code> to
                enable live authentication.
              </AlertDescription>
            </Alert>
          )}

          <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
