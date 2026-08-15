import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicNotification } from "@mesh/shared";
import { useAuth } from "@/components/auth-provider";
import { PageHeader } from "@/components/mesh/PageHeader";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { meshApi } from "@/lib/mesh-api";

export function NotificationsPage() {
  const { tenantId } = useAuth();
  const [items, setItems] = useState<PublicNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    try {
      const data = await meshApi.listNotifications(tenantId);
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    void load();
  }, [tenantId]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="In-app alerts for access requests and decisions."
        actions={
          unreadCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void meshApi
                  .markAllNotificationsRead(tenantId!)
                  .then(() => load())
              }
            >
              Mark all read
            </Button>
          ) : null
        }
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No notifications yet.</p>
      ) : (
        <ul className="divide-y divide-border border border-border">
          {items.map((n) => (
            <li
              key={n.id}
              className={`space-y-1 p-4 ${n.readAt ? "" : "bg-muted/20"}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{n.title}</p>
                  <p className="text-sm text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  {n.href ? (
                    <Button asChild size="sm" variant="secondary">
                      <Link to={n.href}>Open</Link>
                    </Button>
                  ) : null}
                  {!n.readAt ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void meshApi
                          .markNotificationRead(tenantId!, n.id)
                          .then(() => load())
                      }
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
