import { createPortal } from "react-dom";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, X, History, MapPin, Database, Repeat } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/RiskBadge";
import { useToast } from "@/hooks/use-toast";
import { useAuthStatus, hasRole } from "@/hooks/use-auth";
import { useAlerts, useAlert, useAlertTransition, STATUS_LABEL, type AlertRow } from "@/hooks/use-alerts";
import { EMERGENCY_NOTICE } from "@shared/identity";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { AlertDeliveries } from "@/components/notifications/NotificationSettings";

const EVAL_LABEL: Record<string, string> = { pertinente: "Pertinente", parcialmente_pertinente: "Parcialmente pertinente", nao_pertinente: "Não pertinente" };

/** Expert verdict on the alert (Proof of Value indicator: share of pertinent alerts). */
function AlertEvaluation({ a, canAct }: { a: any; canAct: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [v, setV] = useState<string>(a.evaluation ?? "");
  const [note, setNote] = useState<string>(a.evaluationNote ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("POST", `/api/alerts/${a.id}/evaluation`, { evaluation: v, ...(note.trim() ? { note: note.trim() } : {}) });
      await qc.invalidateQueries({ queryKey: ["/api/alerts"] });
      toast({ title: "Avaliação registrada" });
    } catch (e) {
      toast({ title: "Não foi possível registrar", description: (e as Error).message, variant: "destructive" });
    } finally { setBusy(false); }
  }
  return (
    <section className="border-t pt-4" aria-labelledby="eval-t" data-testid="alert-evaluation">
      <h3 id="eval-t" className="font-semibold text-sm mb-1">Avaliação do alerta</h3>
      <p className="text-xs text-muted-foreground mb-2">Depois de verificar a situação, registre se o alerta foi pertinente. Esta avaliação mede a utilidade real dos alertas.</p>
      {a.evaluation && <p className="text-sm mb-2">Atual: <strong>{EVAL_LABEL[a.evaluation]}</strong>{a.evaluationNote ? ` — ${a.evaluationNote}` : ""}</p>}
      {canAct && (
        <div className="space-y-2">
          <div role="radiogroup" aria-label="Avaliação" className="flex flex-wrap gap-2">
            {Object.entries(EVAL_LABEL).map(([k, l]) => (
              <label key={k} className={`text-sm rounded-full border px-3 py-1 cursor-pointer ${v === k ? "bg-primary text-primary-foreground border-primary" : ""}`}>
                <input type="radio" name={`eval-${a.id}`} value={k} checked={v === k} onChange={() => setV(k)} className="sr-only" />{l}
              </label>))}
          </div>
          <label htmlFor="eval-note" className="sr-only">Justificativa</label>
          <textarea id="eval-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
            placeholder={v && v !== "pertinente" ? "Justificativa (obrigatória)" : "Observação (opcional)"} className="w-full rounded-lg border border-input bg-background p-2 text-sm h-16" />
          <Button size="sm" variant="outline" onClick={save} disabled={!v || busy || (v !== "pertinente" && note.trim().length < 5)}>Registrar avaliação</Button>
        </div>
      )}
    </section>
  );
}
import type { AlertStatus } from "@shared/schema";
import type { RiskLevel } from "@shared/risk-engine";

const FILTERS: { key: string; label: string }[] = [
  { key: "abertos", label: "Abertos" },
  { key: "novo", label: "Novos" },
  { key: "em_acompanhamento", label: "Em acompanhamento" },
  { key: "resolvido", label: "Resolvidos" },
  { key: "descartado", label: "Descartados" },
  { key: "", label: "Todos" },
];

const RISK_LEVELS = ["baixo", "moderado", "alto", "crítico"];
const fmt = (d: string | Date | null | undefined) => (d ? format(new Date(d), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "—");

function SeverityBadge({ severity }: { severity: string }) {
  if (RISK_LEVELS.includes(severity)) return <RiskBadge level={severity as RiskLevel} size="sm" showIcon />;
  return <span className="text-xs border rounded-full px-2 py-0.5">{severity}</span>;
}

function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    novo: "bg-sky-50 text-sky-800 border-sky-200", reconhecido: "bg-indigo-50 text-indigo-800 border-indigo-200",
    em_acompanhamento: "bg-amber-50 text-amber-900 border-amber-200", resolvido: "bg-green-50 text-green-800 border-green-200",
    descartado: "bg-slate-100 text-slate-700 border-slate-300",
  };
  return <span className={`text-xs border rounded-full px-2 py-0.5 font-medium ${tone[status] ?? ""}`}>{STATUS_LABEL[status as AlertStatus] ?? status}</span>;
}

