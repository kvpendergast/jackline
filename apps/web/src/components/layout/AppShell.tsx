import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import {
  Cable,
  FileSearch,
  KeyRound,
  LayoutGrid,
  Moon,
  Server,
  Shield,
  Sun,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/connections", label: "Connections", icon: Cable },
  { to: "/audit", label: "Audit", icon: FileSearch },
  { to: "/servers", label: "Servers", icon: Server, disabled: true },
  { to: "/tools", label: "Tools", icon: Wrench, disabled: true },
  { to: "/roles", label: "Roles", icon: Shield, disabled: true },
  { to: "/clients", label: "Clients", icon: LayoutGrid, disabled: true },
  { to: "/users", label: "Users", icon: Users, disabled: true },
  { to: "/secrets", label: "Secrets", icon: KeyRound, disabled: true },
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
      <path d="M10 7h4M7 10v4M17 10v4M10 17h4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
          <LatticeMark className="text-primary" />
          <div className="leading-none">
            <div className="text-sm font-medium tracking-[-0.02em]">Mesh</div>
            <div className="section-label mt-1">Control plane</div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 p-2">
          {nav.map((item) => {
            const Icon = item.icon;
            if ("disabled" in item && item.disabled) {
              return (
                <div
                  key={item.to}
                  className="flex cursor-not-allowed items-center gap-2.5 px-2.5 py-2 text-sm text-muted-foreground/50"
                  title="Preview stub"
                >
                  <Icon className="size-4" />
                  {item.label}
                </div>
              );
            }

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
          <div className="text-sm font-medium">acme-prod</div>
          <MonoHint>ten_0f8c…29</MonoHint>
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
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            </Button>
            <span className="text-muted-foreground">alex@acme.io</span>
            <span className="font-mono text-[11px] text-primary">full_admin</span>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}

function MonoHint({ children }: { children: ReactNode }) {
  return <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{children}</div>;
}
