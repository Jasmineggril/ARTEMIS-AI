import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const AUTH_STORAGE_KEY = "ceres-auth-session";
const LOCAL_USERS_STORAGE_KEY = "ceres-local-users";
export const DEMO_EMAIL = "demo@ceres.ai";
export const DEMO_PASSWORD = "Demo123!";
export const DEMO_NAME = "Seu Raimundo";

export interface AuthUser {
  userId: number | string;
  email: string;
  name: string;
  /**
   * - "api": session on this app's own server (Express + PostgreSQL) — the default
   * - "server": Supabase Auth session (only when VITE_SUPABASE_* is configured)
   * - "local": offline mode kept only in this browser (used when the API is unreachable)
   */
  source: "local" | "server" | "api";
}

export const AUTH_QUERY_KEY = ["/auth/status"] as const;

interface LocalUserRecord {
  id: number;
  email: string;
  password: string;
  name: string;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isDemoCredentials(email: string, password: string) {
  return normalizeEmail(email) === DEMO_EMAIL && password === DEMO_PASSWORD;
}

export function createDemoSession(email = DEMO_EMAIL): AuthUser {
  return {
    userId: `demo:${normalizeEmail(email)}`,
    email: DEMO_EMAIL,
    name: DEMO_NAME,
    source: "local",
  };
}

export function authenticateDemoSession(email: string, password: string) {
  return isDemoCredentials(email, password) ? createDemoSession(email) : null;
}

// localStorage can throw (e.g. private browsing on some mobile browsers).
function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore — the session still lives in the server cookie
  }
}

export function readStoredAuthSession(): AuthUser | null {
  const stored = readStorageValue(AUTH_STORAGE_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as AuthUser;
  } catch {
    return null;
  }
}

