import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FileText, Printer, Download, Info, FlaskConical } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { RiskBadge } from "@/components/RiskBadge";
import { useAuthStatus, hasRole } from "@/hooks/use-auth";
import { STATUS_LABEL } from "@/hooks/use-alerts";
import { api } from "@/lib/api";
import { PRODUCT_NAME, TRL_LABEL, DECISION_SUPPORT_DISCLAIMER, SUBMISSION_MODE } from "@shared/identity";
import type { MonitoredArea, AlertStatus } from "@shared/schema";
import type { RiskLevel } from "@shared/risk-engine";
import { OPERATION_LABELS } from "./Areas";

interface AreaReport {
  generatedAt: string;
  systemVersion: string;
  period: { from: string; to: string };
  area: MonitoredArea;
  summary: { analyses: number; experimental: number; scoreMin: number | null; scoreMax: number | null; scoreAvg: number | null; distribution: Record<RiskLevel, number>; qualityLevels: Record<string, number> };
  sources: { key: string; name: string; count: number }[];
  engines: { engine: string; count: number }[];
  analyses: { id: number; createdAt: string; score: number; level: RiskLevel; engineType: string; isExperimental: boolean; topFactors: string[] }[];
  alerts: { id: number; createdAt: string; severity: string; status: AlertStatus; occurrenceCount: number; recommendations: { priority: string; action: string }[] | null }[];
  limitations: string[];
}

const LEVELS: RiskLevel[] = ["crítico", "alto", "moderado", "baixo"];
const dt = (d: string) => format(new Date(d), "dd/MM/yyyy HH:mm", { locale: ptBR });
const day = (d: string) => format(new Date(d), "dd/MM/yyyy", { locale: ptBR });

