"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  ChevronRight,
  Crosshair,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  PlusCircle,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react";
import { SidCrawalLogo } from "@/components/brand/sidcrawal-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { IntegrationStatusBadge } from "@/components/site/integration-status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DASHBOARD_NAV_ITEMS,
  type DashboardNavItem,
  type NavIconKey,
} from "@/lib/navigation";
import { cn } from "@/lib/utils";

const ICONS: Record<NavIconKey, React.ComponentType<{ className?: string }>> = {
  "layout-dashboard": LayoutDashboard,
  "plus-circle": PlusCircle,
  crosshair: Crosshair,
  activity: Activity,
  history: History,
  bell: Bell,
  settings: Settings,
  "shield-check": ShieldCheck,
};

const GROUP_LABELS: Record<DashboardNavItem["group"], string> = {
  primary: "Monitoring",
  history: "Logs & Alerts",
  system: "System",
};

export interface DashboardAccountSummary {
  configured: boolean;
  authenticated: boolean;
  email: string | null;
  fullName: string | null;
  role: "user" | "admin";
}

interface DashboardShellProps {
  account: DashboardAccountSummary;
  children: React.ReactNode;
}

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  if (
    href.startsWith("/dashboard/monitors/") &&
    href !== "/dashboard/monitors/new"
  ) {
    return (
      pathname.startsWith("/dashboard/monitors/") &&
      pathname !== "/dashboard/monitors/new"
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavListContent({
  collapsed,
  role,
  onNavigate,
}: {
  collapsed: boolean;
  role: "user" | "admin";
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const groups: DashboardNavItem["group"][] = ["primary", "history", "system"];

  return (
    <nav
      aria-label="Dashboard navigation"
      className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4"
    >
      {groups.map((group) => {
        const items = DASHBOARD_NAV_ITEMS.filter(
          (item) =>
            item.group === group &&
            (item.href !== "/dashboard/admin" || role === "admin")
        );
        if (items.length === 0) return null;

        return (
          <div key={group} className="space-y-1">
            {!collapsed && (
              <div className="px-2.5 pb-1 text-[11px] font-medium text-muted-foreground">
                {GROUP_LABELS[group]}
              </div>
            )}
            {items.map((item) => {
              const Icon = ICONS[item.icon];
              const active = isRouteActive(pathname, item.href);
              const linkEl = (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    collapsed && "justify-center px-2",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      active
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground group-hover:text-foreground"
                    )}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger render={linkEl} />
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              }

              return linkEl;
            })}
          </div>
        );
      })}
    </nav>
  );
}

function NavList(props: {
  collapsed: boolean;
  role: "user" | "admin";
  onNavigate?: () => void;
}) {
  return (
    <React.Suspense fallback={<div className="flex-1 px-2.5 py-4" />}>
      <NavListContent {...props} />
    </React.Suspense>
  );
}

function BreadcrumbTitleContent() {
  const pathname = usePathname();
  const currentNav =
    DASHBOARD_NAV_ITEMS.find((item) => isRouteActive(pathname, item.href)) ??
    DASHBOARD_NAV_ITEMS[0];

  return (
    <span className="truncate font-medium text-foreground">
      {currentNav.label}
    </span>
  );
}

export function DashboardShell({ account, children }: DashboardShellProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const displayName = account.fullName || account.email || "SidCrawal User";

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 lg:flex",
          collapsed ? "w-[68px]" : "w-64"
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center border-b border-sidebar-border px-3",
            collapsed ? "justify-center" : "justify-between"
          )}
        >
          <Link
            href="/"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="SidCrawal home"
          >
            <SidCrawalLogo compact showWordmark={!collapsed} />
          </Link>
          {!collapsed && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        <NavList collapsed={collapsed} role={account.role} />

        <div className="border-t border-sidebar-border p-3">
          {collapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed(false)}
              aria-label="Expand sidebar"
              className="mx-auto flex"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </Button>
          ) : (
            <div className="rounded-lg border border-sidebar-border bg-background/70 p-3">
              <div className="text-xs font-medium text-foreground">
                {account.authenticated
                  ? displayName
                  : account.configured
                    ? "Session Required"
                    : "Supabase Unconfigured"}
              </div>
              <p className="mt-1 truncate text-[11px] leading-relaxed text-muted-foreground">
                {account.authenticated
                  ? account.email ?? "Verified account"
                  : account.configured
                    ? "Sign in to access your workspace."
                    : "Add credentials in .env.local for Auth."}
              </p>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {/* Mobile Drawer */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger
                aria-label="Open dashboard navigation"
                className={cn(
                  buttonVariants({ variant: "outline", size: "icon-sm" }),
                  "lg:hidden"
                )}
              >
                <Menu className="size-4" aria-hidden="true" />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetHeader className="border-b border-border px-4 py-3.5">
                  <SheetTitle>
                    <SidCrawalLogo compact />
                  </SheetTitle>
                </SheetHeader>
                <NavList
                  collapsed={false}
                  role={account.role}
                  onNavigate={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>

            {/* Breadcrumb */}
            <div className="flex min-w-0 items-center gap-1.5 text-sm">
              <Link
                href="/dashboard"
                className="hidden text-muted-foreground transition-colors hover:text-foreground sm:inline"
              >
                SidCrawal
              </Link>
              <ChevronRight
                className="hidden size-3.5 text-muted-foreground sm:inline"
                aria-hidden="true"
              />
              <React.Suspense
                fallback={<span className="font-medium text-foreground">Dashboard</span>}
              >
                <BreadcrumbTitleContent />
              </React.Suspense>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <IntegrationStatusBadge
                configured={account.configured}
                label={
                  account.authenticated
                    ? "Session Verified"
                    : account.configured
                      ? "Supabase Ready"
                      : "Supabase Unconfigured"
                }
              />
            </div>

            <Link
              href="/dashboard/monitors/new"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "hidden sm:inline-flex"
              )}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              <span>Add Monitor</span>
            </Link>

            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Account menu"
                className={cn(buttonVariants({ variant: "outline", size: "icon-sm" }))}
              >
                <User className="size-4" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>
                    <div className="truncate text-xs font-medium text-foreground">
                      {account.authenticated ? displayName : "Not Signed In"}
                    </div>
                    <div className="truncate text-[11px] font-normal text-muted-foreground">
                      {account.authenticated
                        ? account.email
                        : account.configured
                          ? "Sign in required"
                          : "Configure .env.local for Auth"}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/dashboard/settings" />}>
                  User Settings
                </DropdownMenuItem>
                {account.role === "admin" && (
                  <DropdownMenuItem render={<Link href="/dashboard/admin" />}>
                    Admin Console
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {account.authenticated ? (
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={signingOut}
                    onClick={handleSignOut}
                  >
                    <LogOut className="size-3.5" aria-hidden="true" />
                    <span>{signingOut ? "Signing out..." : "Sign out"}</span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem render={<Link href="/login" />}>
                    Sign in
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl space-y-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
