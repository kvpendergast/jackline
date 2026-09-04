import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  Bot,
  Cable,
  FileSearch,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  Moon,
  MoreVertical,
  Server,
  Settings,
  Shield,
  Sun,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { useTheme } from "@/components/theme-provider";
import { ChatDock } from "@/components/chat/ChatDock";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsDesktop } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

type ShellView = "personal" | "admin";

const SHELL_VIEW_KEY = "jackline.shellView";

const personalNav = [
  { to: "/my-access", label: "My Access", icon: UserRound },
  { to: "/my-agents", label: "Agents", icon: Bot },
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/access-requests", label: "Access requests", icon: Shield },
  { to: "/notifications", label: "Notifications", icon: Bell },
] as const;

const adminNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/access-requests", label: "Access requests", icon: Shield },
  { to: "/notifications", label: "Notifications", icon: Bell },
  { to: "/audit", label: "Audit", icon: FileSearch },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/tools", label: "Tools", icon: Wrench },
  { to: "/roles", label: "Roles", icon: Shield },
  { to: "/clients", label: "Clients", icon: LayoutGrid },
  { to: "/users", label: "Users", icon: Users },
  { to: "/secrets", label: "Secrets", icon: KeyRound },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

const adminOnlyPrefixes = [
  "/dashboard",
  "/audit",
  "/servers",
  "/tools",
  "/roles",
  "/clients",
  "/users",
  "/secrets",
  "/settings",
] as const;

const adminOperate = [
  "/dashboard",
  "/connections",
  "/access-requests",
  "/notifications",
  "/audit",
] as const;

const adminConfigure = [
  "/servers",
  "/tools",
  "/roles",
  "/clients",
] as const;

function LatticeMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("size-5", className)}
    >
      <path
        d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 7h4M7 10v4M17 10v4M10 17h4"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function readStoredView(): ShellView {
  try {
    const raw = localStorage.getItem(SHELL_VIEW_KEY);
    if (raw === "personal" || raw === "admin") return raw;
  } catch {
    /* ignore */
  }
  return "admin";
}

function isAdminOnlyPath(pathname: string): boolean {
  return adminOnlyPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isPersonalPath(pathname: string): boolean {
  return (
    pathname === "/my-access" ||
    pathname === "/my-agents" ||
    pathname.startsWith("/my-agents/") ||
    pathname === "/connections" ||
    pathname.startsWith("/connections/") ||
    pathname === "/access-requests"
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ShellView;
  onChange: (next: ShellView) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Shell view"
      className="grid grid-cols-2 gap-0.5 border border-border bg-background p-0.5"
    >
      <button
        type="button"
        className={cn(
          "min-h-9 px-2 py-1.5 text-xs transition-colors",
          view === "personal"
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-muted/70",
        )}
        onClick={() => onChange("personal")}
      >
        Personal
      </button>
      <button
        type="button"
        className={cn(
          "min-h-9 px-2 py-1.5 text-xs transition-colors",
          view === "admin"
            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-muted/70",
        )}
        onClick={() => onChange("admin")}
      >
        Admin
      </button>
    </div>
  );
}

function NavItems({
  items,
  onNavigate,
}: {
  items: Array<{
    to: string;
    label: string;
    icon: (typeof personalNav)[number]["icon"];
  }>;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 p-2">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                "flex min-h-10 items-center gap-2.5 border-l-2 border-transparent px-2.5 py-2 text-sm text-sidebar-foreground transition-colors",
                isActive
                  ? "border-l-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "hover:bg-muted/70",
              )
            }
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}

