import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/layout/AppShell";
import { AuditPage } from "@/pages/AuditPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { ConnectionDetailPage } from "@/pages/ConnectionDetailPage";
import { ConnectionsPage } from "@/pages/ConnectionsPage";
import { LoginPage, SignupPage } from "@/pages/LoginPage";
import { RolesPage } from "@/pages/RolesPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { SecretsPage } from "@/pages/SecretsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ServersPage } from "@/pages/ServersPage";
import { ToolsPage } from "@/pages/ToolsPage";
import { UsersPage } from "@/pages/UsersPage";

function ProtectedLayout() {
  const { loading, user, tenantId } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Loading session…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!tenantId) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6 text-sm text-muted-foreground">
        No tenant membership found for this user.
      </div>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/connections/:id" element={<ConnectionDetailPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/servers" element={<ServersPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/secrets" element={<SecretsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
