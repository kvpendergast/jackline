import { Link } from "react-router-dom";
import { PreviewAuthProvider } from "@/components/auth-provider";
import {
  DataList,
  DataListRow,
} from "@/components/jackline/DataList";
import { PageHeader } from "@/components/jackline/PageHeader";
import { KindBadge } from "@/components/jackline/StatusBadge";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";

/**
 * Static mobile chrome demo — no API. Open at /__preview/shell
 * (narrow the viewport to exercise the compact shell).
 */
export function ShellPreviewPage() {
  return (
    <PreviewAuthProvider role="full_admin">
      <AppShell>
        <div className="space-y-6">
          <PageHeader
            eyebrow="Personal"
            title="My Access"
            description="Connect upstream credentials for tools you can use."
          />
          <DataList>
            <DataListRow
              title="Linear"
              status={<KindBadge kind="connected" />}
              meta="Personal credential · oauth"
              actions={
                <Button size="sm" variant="outline">
                  Manage
                </Button>
              }
            />
            <DataListRow
              title="GitHub"
              status={<KindBadge kind="missing" />}
              meta="Personal required"
              actions={<Button size="sm">Connect</Button>}
            />
            <DataListRow
              title="Notion"
              status={<KindBadge kind="org_managed" />}
              meta="Shared org credential"
              actions={
                <Button size="sm" variant="outline">
                  View
                </Button>
              }
            />
          </DataList>
          <p className="text-xs text-muted-foreground">
            Preview only —{" "}
            <Link to="/login" className="text-primary hover:underline">
              back to login
            </Link>
          </p>
        </div>
      </AppShell>
    </PreviewAuthProvider>
  );
}
