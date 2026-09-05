import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import {
  CONNECTOR_CATEGORIES,
  CONNECTOR_PRESETS,
  type ConnectorPreset,
} from "@jackline/shared";
import { ConnectorLogo } from "@/components/jackline/ConnectorLogo";
import { KindBadge } from "@/components/jackline/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CategoryFilter = "all" | (typeof CONNECTOR_CATEGORIES)[number]["id"];

export function ConnectorCatalog({
  addedConnectorKeys,
  onSelect,
  onCustom,
}: {
  addedConnectorKeys: Set<string>;
  onSelect: (preset: ConnectorPreset) => void;
  onCustom: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [hideAdded, setHideAdded] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONNECTOR_PRESETS.filter((preset) => {
      if (category !== "all" && preset.category !== category) return false;
      if (hideAdded && addedConnectorKeys.has(preset.key)) return false;
      if (!q) return true;
      return (
        preset.name.toLowerCase().includes(q) ||
        preset.key.toLowerCase().includes(q) ||
        preset.description.toLowerCase().includes(q) ||
        preset.baseUrl.toLowerCase().includes(q)
      );
    });
  }, [addedConnectorKeys, category, hideAdded, query]);

  const grouped = useMemo(() => {
    return CONNECTOR_CATEGORIES.map((cat) => ({
      ...cat,
      presets: filtered.filter((p) => p.category === cat.id),
    })).filter((cat) => cat.presets.length > 0);
  }, [filtered]);

  const categoryCounts = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const preset of CONNECTOR_PRESETS) {
      if (hideAdded && addedConnectorKeys.has(preset.key)) continue;
      byCategory.set(
        preset.category,
        (byCategory.get(preset.category) ?? 0) + 1,
      );
    }
    return byCategory;
  }, [addedConnectorKeys, hideAdded]);

  const totalVisible = filtered.length;
  const totalCatalog = CONNECTOR_PRESETS.length;

  return (
    <section className="border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="section-label">Quick add</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Catalog connectors ({totalCatalog}). Supply credentials after
              create.
            </p>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">
            {totalVisible} shown
          </p>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, key, or URL…"
              className="h-9 pl-8"
              aria-label="Search catalog"
            />
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={hideAdded}
              onChange={(e) => setHideAdded(e.target.checked)}
              className="size-3.5 border-border accent-primary"
            />
            Hide already added
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-1">
          <CategoryChip
            label="All"
            count={
              hideAdded
                ? CONNECTOR_PRESETS.filter(
                    (p) => !addedConnectorKeys.has(p.key),
                  ).length
                : totalCatalog
            }
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {CONNECTOR_CATEGORIES.map((cat) => (
            <CategoryChip
              key={cat.id}
              label={cat.label}
              count={categoryCounts.get(cat.id) ?? 0}
              active={category === cat.id}
              onClick={() => setCategory(cat.id)}
            />
          ))}
        </div>
      </div>

      <div className="max-h-[min(28rem,55vh)] overflow-y-auto">
        {grouped.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No connectors match your filters.
          </p>
        ) : (
          grouped.map((cat) => (
            <div key={cat.id} className="border-b border-border last:border-b-0">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2 backdrop-blur-sm">
                <p className="section-label">{cat.label}</p>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {cat.presets.length}
                </span>
              </div>
              <ul className="divide-y divide-border">
                {cat.presets.map((preset) => {
                  const added = addedConnectorKeys.has(preset.key);
                  return (
                    <li key={preset.key}>
                      <button
                        type="button"
                        disabled={added}
                        onClick={() => onSelect(preset)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors enabled:hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center border border-border bg-background">
                          <ConnectorLogo
                            connectorKey={preset.key}
                            name={preset.name}
                            className="size-4"
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-sm font-medium">
                              {preset.name}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              {preset.key}
                            </span>
                          </span>
                          <span className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {preset.description}
                          </span>
                        </span>
                        <span className="hidden shrink-0 sm:block">
                          <KindBadge kind={preset.authMethod} />
                        </span>
                        {added ? (
                          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                            Added
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border px-4 py-3">
        <Button variant="outline" onClick={onCustom}>
          <Plus className="size-4" />
          Custom server
        </Button>
      </div>
    </section>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("ml-1.5", active ? "opacity-70" : "opacity-60")}>
        {count}
      </span>
    </button>
  );
}
