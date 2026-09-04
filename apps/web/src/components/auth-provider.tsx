import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeData, PublicMembershipContext, PublicUser } from "@jackline/shared";
import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { jacklineApi } from "@/lib/jackline-api";

const TENANT_KEY = "jackline-tenant-id";

type AuthContextValue = {
  loading: boolean;
  user: PublicUser | null;
  memberships: PublicMembershipContext[];
  membership: PublicMembershipContext | null;
  tenantId: string | null;
  tenant: PublicMembershipContext["tenant"] | null;
  setTenantId: (id: string) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredTenant(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeData | null>(null);
  const [tenantId, setTenantIdState] = useState<string | null>(readStoredTenant);

  const refresh = useCallback(async () => {
    try {
      const data = await jacklineApi.me();
      setMe(data);
      setTenantIdState((current) => {
        const ids = data.memberships.map((m) => m.tenant.id);
        if (current && ids.includes(current)) return current;
        const next = ids[0] ?? null;
        if (next) {
          try {
            localStorage.setItem(TENANT_KEY, next);
          } catch {
            /* ignore */
          }
        }
        return next;
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setMe(null);
        return;
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const setTenantId = useCallback((id: string) => {
    setTenantIdState(id);
    try {
      localStorage.setItem(TENANT_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    setMe(null);
    setTenantIdState(null);
    try {
      localStorage.removeItem(TENANT_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const tenant = useMemo(() => {
    if (!me || !tenantId) return null;
    return me.memberships.find((m) => m.tenant.id === tenantId)?.tenant ?? null;
  }, [me, tenantId]);

  const membership = useMemo(() => {
    if (!me || !tenantId) return null;
    return me.memberships.find((m) => m.tenant.id === tenantId) ?? null;
  }, [me, tenantId]);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      user: me?.user ?? null,
      memberships: me?.memberships ?? [],
      membership,
      tenantId,
      tenant,
      setTenantId,
      refresh,
      signOut,
    }),
    [loading, me, membership, tenantId, tenant, setTenantId, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Static auth for `/__preview/*` UI demos — no API. */
export function PreviewAuthProvider({
  children,
  role = "full_admin",
}: {
  children: ReactNode;
  role?: "full_admin" | "member";
}) {
  const value = useMemo<AuthContextValue>(() => {
    const membership: PublicMembershipContext = {
      id: "00000000-0000-4000-8000-000000000001",
      role,
      team: role === "full_admin" ? null : "engineering",
      tenant: {
        id: "ten_preview01",
        name: "Acme Corp",
        slug: "acme",
      },
    };

    return {
      loading: false,
      user: {
        id: "usr_preview",
        email: "alex@acme.com",
        name: "Alex Morgan",
        kind: "human",
        emailVerified: true,
      },
      memberships: [membership],
      membership,
      tenantId: membership.tenant.id,
      tenant: membership.tenant,
      setTenantId: () => undefined,
      refresh: async () => undefined,
      signOut: async () => undefined,
    };
  }, [role]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
