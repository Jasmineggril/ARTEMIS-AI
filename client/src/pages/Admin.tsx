/**
 * Platform administration. Every figure comes from GET /api/admin/overview
 * (database at request time); nothing here is estimated or illustrative.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { ShieldAlert, Users, Building2, MapPinned, Activity, BellRing, Database, KeyRound, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { AccessLinkNotice, type AccessLink } from "@/components/account/AccessLinkNotice";
import { useAuthStatus } from "@/hooks/use-auth";
import { api, ApiError } from "@/lib/api";

interface Overview {
  generatedAt: string;
  users: { total: number; new30: number; admins: number };
  organizations: { total: number; withAreas: number };
  areas: { total: number; withBoundary: number; withCoords: number };
  analyses: { total: number; last7: number; high30: number };
  alerts: { open: number; new: number; last7: number };
  imports: { batches: number; rows: number };
  data: { hotspots48h: number; officialRecords: number; importedRecords: number; dbSize: string };
  sources: { key: string; name: string; status: string; integrationStatus: string | null; lastSuccessAt: string | null; lastFailureAt: string | null; failures24h: number; running: number }[];
  failures: { id: number; source: string; startedAt: string; error: string | null }[];
  audit: { id: number; action: string; createdAt: string; userEmail: string | null; organization: string | null; entityType: string | null; entityId: string | null }[];
}
interface AdminUser { id: number; email: string; name: string; platformRole: string | null; createdAt: string; lastLoginAt: string | null; organizations: { id: number; name: string; role: string }[] }

const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : "—");
const n = (v: number | undefined) => (v ?? 0).toLocaleString("pt-BR");

function Kpi({ icon: Icon, label, value, detail }: { icon: typeof Users; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5"><Icon className="w-4 h-4 text-primary" aria-hidden />{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function Admin() {
  const { data: me } = useAuthStatus();
  const isPlatformAdmin = me?.platformRole === "platform_admin";
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [issued, setIssued] = useState<{ who: string; access: AccessLink } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const { data: o, error, isLoading, refetch, isFetching } = useQuery<Overview>({
    queryKey: ["/api/admin/overview"], queryFn: () => api("GET", "/api/admin/overview"), enabled: isPlatformAdmin, retry: false,
  });
  const { data: users = [], isLoading: loadingUsers } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/users", search], queryFn: () => api("GET", `/api/admin/users?limit=100${search ? `&q=${encodeURIComponent(search)}` : ""}`), enabled: isPlatformAdmin,
  });
  const link = useMutation({
    mutationFn: (u: AdminUser) => api<AccessLink>("POST", `/api/admin/users/${u.id}/access-link`).then((a) => ({ u, a })),
    onSuccess: ({ u, a }) => { setLinkError(null); setIssued({ who: u.email, access: a }); },
    onError: (e) => setLinkError(e instanceof ApiError ? e.message : "Não foi possível gerar o link."),
  });

  if (me && !isPlatformAdmin) {
    return (
      <Layout>
        <h1 className="text-3xl font-bold font-display mb-2">Painel Administrativo</h1>
        <p className="text-sm text-muted-foreground flex items-center gap-2"><ShieldAlert className="w-4 h-4" aria-hidden />
          Restrito à administração da plataforma. Para gerir membros da sua organização, use <Link href="/organization" className="underline">Organização</Link>.</p>
      </Layout>
    );
  }

  return (
    <Layout>
      <header className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-3xl font-bold font-display">Painel Administrativo</h1>
          <p className="text-sm text-muted-foreground mt-1">Indicadores lidos do banco de dados{o ? ` em ${when(o.generatedAt)}` : ""}. Dados de demonstração não entram nas contagens de alertas.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" asChild><Link href="/admin/operacao">Operação e evidências</Link></Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} aria-hidden />Atualizar</Button>
        </div>
      </header>

      {isLoading && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-busy="true">{[...Array(8)].map((_, i) => <div key={i} className="h-24 rounded-2xl border bg-card animate-pulse" />)}</div>}
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 text-red-900 p-3 text-sm">Não foi possível carregar os indicadores: {(error as Error).message}</p>}

      {o && (
        <>
          <section aria-label="Indicadores" className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            <Kpi icon={Users} label="Usuários" value={n(o.users.total)} detail={`${n(o.users.new30)} nos últimos 30 dias · ${n(o.users.admins)} admin. da plataforma`} />
            <Kpi icon={Building2} label="Organizações" value={n(o.organizations.total)} detail={`${n(o.organizations.withAreas)} com áreas cadastradas`} />
            <Kpi icon={MapPinned} label="Áreas monitoradas" value={n(o.areas.total)} detail={`${n(o.areas.withBoundary)} com polígono · ${n(o.areas.withCoords)} com coordenadas`} />
            <Kpi icon={Activity} label="Análises de risco" value={n(o.analyses.total)} detail={`${n(o.analyses.last7)} em 7 dias · ${n(o.analyses.high30)} alto/crítico em 30 dias`} />
            <Kpi icon={BellRing} label="Alertas abertos" value={n(o.alerts.open)} detail={`${n(o.alerts.new)} novos · ${n(o.alerts.last7)} criados em 7 dias`} />
            <Kpi icon={Database} label="Focos INPE (48 h)" value={n(o.data.hotspots48h)} detail="detecções por satélite armazenadas" />
            <Kpi icon={Database} label="ROIs Sisfogo" value={n(o.data.officialRecords)} detail="registros oficiais publicados" />
            <Kpi icon={Database} label="Banco de dados" value={o.data.dbSize} detail={`${n(o.imports.batches)} lotes importados · ${n(o.data.importedRecords)} ocorrências`} />
          </section>

          <section className="bg-card border rounded-2xl p-5 mb-6" aria-labelledby="src-title">
            <h2 id="src-title" className="font-semibold mb-3">Integrações e sincronizações</h2>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Fonte</th><th className="pr-3">Situação</th><th className="pr-3">Último sucesso</th><th className="pr-3">Última falha</th><th className="text-right">Falhas 24 h</th></tr></thead>
              <tbody>{o.sources.map((s) => (
                <tr key={s.key} className="border-t align-top">
                  <td className="py-2 pr-3"><span className="font-medium">{s.name}</span><br /><span className="text-xs text-muted-foreground">{s.integrationStatus ?? s.key}</span></td>
                  <td className="pr-3 whitespace-nowrap">{s.running ? "sincronizando…" : s.status}</td>
                  <td className="pr-3 whitespace-nowrap">{when(s.lastSuccessAt)}</td>
                  <td className="pr-3 whitespace-nowrap">{when(s.lastFailureAt)}</td>
                  <td className={`text-right tabular-nums ${s.failures24h ? "text-red-700 font-semibold" : ""}`}>{s.failures24h}</td>
                </tr>))}</tbody>
            </table></div>
            {o.failures.length > 0 ? (
              <details className="mt-3 text-sm"><summary className="cursor-pointer flex items-center gap-1"><AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden />Últimas falhas registradas ({o.failures.length})</summary>
                <ul className="mt-2 space-y-1 text-xs">{o.failures.map((f) => <li key={f.id}><span className="font-mono">{f.source}</span> · {when(f.startedAt)} — {f.error ?? "sem mensagem"}</li>)}</ul></details>
            ) : <p className="mt-3 text-sm flex items-center gap-1 text-emerald-800"><CheckCircle2 className="w-4 h-4" aria-hidden />Nenhuma falha de sincronização registrada.</p>}
            <p className="text-xs text-muted-foreground mt-2">Sincronização manual do Sisfogo: <Link href="/data-sources" className="underline">Fontes de Dados</Link>.</p>
          </section>
        </>
      )}

      <section className="bg-card border rounded-2xl p-5 mb-6" aria-labelledby="users-title">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 id="users-title" className="font-semibold">Usuários</h2>
          <form onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }} className="flex gap-2">
            <label htmlFor="u-q" className="sr-only">Buscar por nome ou e-mail</label>
            <input id="u-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="nome ou e-mail" className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm" />
            <Button type="submit" size="sm" variant="outline">Buscar</Button>
          </form>
        </div>
        {issued && <div className="mb-3"><AccessLinkNotice who={issued.who} access={issued.access} onClose={() => setIssued(null)} /></div>}
        {linkError && <p role="alert" className="text-sm text-red-700 mb-2">{linkError}</p>}
        {loadingUsers ? <p className="text-sm text-muted-foreground">Carregando…</p> : users.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum usuário encontrado.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1 pr-3">Nome</th><th className="pr-3">E-mail</th><th className="pr-3">Organizações</th><th className="pr-3">Cadastro</th><th className="pr-3">Último acesso</th><th><span className="sr-only">Ações</span></th></tr></thead>
            <tbody>{users.map((u) => (
              <tr key={u.id} className="border-t align-top">
                <td className="py-2 pr-3">{u.name}{u.platformRole === "platform_admin" && <span className="ml-1 text-[10px] uppercase tracking-wide rounded bg-primary/10 text-primary px-1">admin</span>}</td>
                <td className="pr-3 break-all">{u.email}</td>
                <td className="pr-3 text-xs">{u.organizations.length ? u.organizations.map((g) => `${g.name} (${g.role})`).join(", ") : "—"}</td>
                <td className="pr-3 whitespace-nowrap">{when(u.createdAt)}</td>
                <td className="pr-3 whitespace-nowrap">{u.lastLoginAt ? when(u.lastLoginAt) : "nunca"}</td>
                <td className="text-right">{u.id !== me?.userId && (
                  <Button size="sm" variant="outline" title="Gerar link de acesso (redefinir senha)" aria-label={`Gerar link de acesso para ${u.email}`} disabled={link.isPending} onClick={() => link.mutate(u)}><KeyRound className="w-4 h-4" aria-hidden /></Button>)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      {o && (
        <section className="bg-card border rounded-2xl p-5" aria-labelledby="audit-title">
          <h2 id="audit-title" className="font-semibold mb-3">Auditoria da plataforma (últimos 25 eventos)</h2>
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-3">Data/hora</th><th className="pr-3">Usuário</th><th className="pr-3">Organização</th><th className="pr-3">Ação</th><th>Objeto</th></tr></thead>
            <tbody>{o.audit.map((a) => (
              <tr key={a.id} className="border-t"><td className="py-1 pr-3 whitespace-nowrap">{when(a.createdAt)}</td><td className="pr-3 break-all">{a.userEmail ?? "—"}</td>
                <td className="pr-3">{a.organization ?? "—"}</td><td className="pr-3 font-mono">{a.action}</td><td>{a.entityType ? `${a.entityType} #${a.entityId ?? ""}` : "—"}</td></tr>))}</tbody>
          </table></div>
        </section>
      )}
    </Layout>
  );
}
