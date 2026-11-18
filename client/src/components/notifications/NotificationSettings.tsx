import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Button } from "@/components/Button";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api";

interface Prefs { emailEnabled: boolean; minSeverity: string; kinds: string[]; saved: boolean; smtpConfigured: boolean }
const SEVERITIES = [["baixo", "Baixo ou maior"], ["moderado", "Moderado ou maior"], ["alto", "Alto ou maior"], ["crítico", "Somente crítico"]];
const KINDS = [["foco_proximo", "Foco de calor do INPE dentro ou perto da propriedade"], ["risco", "Risco alto ou crítico calculado numa análise"]];

/** Own e-mail notification preferences. States plainly when the server cannot send e-mail. */
export function NotificationSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<Prefs>({ queryKey: ["/api/notifications/preferences"] });
  const [p, setP] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setP(data); }, [data]);
  if (!p) return null;
  const toggleKind = (k: string) => setP({ ...p, kinds: p.kinds.includes(k) ? p.kinds.filter((x) => x !== k) : [...p.kinds, k] });
  async function save() {
    setBusy(true);
    try {
      await api("PUT", "/api/notifications/preferences", { emailEnabled: p!.emailEnabled, minSeverity: p!.minSeverity, kinds: p!.kinds });
      await qc.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Preferências de notificação salvas" });
    } catch (e) {
      toast({ title: "Não foi possível salvar", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }
  return (
    <section className="rounded-3xl border border-border/50 bg-card p-6 shadow-sm" aria-labelledby="notif-title" data-testid="notification-settings">
      <div className="flex items-center gap-2">
        <Bell className="h-5 w-5 text-primary" aria-hidden />
        <h2 id="notif-title" className="text-xl font-semibold text-foreground">Notificações por e-mail</h2>
      </div>
      {!p.smtpConfigured && (
        <p role="status" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          O envio de e-mail ainda não está configurado neste servidor. Suas preferências ficam salvas e os avisos ficam registrados como
          <strong> não enviados</strong>; serão enviados quando o administrador configurar o e-mail. Os alertas continuam aparecendo em Alertas Preventivos.
        </p>
      )}
      <div className="mt-4 space-y-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={p.emailEnabled} onChange={(e) => setP({ ...p, emailEnabled: e.target.checked })} />
          Receber alertas da minha organização por e-mail
        </label>
        <fieldset disabled={!p.emailEnabled} className="space-y-3 disabled:opacity-50">
          <div>
            <label htmlFor="notif-sev" className="block font-medium mb-1">Gravidade mínima</label>
            <select id="notif-sev" value={p.minSeverity} onChange={(e) => setP({ ...p, minSeverity: e.target.value })} className="rounded-lg border border-input bg-background px-3 py-2">
              {SEVERITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div role="group" aria-label="Tipos de alerta">
            <p className="font-medium mb-1">Tipos de alerta</p>
            {KINDS.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={p.kinds.includes(k)} onChange={() => toggleKind(k)} />{l}</label>
            ))}
          </div>
        </fieldset>
        <Button onClick={save} disabled={busy}>Salvar notificações</Button>
      </div>
    </section>
  );
}

const DELIVERY_LABEL: Record<string, string> = { pendente: "aguardando envio", enviado: "enviado", falha: "falhou", bloqueado_configuracao: "não enviado — e-mail não configurado" };

/** Delivery log of one alert (who was notified, and whether it really went out). */
export function AlertDeliveries({ alertId }: { alertId: number }) {
  const { data } = useQuery<{ smtpConfigured: boolean; deliveries: { id: number; status: string; recipient: string | null; attempts: number; sentAt: string | null; lastError: string | null }[] }>({ queryKey: [`/api/alerts/${alertId}/deliveries`] });
  if (!data) return null;
  return (
    <section className="border-t pt-4" aria-labelledby={`deliv-${alertId}`} data-testid="alert-deliveries">
      <h3 id={`deliv-${alertId}`} className="font-semibold text-sm mb-1">Notificações por e-mail</h3>
      {data.deliveries.length === 0
        ? <p className="text-xs text-muted-foreground">Nenhuma notificação gerada para este alerta (preferências dos membros ou gravidade abaixo do mínimo).</p>
        : <ul className="text-sm space-y-1">
            {data.deliveries.map((d) => (
              <li key={d.id}>
                {d.recipient ?? "membro"}: <strong>{DELIVERY_LABEL[d.status] ?? d.status}</strong>
                {d.sentAt ? ` em ${new Date(d.sentAt).toLocaleString("pt-BR")}` : ""}
                {d.status === "pendente" && d.attempts > 0 ? ` (${d.attempts} tentativa(s); nova tentativa automática)` : ""}
              </li>))}
          </ul>}
    </section>
  );
}
