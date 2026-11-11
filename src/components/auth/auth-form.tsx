"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  MailCheck,
  ShieldAlert,
} from "lucide-react";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyResendSchema,
} from "@/lib/auth/schemas";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type AuthMode =
  | "login"
  | "register"
  | "forgot-password"
  | "verify-email"
  | "reset-password";

interface AuthFormProps {
  mode: AuthMode;
  supabaseConfigured: boolean;
  hasRecoverySession?: boolean;
}

const MODE_ENDPOINTS: Record<AuthMode, string> = {
  login: "/api/auth/login",
  register: "/api/auth/register",
  "forgot-password": "/api/auth/forgot-password",
  "verify-email": "/api/auth/resend-verification",
  "reset-password": "/api/auth/reset-password",
};

export function AuthForm({
  mode,
  supabaseConfigured,
  hasRecoverySession = false,
}: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialEmail = searchParams.get("email") ?? "";
  const queryError = searchParams.get("error");
  const isVerifiedBanner = searchParams.get("verified") === "1";
  const unverifiedReason = searchParams.get("reason") === "unverified";
  const nextPath = sanitizeRedirectPath(searchParams.get("next"), "/dashboard");

  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState(initialEmail);
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(queryError);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = React.useState<string | null>(
    isVerifiedBanner
      ? "Email verified. Sign in to continue to your dashboard."
      : null
  );
  const [registeredPendingEmail, setRegisteredPendingEmail] = React.useState<string | null>(
    null
  );

  function validateClientPayload(): Record<string, unknown> | null {
    if (mode === "register") {
      const parsed = registerSchema.safeParse({ fullName, email, password });
      if (!parsed.success) {
        setErrorMessage(parsed.error.issues[0]?.message ?? "Check your registration details.");
        return null;
      }
      return parsed.data;
    }

    if (mode === "login") {
      const parsed = loginSchema.safeParse({ email, password });
      if (!parsed.success) {
        setErrorMessage(parsed.error.issues[0]?.message ?? "Check your credentials.");
        return null;
      }
      return { ...parsed.data, next: nextPath };
    }

    if (mode === "reset-password") {
      const parsed = resetPasswordSchema.safeParse({ password, confirmPassword });
      if (!parsed.success) {
        setErrorMessage(parsed.error.issues[0]?.message ?? "Check your password inputs.");
        return null;
      }
      return parsed.data;
    }

    const schema =
      mode === "forgot-password" ? forgotPasswordSchema : verifyResendSchema;
    const parsed = schema.safeParse({ email });
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
      return null;
    }
    return parsed.data;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setErrorCode(null);
    setNoticeMessage(null);

    const payload = validateClientPayload();
    if (!payload) {
      return;
    }

    if (!supabaseConfigured) {
      setErrorCode("SUPABASE_UNCONFIGURED");
      setErrorMessage(
        "Supabase credentials are not configured yet. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local to submit."
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(MODE_ENDPOINTS[mode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        redirectTo?: string;
        requiresEmailVerification?: boolean;
        error?: { code?: string; message?: string };
      };

      if (!response.ok) {
        setErrorCode(data.error?.code ?? null);
        setErrorMessage(
          data.error?.message ?? "Unable to complete your request. Please try again."
        );
        return;
      }

      if (mode === "register" && data.requiresEmailVerification) {
        setRegisteredPendingEmail(email.trim());
        setNoticeMessage(
          data.message ??
            "Account created. Check your inbox and verify your email address before signing in."
        );
        return;
      }

      if (mode === "login" || mode === "register" || mode === "reset-password") {
        const target = sanitizeRedirectPath(data.redirectTo, nextPath);
        router.push(target);
        router.refresh();
        return;
      }

      setNoticeMessage(data.message ?? "Request completed. Check your email inbox.");
    } catch {
      setErrorMessage(
        "Network error while contacting the authentication server. Try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === "reset-password" && supabaseConfigured && !hasRecoverySession) {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs leading-relaxed text-destructive"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            This password reset link is missing, invalid, or expired. Request a new
            password reset email to continue.
          </span>
        </div>
        <Link
          href="/forgot-password"
          className={cn(buttonVariants({ variant: "default", size: "default" }), "w-full")}
        >
          Request New Reset Link
        </Link>
      </div>
    );
  }

  if (registeredPendingEmail) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs leading-relaxed text-emerald-900 dark:text-emerald-200"
        >
          <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">
              Verify {registeredPendingEmail}
            </p>
            <p>{noticeMessage}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Link
            href={`/verify-email?email=${encodeURIComponent(registeredPendingEmail)}`}
            className={cn(buttonVariants({ variant: "outline", size: "default" }), "w-full")}
          >
            Didn&apos;t receive it? Resend verification
          </Link>
          <Link
            href="/login"
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "w-full")}
          >
            Return to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {mode === "verify-email" && (
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3.5 text-sm">
          <MailCheck
            className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">
              {unverifiedReason
                ? "Email verification required before dashboard access"
                : "Email ownership verification required"}
            </p>
            <p>
              Confirm your email address using the link sent to your inbox, or enter your
              email below to request a fresh verification email.
            </p>
          </div>
        </div>
      )}

      {mode === "register" && (
        <div className="space-y-1.5">
          <Label htmlFor="auth-full-name">Full name</Label>
          <Input
            id="auth-full-name"
            name="fullName"
            type="text"
            autoComplete="name"
            placeholder="Alex Rivera"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>
      )}

      {mode !== "reset-password" && (
        <div className="space-y-1.5">
          <Label htmlFor="auth-email">Work email</Label>
          <Input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>
      )}

      {(mode === "login" || mode === "register" || mode === "reset-password") && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="auth-password">
              {mode === "reset-password" ? "New password" : "Password"}
            </Label>
            {mode === "login" && (
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Forgot password?
              </Link>
            )}
          </div>
          <Input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="Minimum 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>
      )}

      {mode === "reset-password" && (
        <div className="space-y-1.5">
          <Label htmlFor="auth-confirm-password">Confirm new password</Label>
          <Input
            id="auth-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={isSubmitting}
            required
          />
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
          {errorCode === "EMAIL_NOT_CONFIRMED" && email.trim() && (
            <div>
              <Link
                href={`/verify-email?email=${encodeURIComponent(email.trim())}`}
                className="font-medium underline underline-offset-4 hover:text-foreground"
              >
                Resend verification email
              </Link>
            </div>
          )}
        </div>
      )}

      {noticeMessage && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-800 dark:text-emerald-300"
        >
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{noticeMessage}</span>
        </div>
      )}

      <Button type="submit" className="h-9 w-full" disabled={isSubmitting}>
        {isSubmitting && (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        )}
        <span>
          {mode === "login" && (isSubmitting ? "Signing in..." : "Sign in to Dashboard")}
          {mode === "register" && (isSubmitting ? "Creating account..." : "Create Account")}
          {mode === "forgot-password" &&
            (isSubmitting ? "Sending link..." : "Request Reset Link")}
          {mode === "verify-email" &&
            (isSubmitting ? "Sending email..." : "Resend Verification Email")}
          {mode === "reset-password" &&
            (isSubmitting ? "Updating password..." : "Update Password")}
        </span>
      </Button>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
        {mode === "login" ? (
          <>
            <span>Need an account?</span>
            <Link href="/register" className="font-medium text-foreground hover:underline">
              Create one
            </Link>
          </>
        ) : (
          <>
            <span>Already registered?</span>
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Sign in
            </Link>
          </>
        )}
      </div>
    </form>
  );
}