function AdminNavGrouped({
  items,
  onNavigate,
}: {
  items: Array<{
    to: string;
    label: string;
    icon: (typeof adminNav)[number]["icon"];
  }>;
  onNavigate?: () => void;
}) {
  const groups = [
    {
      label: "Operate",
      routes: adminOperate,
    },
    {
      label: "Configure",
      routes: adminConfigure,
    },
    {
      label: "Govern",
      routes: ["/users", "/secrets", "/settings"] as const,
    },
  ];

  return (
    <nav className="flex flex-1 flex-col gap-3 overflow-y-auto p-2">
      {groups.map((group) => {
        const groupItems = items.filter((item) =>
          group.routes.some((r) => item.to === r),
        );
        if (groupItems.length === 0) return null;
        return (
          <div key={group.label}>
            <p className="section-label mb-1 px-2.5">{group.label}</p>
            <div className="flex flex-col gap-0.5">
              {groupItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "flex min-h-10 items-center gap-2.5 border-l-2 border-transparent px-2.5 py-2 text-sm text-sidebar-foreground transition-colors",
                        isActive
                          ? "border-l-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "hover:bg-muted/70",
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    {item.label}
                  </NavLink>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

function TenantBlock({ className }: { className?: string }) {
  const { tenant, membership, memberships, tenantId, setTenantId } = useAuth();

  return (
    <div className={cn("border-t border-sidebar-border p-3", className)}>
      <div className="section-label mb-1">Tenant</div>
      {memberships.length > 1 ? (
        <select
          className="w-full border border-border bg-background px-2 py-2 text-sm"
          value={tenantId ?? ""}
          onChange={(e) => setTenantId(e.target.value)}
        >
          {memberships.map((m) => (
            <option key={m.tenant.id} value={m.tenant.id}>
              {m.tenant.name}
            </option>
          ))}
        </select>
      ) : (
        <div className="text-sm font-medium">{tenant?.name ?? "—"}</div>
      )}
      {tenant ? (
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {tenant.id.slice(0, 8)}…
          {membership?.role ? ` · ${membership.role}` : ""}
          {membership?.team ? ` · ${membership.team}` : ""}
        </div>
      ) : null}
    </div>
  );
}

function BrandBlock({
  subtitle,
  compact,
}: {
  subtitle: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5",
        compact ? "" : "h-14 border-b border-sidebar-border px-4",
      )}
    >
      <LatticeMark className="shrink-0 text-primary" />
      <div className="min-w-0 leading-none">
        <div className="truncate text-sm font-medium tracking-[-0.02em]">
          Jackline
        </div>
        {!compact ? (
          <div className="section-label mt-1 truncate">{subtitle}</div>
        ) : null}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const { user, membership, signOut } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  const isAdmin =
    membership?.role === "full_admin" ||
    membership?.role === "delegated_admin";

  const [view, setView] = useState<ShellView>(() =>
    isAdmin ? readStoredView() : "personal",
  );

  useEffect(() => {
    if (!isAdmin) {
      setView("personal");
      return;
    }
    if (isAdminOnlyPath(location.pathname) && view !== "admin") {
      setView("admin");
      try {
        localStorage.setItem(SHELL_VIEW_KEY, "admin");
      } catch {
        /* ignore */
      }
    }
  }, [isAdmin, location.pathname, view]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (isDesktop) setNavOpen(false);
  }, [isDesktop]);

  function switchView(next: ShellView) {
    if (!isAdmin || next === view) return;
    setView(next);
    try {
      localStorage.setItem(SHELL_VIEW_KEY, next);
    } catch {
      /* ignore */
    }
    if (next === "personal" && !isPersonalPath(location.pathname)) {
      navigate("/my-access");
    } else if (next === "admin" && !isAdminOnlyPath(location.pathname)) {
      if (location.pathname === "/my-access") {
        navigate("/dashboard");
      }
    }
  }

  const visibleNav = useMemo(() => {
    const activeView = isAdmin ? view : "personal";
    if (activeView === "personal") {
      return [...personalNav];
    }
    return adminNav.filter((item) => {
      if (item.to === "/settings") return isAdmin;
      if (item.to === "/secrets") return membership?.role === "full_admin";
      return true;
    });
  }, [isAdmin, membership?.role, view]);

  const shellSubtitle =
    isAdmin && view === "admin" ? "Control plane" : "My Access";

  const sidebarBody = (
    <>
      {isAdmin ? (
        <div className="border-b border-sidebar-border p-2">
          <ViewToggle view={view} onChange={switchView} />
        </div>
      ) : null}

      {isAdmin && view === "admin" ? (
        <AdminNavGrouped
          items={visibleNav}
          onNavigate={() => setNavOpen(false)}
        />
      ) : (
        <NavItems items={visibleNav} onNavigate={() => setNavOpen(false)} />
      )}

      <TenantBlock />
    </>
  );

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      {/* Desktop rail */}
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <BrandBlock subtitle={shellSubtitle} />
        {sidebarBody}
      </aside>

      {/* Mobile nav sheet */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          showCloseButton
          className="w-[min(100%,20rem)] gap-0 bg-sidebar p-0"
        >
          <SheetHeader className="border-b border-sidebar-border p-4 pr-12">
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Jackline {shellSubtitle} navigation
            </SheetDescription>
            <BrandBlock subtitle={shellSubtitle} compact />
            <p className="section-label mt-2">{shellSubtitle}</p>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {sidebarBody}
          </div>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-border bg-card px-3 pt-[env(safe-area-inset-top)] sm:px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="shrink-0 lg:hidden"
              aria-label="Open navigation"
              onClick={() => setNavOpen(true)}
            >
              <Menu className="size-4" />
            </Button>
            <div className="hidden lg:block">
              <div className="section-label">Policy gateway · self-hosted</div>
            </div>
            <div className="min-w-0 lg:hidden">
              <BrandBlock subtitle={shellSubtitle} compact />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <ChatDock />
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              className="hidden sm:inline-flex"
              aria-label={
                theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
              }
              onClick={toggleTheme}
            >
              {theme === "dark" ? (
                <Sun className="size-3.5" />
              ) : (
                <Moon className="size-3.5" />
              )}
            </Button>
            <span className="hidden max-w-[14rem] truncate text-sm text-muted-foreground md:inline">
              {user?.email}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="hidden h-7 px-2 text-xs md:inline-flex"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="md:hidden"
                  aria-label="Account menu"
                >
                  <MoreVertical className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="truncate text-sm font-medium text-foreground">
                    {user?.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={toggleTheme}
                  className="sm:hidden"
                >
                  {theme === "dark" ? (
                    <Sun className="size-4" />
                  ) : (
                    <Moon className="size-4" />
                  )}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void signOut()}>
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
