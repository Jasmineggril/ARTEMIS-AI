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
  source: "local" | "server";
}

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

function readStorageValue(key: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

function writeStorageValue(key: string, value: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, value);
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
  window.localStorage.removeItem(AUTH_STORAGE_KEY);
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

export function useAuthStatus() {
  return useQuery({
    queryKey: ["/auth/status"],
    queryFn: async () => {
      const localSession = readStoredAuthSession();

      if (isSupabaseConfigured && supabase) {
        try {
          const { data: user, error } = await supabase.auth.getUser();
          if (!error && user?.user) {
            const session = {
              userId: user.user.id,
              email: user.user.email ?? "",
              name: user.user.user_metadata?.full_name ?? user.user.email?.split("@")[0] ?? "",
              source: "server" as const,
            };
            writeStoredAuthSession(session);
            return session;
          }
        } catch {
          // keep fallback to local session when Supabase session cannot be retrieved
        }

        if (localSession) {
          return localSession;
        }

        return null;
      }

      return localSession;
    },
    retry: false,
    staleTime: 1000 * 30,
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
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
      queryClient.invalidateQueries({ queryKey: ["/auth/status"] });
      window.location.assign(new URL("login", window.location.href).toString());
    },
  });
}
