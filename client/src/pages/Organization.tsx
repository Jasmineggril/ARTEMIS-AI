import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Users, ShieldCheck, Trash2, KeyRound } from "lucide-react";
import { AccessLinkNotice, type AccessLink } from "@/components/account/AccessLinkNotice";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuthStatus, hasRole, ROLE_LABEL, type OrgRole } from "@/hooks/use-auth";
import { api } from "@/lib/api";

interface Member { userId: number; name: string; email: string; role: OrgRole; since: string }
interface AuditRow { id: number; action: string; entityType: string | null; entityId: string | null; createdAt: string; userName: string | null; metadata: unknown }

const ROLES: OrgRole[] = ["viewer", "analyst", "manager", "admin", "owner"];
const ROLE_HELP: Record<OrgRole, string> = {
  viewer: "consulta dados", analyst: "executa análises e trata alertas", manager: "cadastra áreas e importa dados",
  admin: "gerencia membros e vê auditoria", owner: "controle total",
};

export default function Organization() {
  const { data: user } = useAuthStatus();
  const isAdmin = hasRole(user, "admin");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [issued, setIssued] = useState<{ who: string; access: AccessLink } | null>(null);
  const [role, setRole] = useState<OrgRole>("viewer");

  const { data: orgs = [] } = useQuery<{ id: number; name: string; role: OrgRole; active: boolean }[]>({
    queryKey: ["/api/auth/organizations"], queryFn: () => api("GET", "/api/auth/organizations"),
  });
  const { data: members = [] } = useQuery<Member[]>({ queryKey: ["/api/organization/members"], queryFn: () => api("GET", "/api/organization/members"), enabled: isAdmin });
  const { data: audit = [] } = useQuery<AuditRow[]>({ queryKey: ["/api/audit-logs"], queryFn: () => api("GET", "/api/audit-logs?limit=100"), enabled: isAdmin });

  const onErr = (e: Error) => toast({ title: "Erro", description: e.message, variant: "destructive" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["/api/organization/members"] }); qc.invalidateQueries({ queryKey: ["/api/audit-logs"] }); };
  const add = useMutation({
    mutationFn: () => api<{ invited: boolean; access?: AccessLink }>("POST", "/api/organization/members", { email: email.trim(), role, ...(name.trim() ? { name: name.trim() } : {}) }),
    onSuccess: (r) => {
      if (r.invited && r.access) setIssued({ who: email.trim(), access: r.access });
      toast({ title: r.invited ? "Convite criado" : "Membro adicionado" });
      setEmail(""); setName(""); setNeedsName(false); refresh();
    },
    onError: (e: Error & { body?: { needsName?: boolean } }) => {
      if (e.body?.needsName) { setNeedsName(true); toast({ title: "Pessoa ainda sem conta", description: "Informe o nome para enviar um convite." }); return; }
      onErr(e);
    },
  });
  const accessLink = useMutation({
    mutationFn: (m: Member) => api<AccessLink>("POST", `/api/organization/members/${m.userId}/access-link`).then((a) => ({ m, a })),
    onSuccess: ({ m, a }) => { setIssued({ who: m.name, access: a }); refresh(); },
    onError: onErr,
  });
  const change = useMutation({ mutationFn: (v: { userId: number; role: OrgRole }) => api("PATCH", `/api/organization/members/${v.userId}`, { role: v.role }), onSuccess: refresh, onError: onErr });
  const remove = useMutation({ mutationFn: (userId: number) => api("DELETE", `/api/organization/members/${userId}`), onSuccess: refresh, onError: onErr });
  const switchOrg = useMutation({ mutationFn: (id: number) => api("POST", "/api/auth/switch-organization", { organizationId: id }), onSuccess: () => { qc.clear(); window.location.assign("/dashboard"); }, onError: onErr });

  const input = "rounded-lg border border-input bg-background px-3 py-2 text-sm";
  return (
    <Layout>
      <h1 className="text-3xl font-bold font-display flex items-center gap-2 mb-1"><Users className="w-8 h-8 text-primary" aria-hidden />Organização</h1>
      <p className="text-muted-foreground mb-6">{user?.organization?.name} · seu papel: <strong>{user?.organization ? ROLE_LABEL[user.organization.role] : "—"}</strong></p>

      {orgs.length > 1 && (
        <section className="bg-card border rounded-2xl p-5 mb-6">
          <h2 className="font-semibold mb-2">Suas organizações</h2>
          <ul className="space-y-2">{orgs.map((o) => (
            <li key={o.id} className="flex items-center justify-between text-sm">
              <span>{o.name} <span className="text-muted-foreground">({ROLE_LABEL[o.role]})</span></span>
              {o.active ? <span className="text-xs font-semibold text-primary">ativa</span> : <Button size="sm" variant="outline" onClick={() => switchOrg.mutate(o.id)}>Alternar</Button>}
            </li>))}</ul>
        </section>
      )}

      {!isAdmin ? (
        <p className="text-sm text-muted-foreground">A gestão de membros e a trilha de auditoria são restritas a administradores da organização.</p>
      ) : (
        <>
          <section className="bg-card border rounded-2xl p-5 mb-6" aria-labelledby="members">
            <h2 id="members" className="font-semibold mb-3">Membros</h2>
            <form className="flex flex-col sm:flex-row gap-2 mb-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
              <label htmlFor="m-email" className="sr-only">E-mail</label>
              <input id="m-email" type="email" className={`${input} flex-1`} placeholder="e-mail da pessoa" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <label htmlFor="m-name" className="sr-only">Nome (para convidar quem ainda não tem conta)</label>
              <input id="m-name" className={`${input} sm:w-48 ${needsName ? "ring-2 ring-amber-400" : ""}`} placeholder="nome (se ainda não tem conta)" value={name} onChange={(e) => setName(e.target.value)} required={needsName} minLength={2} />
              <label htmlFor="m-role" className="sr-only">Papel</label>
              <select id="m-role" className={input} value={role} onChange={(e) => setRole(e.target.value as OrgRole)}>
                {ROLES.filter((r) => r !== "owner" || user?.organization?.role === "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]} — {ROLE_HELP[r]}</option>)}
              </select>
              <Button type="submit" disabled={add.isPending}>{add.isPending ? "Enviando…" : "Adicionar ou convidar"}</Button>
            </form>
            <p className="text-xs text-muted-foreground -mt-2 mb-4">Quem ainda não tem conta recebe um convite para definir a própria senha.</p>
            {issued && <div className="mb-4"><AccessLinkNotice who={issued.who} access={issued.access} onClose={() => setIssued(null)} /></div>}
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th className="py-2">Nome</th><th>E-mail</th><th>Papel</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>{members.map((m) => (
                <tr key={m.userId} className="border-t">
                  <td className="py-2">{m.name}</td><td className="break-all">{m.email}</td>
                  <td>{m.userId === user?.userId ? ROLE_LABEL[m.role] : (
                    <select aria-label={`Papel de ${m.name}`} className={`${input} py-1`} value={m.role} onChange={(e) => change.mutate({ userId: m.userId, role: e.target.value as OrgRole })}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>)}</td>
                  <td className="text-right whitespace-nowrap">{m.userId !== user?.userId && (<>
                    <Button size="sm" variant="outline" className="mr-1" title="Gerar link de acesso (redefinir senha)" aria-label={`Gerar link de acesso para ${m.name}`} disabled={accessLink.isPending} onClick={() => accessLink.mutate(m)}><KeyRound className="w-4 h-4" aria-hidden /></Button>
                    <Button size="sm" variant="outline" aria-label={`Remover ${m.name}`} onClick={() => window.confirm(`Remover ${m.name} da organização?`) && remove.mutate(m.userId)}><Trash2 className="w-4 h-4" aria-hidden /></Button></>)}</td>
                </tr>))}</tbody>
            </table></div>
          </section>

          <section className="bg-card border rounded-2xl p-5" aria-labelledby="audit">
            <h2 id="audit" className="font-semibold mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4" aria-hidden />Trilha de auditoria (últimos 100 eventos)</h2>
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-left text-muted-foreground"><th className="py-1">Data/hora</th><th>Usuário</th><th>Ação</th><th>Objeto</th></tr></thead>
              <tbody>{audit.map((a) => (
                <tr key={a.id} className="border-t"><td className="py-1 whitespace-nowrap">{format(new Date(a.createdAt), "dd/MM/yyyy HH:mm:ss")}</td>
                  <td>{a.userName ?? "—"}</td><td className="font-mono">{a.action}</td><td>{a.entityType ? `${a.entityType} #${a.entityId ?? ""}` : "—"}</td></tr>))}</tbody>
            </table></div>
          </section>
        </>
      )}
    </Layout>
  );
}
