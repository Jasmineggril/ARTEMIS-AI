import { useState } from "react";
import { useLocation } from "wouter";
import { login } from "@/hooks/use-auth";
import { AuthShell, FormError, inputClass, primaryButtonClass } from "@/components/AuthShell";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [, setLocation] = useLocation();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email.trim(), password);
      setLocation("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Bem-vindo" subtitle="Entre com seus dados para acessar o painel da sua organização.">
      <FormError message={error} />
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">E-mail</label>
          <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className={inputClass} placeholder="seu@email.com" required data-testid="input-email" />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5">Senha</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)}
            className={inputClass} required data-testid="input-password" />
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={() => setLocation("/reset-password")} className="text-sm font-medium text-[#0F5132] dark:text-emerald-400 hover:underline">
            Esqueci minha senha
          </button>
        </div>
        <button type="submit" disabled={loading} className={primaryButtonClass} data-testid="button-submit-login">
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
      <p className="text-center text-sm text-slate-600 dark:text-slate-300 mt-6">
        Não tem conta?{" "}
        <button onClick={() => setLocation("/signup")} className="font-semibold text-[#0F5132] dark:text-emerald-400 hover:underline" data-testid="button-link-signup">
          Cadastre-se
        </button>
      </p>
    </AuthShell>
  );
}
