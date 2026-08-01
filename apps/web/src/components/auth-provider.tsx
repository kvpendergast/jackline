import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { MeData, PublicMembershipContext, PublicUser } from "@mesh/shared";
import { ApiError } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { meshApi } from "@/lib/mesh-api";

const TENANT_KEY = "mesh-tenant-id";

type AuthContextValue = {
  loading: boolean;
  user: PublicUser | null;
  memberships: PublicMembershipContext[];
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
      const data = await meshApi.me();
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

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      user: me?.user ?? null,
      memberships: me?.memberships ?? [],
      tenantId,
      tenant,
      setTenantId,
      refresh,
      signOut,
    }),
    [loading, me, tenantId, tenant, setTenantId, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