function AlertDrawer({ id, onClose, canAct }: { id: number; onClose: () => void; canAct: boolean }) {
  const { data: a, isLoading } = useAlert(id);
  const transition = useAlertTransition();
  const { toast } = useToast();
  const [note, setNote] = useState("");

  async function go(status: AlertStatus) {
    try {
      await transition.mutateAsync({ id, status, note, assignToMe: status === "reconhecido" || status === "em_acompanhamento" });
      setNote("");
      toast({ title: `Alerta: ${STATUS_LABEL[status]}` });
    } catch (e) {
      toast({ title: "Não foi possível alterar", description: (e as Error).message, variant: "destructive" });
    }
  }

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="alert-title" className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <div className="bg-card w-full sm:max-w-lg h-full overflow-y-auto p-6 space-y-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="alert-title" className="text-lg font-bold">{isLoading ? "Carregando..." : `Alerta #${a?.id} — ${a?.title}`}</h2>
          <button onClick={onClose} aria-label="Fechar" className="p-2 rounded-lg hover:bg-secondary"><X className="w-5 h-5" /></button>
        </div>
        {a && (
          <>
            <div className="flex flex-wrap gap-2"><SeverityBadge severity={a.severity} /><StatusPill status={a.status} />
              {a.isDemo && <span className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-full px-2 py-0.5">Demonstrativo</span>}</div>
            <p className="text-sm">{a.reason ?? a.message}</p>
            <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Emitido em</dt><dd>{fmt(a.createdAt)}</dd>
              <dt className="text-muted-foreground">Atualizado em</dt><dd>{fmt(a.updatedAt)}</dd>
              <dt className="text-muted-foreground">Fonte dos dados</dt><dd>{a.dataSource ?? "—"}</dd>
              <dt className="text-muted-foreground">Referência dos dados</dt><dd>{fmt(a.dataReferenceAt)}</dd>
              <dt className="text-muted-foreground">Origem</dt><dd>{a.kind === "foco_proximo" ? "foco de calor detectado (INPE)" : "análise de risco"}</dd>
              <dt className="text-muted-foreground">{a.kind === "foco_proximo" ? "Atualizações" : "Confirmações"}</dt><dd>{a.occurrenceCount}{a.kind === "foco_proximo" ? "" : " análise(s)"}</dd>
              {a.kind !== "foco_proximo" && <><dt className="text-muted-foreground">Análise de origem</dt><dd>{a.riskAnalysisId ? `#${a.riskAnalysisId}` : "—"}</dd></>}
              {a.areaId && <><dt className="text-muted-foreground">Propriedade</dt><dd><a className="underline" href={`/areas/${a.areaId}`}>abrir</a></dd></>}
            </dl>
            {a.kind === "foco_proximo" && Array.isArray((a.evidence as any)?.detections) && (
              <section><h3 className="font-semibold text-sm mb-1">Detecções que motivaram o alerta (observadas)</h3>
                <ul className="text-xs space-y-0.5 max-h-40 overflow-y-auto">{((a.evidence as any).detections as { id: number; at: string; satellite: string; km: number }[]).map((d) => (
                  <li key={d.id}>{fmt(d.at)} · {d.satellite} · {d.km === 0 ? "dentro da propriedade" : `${d.km.toLocaleString("pt-BR")} km do limite`}</li>))}</ul>
                <p className="text-[11px] text-muted-foreground mt-1">Foco de calor é detecção térmica por satélite, não incêndio confirmado.</p>
              </section>
            )}
            {Array.isArray(a.recommendations) && (a.recommendations as any[]).length > 0 && (
              <section><h3 className="font-semibold text-sm mb-2">Recomendações associadas</h3>
                <ul className="list-disc list-inside text-sm space-y-1">{(a.recommendations as any[]).map((r, i) => <li key={i}><span className="capitalize font-medium">{r.priority}</span>: {r.action}</li>)}</ul>
              </section>
            )}
            {canAct && a.allowedTransitions.length > 0 && (
              <section className="space-y-2 border-t pt-4">
                <label htmlFor="note" className="text-sm font-semibold block">Registrar ação</label>
                <textarea id="note" className="w-full rounded-lg border border-input bg-background p-2 text-sm h-20" value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Observação (obrigatória para descartar)" maxLength={2000} />
                <div className="flex flex-wrap gap-2">
                  {a.allowedTransitions.map((s) => (
                    <Button key={s} size="sm" variant={s === "descartado" ? "outline" : "default"} disabled={transition.isPending || (s === "descartado" && !note.trim())} onClick={() => go(s)}>
                      {s === "resolvido" ? "Marcar como resolvido" : s === "descartado" ? "Descartar" : `Mover para "${STATUS_LABEL[s]}"`}
                    </Button>
                  ))}
                </div>
              </section>
            )}
            <AlertEvaluation a={a} canAct={canAct} />
            <AlertDeliveries alertId={a.id} />
            <section className="border-t pt-4">
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><History className="w-4 h-4" aria-hidden />Histórico</h3>
              <ol className="space-y-3">
                {a.events.map((e) => (
                  <li key={e.id} className="text-sm border-l-2 pl-3">
                    <p className="font-medium">{e.fromStatus && e.fromStatus !== e.toStatus ? `${STATUS_LABEL[e.fromStatus as AlertStatus]} → ` : ""}{STATUS_LABEL[e.toStatus as AlertStatus] ?? e.toStatus}</p>
                    <p className="text-xs text-muted-foreground">{fmt(e.createdAt)} · {e.userName ?? "sistema"}</p>
                    {e.note && <p className="text-xs mt-0.5">{e.note}</p>}
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function Alerts() {
  const [filter, setFilter] = useState("abertos");
  // /alerts?id=N (from the property page or a notification) opens that alert
  const [openId, setOpenId] = useState<number | null>(() => Number(new URLSearchParams(window.location.search).get("id")) || null);
  const { data: user } = useAuthStatus();
  const { data: alerts = [], isLoading, error } = useAlerts(filter || undefined);
  const canAct = hasRole(user, "analyst");

  return (
    <Layout>
      <header className="mb-6">
        <h1 className="text-3xl font-bold font-display flex items-center gap-2"><Bell className="w-8 h-8 text-primary" aria-hidden />Alertas Preventivos</h1>
        <p className="text-muted-foreground mt-1">Emitidos por análises de risco de nível alto ou crítico e por focos de calor do INPE detectados dentro ou perto das propriedades. Repetições não duplicam alertas abertos.</p>
        <p className="text-xs mt-2 text-red-800 bg-red-50 border border-red-200 rounded-lg p-2 inline-block">{EMERGENCY_NOTICE}</p>
      </header>

      <div role="tablist" aria-label="Filtrar alertas por status" className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm border ${filter === f.key ? "bg-primary text-primary-foreground border-primary" : "hover:bg-secondary"}`}>
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-muted-foreground">Carregando alertas...</p>}
      {error && <p role="alert" className="text-red-700">{(error as Error).message}</p>}
      {!isLoading && alerts.length === 0 && (
        <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">
          Nenhum alerta neste filtro. Alertas são gerados quando uma análise classifica uma área como <strong>alto</strong> ou <strong>crítico</strong>.
        </div>
      )}

      <ul className="space-y-3">
        {alerts.map((a: AlertRow) => (
          <li key={a.id}>
            <button onClick={() => setOpenId(a.id)} className="w-full text-left rounded-2xl border bg-card p-4 shadow-sm hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid={`card-alert-${a.id}`}>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="font-semibold">#{a.id} · {a.title}</span>
                <SeverityBadge severity={a.severity} /><StatusPill status={a.status} />
                {a.occurrenceCount > 1 && <span className="text-xs flex items-center gap-1 text-muted-foreground"><Repeat className="w-3 h-3" aria-hidden />{a.occurrenceCount}×</span>}
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{a.reason ?? a.message}</p>
              <p className="text-xs text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1">
                <span>Emitido {fmt(a.createdAt)}</span>
                {a.areaId && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden />Área #{a.areaId}</span>}
                {a.dataSource && <span className="flex items-center gap-1"><Database className="w-3 h-3" aria-hidden />{a.dataSource}</span>}
              </p>
            </button>
          </li>
        ))}
      </ul>

      {openId && <AlertDrawer id={openId} canAct={canAct} onClose={() => setOpenId(null)} />}
    </Layout>
  );
}