export default function Reports() {
  const { data: user } = useAuthStatus();
  const today = format(new Date(), "yyyy-MM-dd");
  const [areaId, setAreaId] = useState<number | null>(null);
  const [from, setFrom] = useState(format(subDays(new Date(), 90), "yyyy-MM-dd"));
  const [to, setTo] = useState(today);

  const { data: areas = [] } = useQuery<MonitoredArea[]>({ queryKey: ["/api/areas"], queryFn: () => api("GET", "/api/areas") });
  useEffect(() => { if (!areaId && areas.length) setAreaId(areas[0].id); }, [areas, areaId]);

  const { data: r, isFetching, error } = useQuery<AreaReport>({
    queryKey: ["/api/reports/areas", areaId, from, to],
    queryFn: () => api("GET", `/api/reports/areas/${areaId}?from=${from}&to=${to}`),
    enabled: !!areaId,
  });

  const input = "rounded-lg border border-input bg-background px-3 py-2 text-sm";
  return (
    <Layout>
      <header className="mb-6 print:hidden">
        <h1 className="text-3xl font-bold font-display flex items-center gap-2"><FileText className="w-8 h-8 text-primary" aria-hidden />Relatórios</h1>
        <p className="text-muted-foreground mt-1">Relatório por área e período, gerado a partir das análises e alertas armazenados da organização.</p>
      </header>

      {areas.length === 0 ? (
        <p className="text-muted-foreground">Cadastre uma área e execute análises para gerar relatórios.</p>
      ) : (
        <form className="flex flex-col sm:flex-row sm:items-end gap-3 mb-6 print:hidden" onSubmit={(e) => e.preventDefault()}>
          <div className="flex-1"><label htmlFor="r-area" className="text-xs text-muted-foreground block mb-1">Área</label>
            <select id="r-area" className={`${input} w-full`} value={areaId ?? ""} onChange={(e) => setAreaId(Number(e.target.value))}>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.municipality}/{a.state}</option>)}
            </select></div>
          <div><label htmlFor="r-from" className="text-xs text-muted-foreground block mb-1">De</label>
            <input id="r-from" type="date" className={input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label htmlFor="r-to" className="text-xs text-muted-foreground block mb-1">Até</label>
            <input id="r-to" type="date" className={input} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></div>
          <Button type="button" variant="outline" onClick={() => window.print()} disabled={!r}><Printer className="w-4 h-4 mr-1" aria-hidden />Imprimir / PDF</Button>
          {hasRole(user, "analyst") && areaId && (
            <Button asChild variant="outline"><a href={`/api/reports/areas/${areaId}/analyses.csv`} download><Download className="w-4 h-4 mr-1" aria-hidden />CSV completo</a></Button>
          )}
        </form>
      )}

      {isFetching && <p className="text-muted-foreground print:hidden">Gerando relatório...</p>}
      {error && <p role="alert" className="text-red-700">{(error as Error).message}</p>}

      {r && (
        <article className="bg-card border rounded-2xl p-6 space-y-6 print:border-0 print:p-0" aria-labelledby="rep-title">
          <header className="flex flex-col sm:flex-row sm:justify-between gap-2 border-b pb-4">
            <div>
              <p className="text-xs text-muted-foreground">{SUBMISSION_MODE ? "Plataforma Preditiva" : PRODUCT_NAME} · {user?.organization?.name}</p>
              <h2 id="rep-title" className="text-2xl font-bold">{r.area.name}</h2>
              <p className="text-sm text-muted-foreground">
                {r.area.municipality}/{r.area.state} · {OPERATION_LABELS[r.area.operationType] ?? r.area.operationType}
                {r.area.areaHectares != null && ` · ${r.area.areaHectares.toLocaleString("pt-BR")} ha`}
                {r.area.latitude != null && ` · ${r.area.latitude.toFixed(4)}, ${r.area.longitude!.toFixed(4)}`}
              </p>
            </div>
            <dl className="text-xs text-muted-foreground grid grid-cols-[auto_1fr] gap-x-2 sm:text-right">
              <dt>Período</dt><dd>{day(r.period.from)} a {day(r.period.to)}</dd>
              <dt>Gerado em</dt><dd>{dt(r.generatedAt)}</dd>
              <dt>Sistema</dt><dd>{r.systemVersion}</dd>
              <dt>Maturidade</dt><dd>{TRL_LABEL}</dd>
            </dl>
          </header>

          {r.summary.analyses === 0 ? (
            <p className="text-muted-foreground">Nenhuma análise desta área no período selecionado.</p>
          ) : (
            <>
              <section aria-labelledby="s-sum">
                <h3 id="s-sum" className="font-semibold mb-3">Resumo</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Análises</p><p className="text-xl font-bold">{r.summary.analyses}</p></div>
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Índice médio</p><p className="text-xl font-bold">{r.summary.scoreAvg}</p></div>
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Mín. – máx.</p><p className="text-xl font-bold">{r.summary.scoreMin}–{r.summary.scoreMax}</p></div>
                  <div className="rounded-xl bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Alertas emitidos</p><p className="text-xl font-bold">{r.alerts.length}</p></div>
                </div>
                <ul className="flex flex-wrap gap-3 mt-3 text-sm">
                  {LEVELS.map((l) => <li key={l} className="flex items-center gap-1"><RiskBadge level={l} size="sm" showIcon /> {r.summary.distribution[l] ?? 0}</li>)}
                </ul>
                {r.summary.experimental > 0 && (
                  <p className="text-xs mt-2 text-violet-800 flex items-center gap-1"><FlaskConical className="w-3 h-3" aria-hidden />{r.summary.experimental} análise(s) feita(s) com o modelo experimental (dados sintéticos).</p>
                )}
              </section>

              <section aria-labelledby="s-hist">
                <h3 id="s-hist" className="font-semibold mb-2">Histórico das análises</h3>
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="text-left text-muted-foreground text-xs"><th className="py-1">#</th><th>Data/hora</th><th>Nível</th><th>Principais fatores</th></tr></thead>
                  <tbody>{r.analyses.map((a) => (
                    <tr key={a.id} className="border-t align-top">
                      <td className="py-1.5">{a.id}</td><td className="whitespace-nowrap pr-2">{dt(a.createdAt)}</td>
                      <td><RiskBadge level={a.level} score={a.score} size="sm" />{a.isExperimental && <span className="text-[10px] text-violet-800 ml-1">exp.</span>}</td>
                      <td className="text-xs">{a.topFactors.join("; ") || "—"}</td>
                    </tr>))}</tbody>
                </table></div>
              </section>

              <section aria-labelledby="s-alerts">
                <h3 id="s-alerts" className="font-semibold mb-2">Alertas e medidas preventivas</h3>
                {r.alerts.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum alerta no período.</p> : (
                  <ul className="space-y-2 text-sm">{r.alerts.map((a) => (
                    <li key={a.id} className="border rounded-xl p-3">
                      <p className="font-medium">Alerta #{a.id} · {dt(a.createdAt)} · {a.severity} · {STATUS_LABEL[a.status] ?? a.status}{a.occurrenceCount > 1 && ` · confirmado ${a.occurrenceCount}×`}</p>
                      {a.recommendations && <ul className="list-disc list-inside text-xs mt-1">{a.recommendations.map((x, i) => <li key={i}><span className="capitalize">{x.priority}</span>: {x.action}</li>)}</ul>}
                    </li>))}</ul>
                )}
              </section>

              <section aria-labelledby="s-src" className="grid md:grid-cols-2 gap-4">
                <div>
                  <h3 id="s-src" className="font-semibold mb-2">Fontes utilizadas</h3>
                  <ul className="text-sm space-y-1">{r.sources.map((s) => <li key={s.key}>• {s.name} — {s.count} análise(s)</li>)}</ul>
                  <h3 className="font-semibold mt-4 mb-2">Indicadores de qualidade</h3>
                  <ul className="text-sm space-y-1">{Object.entries(r.summary.qualityLevels).map(([k, v]) => <li key={k}>• Qualidade {k}: {v} análise(s)</li>)}</ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Motor e versão</h3>
                  <ul className="text-sm space-y-1 break-all">{r.engines.map((e) => <li key={e.engine}>• {e.engine} — {e.count}</li>)}</ul>
                </div>
              </section>
            </>
          )}

          <section aria-labelledby="s-lim" className="rounded-xl bg-amber-50 text-amber-950 border border-amber-200 p-4">
            <h3 id="s-lim" className="font-semibold mb-2">Limitações metodológicas</h3>
            <ul className="list-disc list-inside text-xs space-y-1">
              {(r.limitations.length ? r.limitations : [DECISION_SUPPORT_DISCLAIMER]).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </section>
          <p className="text-xs text-muted-foreground flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />{DECISION_SUPPORT_DISCLAIMER}</p>
        </article>
      )}
    </Layout>
  );
}
