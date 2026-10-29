import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Bordered list container shared by compact + table layouts. */
export function DataList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border border-border bg-card", className)}>
      {children}
    </div>
  );
}

export function DataListToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * One entity row for compact viewports.
 * Title + meta stack left; status/actions wrap below or right.
 */
export function DataListRow({
  title,
  meta,
  status,
  actions,
  className,
  onClick,
}: {
  title: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  const Comp = interactive ? "button" : "div";

  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-3 border-b border-border p-3 text-left last:border-b-0 sm:flex-row sm:items-center sm:justify-between",
        interactive && "transition-colors hover:bg-muted/40",
        className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 font-medium">{title}</div>
          {status}
        </div>
        {meta ? (
          <div className="space-y-0.5 text-xs text-muted-foreground">{meta}</div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {actions}
        </div>
      ) : null}
    </Comp>
  );
}

export function DataListEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="p-4 text-sm text-muted-foreground">{children}</p>
  );
}

/** Show stacked list below `lg`, table above. */
export function ResponsiveTable({
  list,
  table,
  className,
}: {
  list: ReactNode;
  table: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="lg:hidden">{list}</div>
      <div className="hidden lg:block">{table}</div>
    </div>
  );
}
