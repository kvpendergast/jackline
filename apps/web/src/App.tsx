import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { AuditPage } from "@/pages/AuditPage";
import { ConnectionDetailPage } from "@/pages/ConnectionDetailPage";
import { ConnectionsPage } from "@/pages/ConnectionsPage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/connections" replace />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/connections/:id" element={<ConnectionDetailPage />} />
        <Route path="/audit" element={<AuditPage />} />
      </Routes>
    </AppShell>
  );
}
