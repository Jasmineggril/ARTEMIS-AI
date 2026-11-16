/**
 * Authentication — server-side session only (HttpOnly cookie, bcrypt).
 * No credentials, sessions or users are stored in the browser.
 */
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { api, ApiError } from "@/lib/api";

export type OrgRole = "owner" | "admin" | "manager" | "analyst" | "viewer";

export interface AuthUser {
  userId: number;
  email: string;
  name: string;
  platformRole: string;
  organization: { id: number; name: string; type: string; role: OrgRole } | null;
}

export const AUTH_QUERY_KEY = ["/api/auth/status"];

const RANK: Record<OrgRole, number> = { viewer: 1, analyst: 2, manager: 3, admin: 4, owner: 5 };
export function hasRole(user: AuthUser | null | undefined, min: OrgRole): boolean {
  const r = user?.organization?.role;
  return !!r && RANK[r] >= RANK[min];
}

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Proprietário", admin: "Administrador", manager: "Gestor", analyst: "Analista", viewer: "Leitor",
};

export function useAuthStatus() {
  return useQuery<AuthUser | null>({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      try {
        return await api<AuthUser>("GET", "/api/auth/status");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export async function login(email: string, password: string) {
  await api("POST", "/api/auth/login", { email, password });
  await queryClient.invalidateQueries();
}

export async function signup(input: {
  name: string; email: string; password: string;
  organizationName?: string; organizationType?: string; acceptPrivacy: boolean;
}) {
  await api("POST", "/api/auth/signup", input);
  await queryClient.invalidateQueries();
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api("POST", "/api/auth/logout"),
    onSettled: () => {
      queryClient.clear();
      window.location.assign("/login");
    },
  });
}
