import { useState } from "react";
import { useLocation } from "wouter";
import { api } from "@/lib/api";
import { AuthShell, FormError, FormNotice, inputClass, primaryButtonClass } from "@/components/AuthShell";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const token = new URLSearchParams(window.location.search).get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const label = "block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setNotice("");
    if (token && password !== confirm) return setError("As senhas não coincidem.");
    setLoading(true);
    try {
      const r = token
        ? await api<{ message: string }>("POST", "/api/auth/password-reset/confirm", { token, newPassword: password })
        : await api<{ message: string }>("POST", "/api/auth/password-reset/request", { email: email.trim() });
      setNotice(r.message);
      if (token) setTimeout(() => setLocation("/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na solicitação.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={token ? "Definir nova senha" : "Recuperar senha"}
      subtitle={token ? "Escolha uma nova senha para sua conta." : "Enviaremos um link temporário (válido por 30 minutos)."}
    >
      <FormError message={error} />
      <FormNotice message={notice} />
      <form onSubmit={submit} className="space-y-4" noValidate>
        {token ? (
          <>
            <div><label htmlFor="pw" className={label}>Nova senha</label>
              <input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} required /></div>
            <div><label htmlFor="pw2" className={label}>Confirmar nova senha</label>
              <input id="pw2" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} required /></div>
          </>
        ) : (
          <div><label htmlFor="email" className={label}>E-mail</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} required /></div>
        )}
        <button type="submit" disabled={loading} className={primaryButtonClass}>{loading ? "Enviando..." : token ? "Salvar nova senha" : "Enviar link"}</button>
      </form>
      <p className="text-center text-sm mt-6">
        <button onClick={() => setLocation("/login")} className="font-semibold text-[#0F5132] dark:text-emerald-400 hover:underline">Voltar ao login</button>
      </p>
    </AuthShell>
  );
}
