import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Cable,
  FileSearch,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Moon,
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ShellView = "personal" | "admin";

const SHELL_VIEW_KEY = "mesh.shellView";

const personalNav = [
  { to: "/my-access", label: "My Access", icon: UserRound },
  { to: "/connections", label: "Connections", icon: Cable },
] as const;

const adminNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/connections", label: "Connections", icon: Cable },
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
    pathname === "/connections" ||
    pathname.startsWith("/connections/")
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, tenant, membership, memberships, tenantId, setTenantId, signOut } =
    useAuth();

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

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
          <LatticeMark className="text-primary" />
          <div className="leading-none">
            <div className="text-sm font-medium tracking-[-0.02em]">Mesh</div>
            <div className="section-label mt-1">
              {isAdmin && view === "admin" ? "Control plane" : "My Access"}
            </div>
          </div>
        </div>

        {isAdmin ? (
          <div className="border-b border-sidebar-border p-2">
            <div
              role="group"
              aria-label="Shell view"
              className="grid grid-cols-2 gap-0.5 border border-border bg-background p-0.5"
            >
              <button
                type="button"
                className={cn(
                  "px-2 py-1.5 text-xs transition-colors",
                  view === "personal"
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/70",
                )}
                onClick={() => switchView("personal")}
              >
                Personal
              </button>
              <button
                type="button"
                className={cn(
                  "px-2 py-1.5 text-xs transition-colors",
                  view === "admin"
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/70",
                )}
                onClick={() => switchView("admin")}
              >
                Admin
              </button>
            </div>
          </div>
        ) : null}

        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {visibleNav.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2.5 border-l-2 border-transparent px-2.5 py-2 text-sm text-sidebar-foreground transition-colors",
                    isActive
                      ? "border-l-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "hover:bg-muted/70",
                  )
                }
              >
                <Icon className="size-4" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <div className="section-label mb-1">Tenant</div>
          {memberships.length > 1 ? (
            <select
              className="w-full border border-border bg-background px-2 py-1.5 text-sm"
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
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
          <div className="section-label">Policy gateway · self-hosted</div>
          <div className="flex items-center gap-3 text-sm">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
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
            <span className="text-muted-foreground">{user?.email}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void signOut()}
            >
              Sign out
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
