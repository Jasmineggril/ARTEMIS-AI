import * as React from "react";
import { Bell, Camera, Lock, LogOut, MoonStar, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/Button";
import { Switch } from "@/components/ui/switch";
import { useAuthStatus, useLogout, changeLocalPassword } from "@/hooks/use-auth";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { PRODUCT_NAME, SUBMISSION_MODE } from "@shared/identity";
import { resetOnboarding } from "@/hooks/use-onboarding";

const STORAGE_KEY = "ceres-profile-settings";

const BRAZILIAN_REFERENCE_LOCATIONS = [
  { municipality: "Manaus", state: "AM", latitude: -3.119, longitude: -60.021 },
  { municipality: "Belém", state: "PA", latitude: -1.455, longitude: -48.503 },
  { municipality: "Fortaleza", state: "CE", latitude: -3.731, longitude: -38.526 },
  { municipality: "Recife", state: "PE", latitude: -8.047, longitude: -34.877 },
  { municipality: "Salvador", state: "BA", latitude: -12.977, longitude: -38.501 },
  { municipality: "Belo Horizonte", state: "MG", latitude: -19.916, longitude: -43.934 },
  { municipality: "Rio de Janeiro", state: "RJ", latitude: -22.906, longitude: -43.172 },
  { municipality: "São Paulo", state: "SP", latitude: -23.556, longitude: -46.633 },
  { municipality: "Curitiba", state: "PR", latitude: -25.429, longitude: -49.271 },
  { municipality: "Porto Alegre", state: "RS", latitude: -30.034, longitude: -51.217 },
  { municipality: "Brasília", state: "DF", latitude: -15.793, longitude: -47.882 },
  { municipality: "Goiânia", state: "GO", latitude: -16.686, longitude: -49.264 },
  { municipality: "Campo Grande", state: "MS", latitude: -20.469, longitude: -54.620 },
  { municipality: "Cuiabá", state: "MT", latitude: -15.601, longitude: -56.097 },
] as const;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceKm(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
) {
  const earthRadiusKm = 6371;
  const latitudeDifference = toRadians(latitudeB - latitudeA);
  const longitudeDifference = toRadians(longitudeB - longitudeA);
  const a =
    Math.sin(latitudeDifference / 2) * Math.sin(latitudeDifference / 2) +
    Math.cos(toRadians(latitudeA)) * Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDifference / 2) * Math.sin(longitudeDifference / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getBrazilianLocation(latitude: number, longitude: number) {
  return BRAZILIAN_REFERENCE_LOCATIONS.reduce((closest, candidate) => {
    const candidateDistance = distanceKm(latitude, longitude, candidate.latitude, candidate.longitude);
    if (!closest || candidateDistance < closest.distance) {
      return { ...candidate, distance: candidateDistance };
    }
    return closest;
  }, null as null | (typeof BRAZILIAN_REFERENCE_LOCATIONS[number] & { distance: number }));
}

type UserRole = "Produtor Rural" | "Analista Ambiental" | "Gestor Público";
type LanguagePreference = "simplificada" | "tecnica";
type AppearancePreference = "claro" | "escuro" | "alto-contraste";
type SyncMode = "local" | "server";

interface SettingsState {
  fullName: string;
  email: string;
  role: UserRole;
  state: string;
  municipality: string;
  avatar: string;
  alerts: boolean;
  legislation: boolean;
  language: LanguagePreference;
  appearance: AppearancePreference;
  highContrast: boolean;
}

const createDefaultSettings = (email = "", fullName = ""): SettingsState => ({
  fullName,
  email,
  role: "Produtor Rural",
  state: "",
  municipality: "",
  avatar: "",
  alerts: true,
  legislation: true,
  language: "simplificada",
  appearance: "claro",
  highContrast: false,
});

function getStoredSettings(storageKey: string, fallback: SettingsState) {
  if (typeof window === "undefined") return fallback;

  const stored = window.localStorage.getItem(storageKey);
  if (!stored) return fallback;

  try {
    const parsed = JSON.parse(stored) as Partial<SettingsState>;
    return {
      ...fallback,
      ...parsed,
      email: parsed.email || fallback.email,
      fullName: parsed.fullName || fallback.fullName,
    };
  } catch {
    window.localStorage.removeItem(storageKey);
    return fallback;
  }
}

export default function Settings() {
  const { toast } = useToast();
  const { data: user } = useAuthStatus();
  const logout = useLogout();
  const [settings, setSettings] = React.useState<SettingsState>(() => createDefaultSettings());
  const [isSaving, setIsSaving] = React.useState(false);
  const [syncMode, setSyncMode] = React.useState<SyncMode>("local");
  const [passwordForm, setPasswordForm] = React.useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    const storageKey = user?.email ? `${STORAGE_KEY}:${user.email}` : STORAGE_KEY;
    const baseSettings = createDefaultSettings(user?.email || "", user?.name || "");
    const storedSettings = getStoredSettings(storageKey, baseSettings);

    setSettings((current) => ({
      ...baseSettings,
      ...current,
      ...storedSettings,
      email: storedSettings.email || user?.email || current.email,
      fullName: storedSettings.fullName || user?.name || current.fullName,
    }));
  }, [user?.email, user?.name]);

  React.useEffect(() => {
    if (!user?.userId || !isSupabaseConfigured) return;
    const supabaseClient = supabase;
    if (!supabaseClient) {
      setSyncMode("local");
      return;
    }

    const loadServerProfile = async () => {
      try {
        const { data, error } = await supabaseClient
          .from("profiles")
          .select("name, role, state, municipality, avatar, alerts, legislation, language, appearance, highContrast")
          .eq("id", user.userId)
          .single();

        if (error) {
          console.error("Erro ao carregar perfil do Supabase:", error);
          setSyncMode("local");
          return;
        }

        if (data) {
          setSettings((current) => ({
            ...current,
            fullName: String(data.name ?? current.fullName),
            role: (data.role as UserRole) || current.role,
            state: String(data.state ?? current.state),
            municipality: String(data.municipality ?? current.municipality),
            avatar: String(data.avatar ?? current.avatar),
            alerts: typeof data.alerts === "boolean" ? data.alerts : current.alerts,
            legislation: typeof data.legislation === "boolean" ? data.legislation : current.legislation,
            language: (data.language as LanguagePreference) || current.language,
            appearance: (data.appearance as AppearancePreference) || current.appearance,
            highContrast: typeof data.highContrast === "boolean" ? data.highContrast : current.highContrast,
          }));
          setSyncMode("server");
        }
      } catch (error) {
        console.error("Erro ao carregar perfil do Supabase:", error);
        setSyncMode("local");
      }
    };

    void loadServerProfile();
  }, [user?.userId]);

  const persistSettings = async (nextSettings: SettingsState) => {
    const storageKey = nextSettings.email ? `${STORAGE_KEY}:${nextSettings.email}` : STORAGE_KEY;
    window.localStorage.setItem(storageKey, JSON.stringify(nextSettings));

    if (isSupabaseConfigured && supabase && user?.source === "server") {
      try {
        const response = await supabase.from("profiles").upsert(
          {
            id: user.userId,
            email: nextSettings.email,
            name: nextSettings.fullName,
            role: nextSettings.role,
            state: nextSettings.state,
            municipality: nextSettings.municipality,
            avatar: nextSettings.avatar || "",
            alerts: nextSettings.alerts,
            legislation: nextSettings.legislation,
            language: nextSettings.language,
            appearance: nextSettings.appearance,
            highContrast: nextSettings.highContrast,
          },
          { onConflict: "id" }
        );

        if (!response.error) {
          setSyncMode("server");
          return "server" as const;
        }

        console.error("Erro ao salvar perfil no Supabase:", response.error);
      } catch (error) {
        console.error("Erro ao salvar perfil no Supabase:", error);
      }
    }

    setSyncMode("local");
    return "local" as const;
  };

  const handleInputChange = (key: keyof SettingsState) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const value = event.target.value;
    setSettings((current) => ({ ...current, [key]: value as never }));
  };

  const handleToggle = (key: "alerts" | "legislation" | "highContrast") => () => {
    setSettings((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleSelectPhoto = () => fileInputRef.current?.click();

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const image = reader.result as string;
      setSettings((current) => ({ ...current, avatar: image }));
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setSettings((current) => ({ ...current, avatar: "" }));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      toast({
        title: "Localização indisponível",
        description: "Seu navegador não suporta geolocalização.",
        variant: "destructive",
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const inferredLocation = getBrazilianLocation(position.coords.latitude, position.coords.longitude);

        if (!inferredLocation) {
          toast({
            title: "Localização não identificada",
            description: "Não foi possível adaptar seu perfil com base na posição atual.",
            variant: "destructive",
          });
          return;
        }

        setSettings((current) => ({
          ...current,
          state: inferredLocation.state,
          municipality: inferredLocation.municipality,
        }));

        toast({
          title: "Localização aplicada",
          description: `Perfil adaptado para ${inferredLocation.municipality}, ${inferredLocation.state}.`,
        });
      },
      () => {
        toast({
          title: "Permissão negada",
          description: "Autorize o acesso à localização para adaptar o perfil à sua região.",
          variant: "destructive",
        });
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const nextMode = await persistSettings(settings);
      toast({
        title: "Configurações salvas",
        description: nextMode === "server"
          ? "Seu perfil foi salvo e sincronizado com o backend disponível."
          : "Seu perfil foi salvo localmente e ficará disponível ao entrar novamente.",
      });
    } catch {
      toast({
        title: "Erro ao salvar",
        description: "Não foi possível salvar suas configurações no momento.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const [isChangingPassword, setIsChangingPassword] = React.useState(false);

  const handlePasswordChange = async () => {
    if (!user?.email) {
      toast({
        title: "Erro ao alterar senha",
        description: "Nenhum usuário ativo foi identificado para atualizar a senha.",
        variant: "destructive",
      });
      return;
    }

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      toast({
        title: "Dados incompletos",
        description: "Preencha a senha atual, a nova senha e a confirmação para continuar.",
        variant: "destructive",
      });
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast({
        title: "Senhas diferentes",
        description: "A nova senha e a confirmação precisam ser iguais.",
        variant: "destructive",
      });
      return;
    }

    if (passwordForm.newPassword.length < 6) {
      toast({
        title: "Senha muito curta",
        description: "A nova senha deve ter pelo menos 6 caracteres.",
        variant: "destructive",
      });
      return;
    }

    setIsChangingPassword(true);
    try {
      if (user.source === "server" && isSupabaseConfigured && supabase) {
        // Re-authenticate to verify the current password, then update via Supabase
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: passwordForm.currentPassword,
        });

        if (signInError) {
          toast({
            title: "Senha atual incorreta",
            description: "A senha atual informada não corresponde à sua conta.",
            variant: "destructive",
          });
          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password: passwordForm.newPassword,
        });

        if (updateError) {
          toast({
            title: "Erro ao alterar senha",
            description: updateError.message ?? "Não foi possível alterar a senha.",
            variant: "destructive",
          });
          return;
        }
      } else if (user.source === "api") {
        const response = await fetch("/api/auth/password", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            currentPassword: passwordForm.currentPassword,
            newPassword: passwordForm.newPassword,
          }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { message?: string };
          toast({
            title: data.message === "Senha atual incorreta" ? "Senha atual incorreta" : "Erro ao alterar senha",
            description: data.message === "Senha atual incorreta"
              ? "A senha atual informada não corresponde à sua conta."
              : data.message ?? "Não foi possível alterar a senha.",
            variant: "destructive",
          });
          return;
        }
      } else {
        const result = changeLocalPassword({
          email: user.email,
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        });

        if (!result.success) {
          toast({
            title: "Senha atual incorreta",
            description: "A senha atual informada não corresponde à conta local.",
            variant: "destructive",
          });
          return;
        }
      }

      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      toast({
        title: "Senha atualizada",
        description: "Sua senha foi alterada com sucesso.",
      });
    } catch {
      toast({
        title: "Erro ao alterar senha",
        description: "Ocorreu um erro inesperado. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="rounded-3xl border border-border/50 bg-card p-8 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary">Configurações</p>
              <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-foreground">{SUBMISSION_MODE ? "Seu perfil" : `Seu perfil ${PRODUCT_NAME}`}</h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Ajuste seus dados, preferências de alerta e aparência para manter o ambiente da plataforma consistente com sua rotina.
              </p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {syncMode === "server"
                ? "Sincronização disponível"
                : "Modo local ativo"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-3xl border border-border/50 bg-card p-6 shadow-sm">
            <div className="flex flex-col items-center gap-4 text-center">
              <Avatar className="h-28 w-28 border border-border/50">
                {settings.avatar ? (
                  <AvatarImage src={settings.avatar} alt="Foto de perfil" />
                ) : (
                  <AvatarFallback className="bg-primary/10 text-primary">
                    <span className="text-xl font-semibold">
                      {settings.fullName?.split(" ")[0]?.[0] || "C"}
                      {settings.fullName?.split(" ").slice(-1)[0]?.[0] || "A"}
                    </span>
                  </AvatarFallback>
                )}
              </Avatar>
              <div>
                <p className="text-lg font-semibold text-foreground">{settings.fullName || "Usuário CERES"}</p>
                <p className="text-sm text-muted-foreground">{settings.role}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3">
              <Button type="button" variant="outline" className="w-full" onClick={handleSelectPhoto}>
                <Camera className="mr-2 h-4 w-4" /> Alterar foto
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={handleRemovePhoto}>
                Remover foto
              </Button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
            </div>

            <div className="mt-6 rounded-2xl border border-border/50 bg-background/80 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Sparkles className="h-4 w-4 text-primary" /> {SUBMISSION_MODE ? "Plataforma" : PRODUCT_NAME}
              </div>
              <p className="mt-2">Seu perfil é usado para personalizar alertas, notificações e insights do ambiente rural.</p>
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-border/50 bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <UserRound className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold text-foreground">Perfil</h2>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Nome</Label>
                  <Input id="fullName" value={settings.fullName} onChange={handleInputChange("fullName")} placeholder="Seu nome" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={settings.email} onChange={handleInputChange("email")} placeholder="seu@email.com" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Tipo de usuário</Label>
                  <select
                    id="role"
                    value={settings.role}
                    onChange={handleInputChange("role")}
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option>Produtor Rural</option>
                    <option>Analista Ambiental</option>
                    <option>Gestor Público</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">Estado (UF)</Label>
                  <Input id="state" value={settings.state} onChange={handleInputChange("state")} placeholder="Ex.: GO" />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="municipality">Município</Label>
                  <Input id="municipality" value={settings.municipality} onChange={handleInputChange("municipality")} placeholder="Ex.: Alto Paraíso de Goiás" />
                </div>
                <div className="md:col-span-2">
                  <Button type="button" variant="outline" onClick={handleUseMyLocation} className="w-full">
                    Adaptar perfil pela minha localização no Brasil
                  </Button>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-border/50 bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold text-foreground">Preferências</h2>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">Receber alertas ambientais</p>
                      <p className="text-sm text-muted-foreground">Alertas de risco e clima em tempo real.</p>
                    </div>
                    <Switch checked={settings.alerts} onCheckedChange={handleToggle("alerts")} />
                  </div>
                </div>
                <div className="rounded-2xl border border-border/50 bg-background/80 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground">Receber notificações sobre legislação</p>
                      <p className="text-sm text-muted-foreground">Atualizações de norma e compliance.</p>
                    </div>
                    <Switch checked={settings.legislation} onCheckedChange={handleToggle("legislation")} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="language">Linguagem</Label>
                  <select
                    id="language"
                    value={settings.language}
                    onChange={(event) => setSettings((current) => ({ ...current, language: event.target.value as LanguagePreference }))}
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="simplificada">Simplificada</option>
                    <option value="tecnica">Técnica</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="appearance">Aparência</Label>
                  <select
                    id="appearance"
                    value={settings.appearance}
                    onChange={(event) => setSettings((current) => ({ ...current, appearance: event.target.value as AppearancePreference }))}
                    className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="claro">Tema claro</option>
                    <option value="escuro">Tema escuro</option>
                    <option value="alto-contraste">Alto contraste</option>
                  </select>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-border/50 bg-card p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold text-foreground">Conta</h2>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
                <Input
                  type="password"
                  placeholder="Senha atual"
                  value={passwordForm.currentPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
                />
                <Input
                  type="password"
                  placeholder="Nova senha"
                  value={passwordForm.newPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
                />
                <Input
                  type="password"
                  placeholder="Confirmar senha"
                  value={passwordForm.confirmPassword}
                  onChange={(event) => setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))}
                />
              </div>
              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <Button type="button" variant="outline" onClick={handlePasswordChange} isLoading={isChangingPassword} disabled={isChangingPassword}>
                  <Lock className="mr-2 h-4 w-4" /> Alterar senha
                </Button>
                <Button type="button" variant="ghost" onClick={() => logout.mutate()}>
                  <LogOut className="mr-2 h-4 w-4" /> Logout
                </Button>
              </div>
              <div className="mt-4 rounded-2xl border border-border/50 bg-background/80 p-4 text-sm text-muted-foreground">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-foreground">Tema de alto contraste</p>
                    <p>Melhora a legibilidade para uso em campo.</p>
                  </div>
                  <Switch checked={settings.highContrast} onCheckedChange={handleToggle("highContrast")} />
                </div>
              </div>
            </section>

            {/* Reiniciar tutorial */}
            <div className="rounded-2xl border border-border/50 bg-card p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-foreground">Tutorial de navegação</p>
                <p className="text-xs text-muted-foreground mt-0.5">Reinicia o tutorial guiado de apresentação da plataforma.</p>
              </div>
              <button
                type="button"
                onClick={() => { resetOnboarding(); window.location.reload(); }}
                className="shrink-0 px-4 py-2 rounded-xl border border-border/60 text-sm font-medium hover:bg-secondary/50 transition-colors"
              >
                Reiniciar tutorial
              </button>
            </div>

            <div className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MoonStar className="h-4 w-4" />
                Ajustes salvos automaticamente no navegador e, quando disponível, no Supabase.
              </div>
              <Button type="button" onClick={handleSave} isLoading={isSaving}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