export function writeStoredAuthSession(user: AuthUser) {
  writeStorageValue(AUTH_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredAuthSession() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function readLocalUsers(): LocalUserRecord[] {
  const stored = readStorageValue(LOCAL_USERS_STORAGE_KEY);
  if (!stored) {
    const seededUsers: LocalUserRecord[] = [
      {
        id: 1,
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        name: DEMO_NAME,
      },
    ];
    writeLocalUsers(seededUsers);
    return seededUsers;
  }

  try {
    const parsed = JSON.parse(stored) as LocalUserRecord[];
    if (parsed.length === 0) {
      const seededUsers: LocalUserRecord[] = [
        {
          id: 1,
          email: DEMO_EMAIL,
          password: DEMO_PASSWORD,
          name: DEMO_NAME,
        },
      ];
      writeLocalUsers(seededUsers);
      return seededUsers;
    }

    return parsed;
  } catch {
    return [];
  }
}

function writeLocalUsers(users: LocalUserRecord[]) {
  writeStorageValue(LOCAL_USERS_STORAGE_KEY, JSON.stringify(users));
}

export function authenticateLocally({
  email,
  password,
  name,
  createIfMissing = false,
}: {
  email: string;
  password: string;
  name?: string;
  createIfMissing?: boolean;
}) {
  const normalizedEmail = normalizeEmail(email);
  const users = readLocalUsers();
  const existing = users.find((user) => user.email.toLowerCase() === normalizedEmail);

  if (createIfMissing) {
    if (existing) {
      return existing.password === password
        ? {
            userId: existing.id,
            email: existing.email,
            name: existing.name,
            source: "local" as const,
          }
        : null;
    }

    const newUser = {
      id: Date.now(),
      email: normalizedEmail,
      password,
      name: name?.trim() || normalizedEmail.split("@")[0],
    };
    writeLocalUsers([...users, newUser]);
    return {
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      source: "local" as const,
    };
  }

  if (!existing || existing.password !== password) return null;

  return {
    userId: existing.id,
    email: existing.email,
    name: existing.name,
    source: "local" as const,
  };
}

export function changeLocalPassword({
  email,
  currentPassword,
  newPassword,
}: {
  email: string;
  currentPassword: string;
  newPassword: string;
}) {
  const normalizedEmail = normalizeEmail(email);
  const users = readLocalUsers();
  const existing = users.find((user) => user.email.toLowerCase() === normalizedEmail);

  if (!existing || existing.password !== currentPassword) {
    return { success: false as const, reason: "current-password" as const };
  }

  const nextUsers = users.map((user) =>
    user.email.toLowerCase() === normalizedEmail
      ? { ...user, password: newPassword }
      : user
  );

  writeLocalUsers(nextUsers);
  return { success: true as const };
}

// ─── Server (API) session ───────────────────────────────────────────────────

type ApiAuthResult =
  | { kind: "ok"; user: AuthUser }
  /** The server answered with a 4xx: wrong password, e-mail already in use, invalid data… */
  | { kind: "rejected"; status: number; message: string }
  /** Network error or 5xx: the server could not be reached / failed. */
  | { kind: "unavailable" };

async function apiAuthRequest(path: string, body: unknown): Promise<ApiAuthResult> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: number; email?: string; name?: string; message?: string };
    if (res.ok && data.id !== undefined) {
      return {
        kind: "ok",
        user: { userId: data.id, email: data.email ?? "", name: data.name ?? "", source: "api" },
      };
    }
    if (res.status >= 400 && res.status < 500) {
      return { kind: "rejected", status: res.status, message: data.message ?? "Não foi possível concluir a operação." };
    }
    return { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export function loginWithApi(email: string, password: string) {
  return apiAuthRequest("/api/auth/login", { email: normalizeEmail(email), password });
}

export function signupWithApi(name: string, email: string, password: string) {
  return apiAuthRequest("/api/auth/signup", { name: name.trim(), email: normalizeEmail(email), password });
}

/** Creates the account on the server, or logs in if it already exists with the same password. */
export async function signupOrLoginWithApi(name: string, email: string, password: string): Promise<ApiAuthResult> {
  const signup = await signupWithApi(name, email, password);
  if (signup.kind === "rejected" && signup.status === 400) {
    const login = await loginWithApi(email, password);
    if (login.kind === "ok") return login;
  }
  return signup;
}

/**
 * After a Supabase login, opens the matching session on our server so routes
 * that need authentication (data import, chat profile…) work. Best effort.
 */
export async function bridgeSupabaseSession(accessToken: string | null | undefined): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const res = await fetch("/api/auth/supabase-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ accessToken }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Server session: the user, null when logged out, or undefined when the API is unreachable. */
async function fetchApiSession(): Promise<{ userId: number; email: string; name: string } | null | undefined> {
  try {
    const res = await fetch("/api/auth/status", { credentials: "include" });
    if (res.status === 401) return null;
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

/**
 * Saves the session and updates the cached auth status right away, so the
 * protected route that we navigate to next doesn't see a stale "logged out".
 */
export function completeLogin(user: AuthUser) {
  writeStoredAuthSession(user);
  queryClient.setQueryData(AUTH_QUERY_KEY, user);
}

export function useAuthStatus() {
  return useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async (): Promise<AuthUser | null> => {
      const apiSession = await fetchApiSession();

      if (isSupabaseConfigured && supabase) {
        try {
          const { data: user, error } = await supabase.auth.getUser();
          if (!error && user?.user) {
            if (!apiSession) {
              const { data } = await supabase.auth.getSession();
              await bridgeSupabaseSession(data.session?.access_token);
            }
            const session: AuthUser = {
              userId: user.user.id,
              email: user.user.email ?? "",
              name: user.user.user_metadata?.full_name ?? user.user.email?.split("@")[0] ?? "",
              source: "server",
            };
            writeStoredAuthSession(session);
            return session;
          }
        } catch {
          // Supabase unreachable — continue with the server session below
        }
      }

      if (apiSession) {
        const session: AuthUser = {
          userId: apiSession.userId,
          email: apiSession.email,
          name: apiSession.name,
          source: "api",
        };
        writeStoredAuthSession(session);
        return session;
      }

      // Offline mode is only honored while the API cannot be reached.
      if (apiSession === undefined) {
        const localSession = readStoredAuthSession();
        return localSession?.source === "local" ? localSession : null;
      }

      clearStoredAuthSession();
      return null;
    },
    retry: false,
    staleTime: 1000 * 30,
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      try {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      } catch {
        // ignore network errors and continue with local logout
      }
      if (isSupabaseConfigured && supabase) {
        try {
          await supabase.auth.signOut();
        } catch {
          // ignore network errors and continue with local logout
        }
      }
      clearStoredAuthSession();
    },
    onSuccess: () => {
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
      // Absolute path: a relative "login" would resolve to e.g. /sensors/login on nested routes.
      window.location.assign("/login");
    },
  });
}
