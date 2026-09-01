import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/layout/AppShell";
import { AccessRequestsPage } from "@/pages/AccessRequestsPage";
import { AuditPage } from "@/pages/AuditPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { ConnectionDetailPage } from "@/pages/ConnectionDetailPage";
import { ConnectionsPage } from "@/pages/ConnectionsPage";
import { LoginPage, SignupPage } from "@/pages/LoginPage";
import { AuthCompletePage } from "@/pages/AuthCompletePage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { MyAccessPage } from "@/pages/MyAccessPage";
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

  if (!user.emailVerified) {
    return <Navigate to="/verify-email" replace />;
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

function HomeRedirect() {
  const { membership } = useAuth();
  const isAdmin =
    membership?.role === "full_admin" ||
    membership?.role === "delegated_admin";
  return <Navigate to={isAdmin ? "/dashboard" : "/my-access"} replace />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { membership } = useAuth();
  const isAdmin =
    membership?.role === "full_admin" ||
    membership?.role === "delegated_admin";
  if (!isAdmin) {
    return <Navigate to="/my-access" replace />;
  }
  return children;
}

function FullAdminOnly({ children }: { children: ReactNode }) {
  const { membership } = useAuth();
  if (membership?.role !== "full_admin") {
    return <Navigate to="/my-access" replace />;
  }
  return children;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/auth/complete" element={<AuthCompletePage />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/my-access" element={<MyAccessPage />} />
          <Route
            path="/dashboard"
            element={
              <AdminOnly>
                <DashboardPage />
              </AdminOnly>
            }
          />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/connections/:id" element={<ConnectionDetailPage />} />
          <Route path="/access-requests" element={<AccessRequestsPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route
            path="/audit"
            element={
              <AdminOnly>
                <AuditPage />
              </AdminOnly>
            }
          />
          <Route
            path="/servers"
            element={
              <AdminOnly>
                <ServersPage />
              </AdminOnly>
            }
          />
          <Route
            path="/tools"
            element={
              <AdminOnly>
                <ToolsPage />
              </AdminOnly>
            }
          />
          <Route
            path="/roles"
            element={
              <AdminOnly>
                <RolesPage />
              </AdminOnly>
            }
          />
          <Route
            path="/clients"
            element={
              <AdminOnly>
                <ClientsPage />
              </AdminOnly>
            }
          />
          <Route
            path="/users"
            element={
              <AdminOnly>
                <UsersPage />
              </AdminOnly>
            }
          />
          <Route
            path="/secrets"
            element={
              <FullAdminOnly>
                <SecretsPage />
              </FullAdminOnly>
            }
          />
          <Route
            path="/settings"
            element={
              <AdminOnly>
                <SettingsPage />
              </AdminOnly>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
