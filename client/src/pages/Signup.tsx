import { useState } from "react";
import { useLocation } from "wouter";
import { signup } from "@/hooks/use-auth";
import { AuthShell, FormError, inputClass, primaryButtonClass } from "@/components/AuthShell";

const ORG_TYPES = [
  { value: "produtor", label: "Produtor rural" },
  { value: "empresa", label: "Empresa / indústria" },
  { value: "pesquisa", label: "Instituição de pesquisa" },
  { value: "gestao_publica", label: "Gestão ambiental pública" },
  { value: "outro", label: "Outro" },
];

export default function Signup() {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "", organizationName: "", organizationType: "produtor" });
  const [accept, setAccept] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password !== form.confirm) return setError("As senhas não coincidem.");
    if (!accept) return setError("É necessário aceitar a política de privacidade.");
    setLoading(true);
    try {
      await signup({
        name: form.name.trim(), email: form.email.trim(), password: form.password,
        organizationName: form.organizationName.trim() || undefined, organizationType: form.organizationType, acceptPrivacy: true,
      });
      setLocation("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir o cadastro.");
    } finally {
      setLoading(false);
    }
  }

  const label = "block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1.5";
  return (
    <AuthShell title="Criar conta" subtitle="Uma organização é criada para você. Você poderá convidar outros membros depois.">
      <FormError message={error} />
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div><label htmlFor="name" className={label}>Nome completo</label>
          <input id="name" autoComplete="name" value={form.name} onChange={set("name")} className={inputClass} required data-testid="input-name" /></div>
        <div><label htmlFor="email" className={label}>E-mail</label>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} className={inputClass} required data-testid="input-email" /></div>
        <div><label htmlFor="org" className={label}>Organização <span className="text-slate-600 dark:text-slate-300 font-normal">(opcional)</span></label>
          <input id="org" value={form.organizationName} onChange={set("organizationName")} className={inputClass} placeholder="Ex.: Fazenda Boa Vista" /></div>
        <div><label htmlFor="orgType" className={label}>Perfil</label>
          <select id="orgType" value={form.organizationType} onChange={set("organizationType")} className={inputClass}>
            {ORG_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></div>
        <div><label htmlFor="password" className={label}>Senha</label>
          <input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set("password")} className={inputClass}
            aria-describedby="pw-help" required data-testid="input-password" />
          <p id="pw-help" className="text-xs text-slate-600 dark:text-slate-300 mt-1">Mínimo de 8 caracteres, com letras e números.</p></div>
        <div><label htmlFor="confirm" className={label}>Confirmar senha</label>
          <input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set("confirm")} className={inputClass} required /></div>
        <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1" data-testid="checkbox-privacy" />
          <span>Li e aceito a <a href="/privacidade" className="underline text-[#0F5132] dark:text-emerald-400">política de privacidade</a> (LGPD).</span>
        </label>
        <button type="submit" disabled={loading} className={primaryButtonClass} data-testid="button-submit-signup">
          {loading ? "Criando conta..." : "Criar conta"}
        </button>
      </form>
      <p className="text-center text-sm text-slate-600 dark:text-slate-300 mt-6">
        Já tem conta? <button onClick={() => setLocation("/login")} className="font-semibold text-[#0F5132] dark:text-emerald-400 hover:underline">Entrar</button>
      </p>
    </AuthShell>
  );
}
