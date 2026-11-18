/**
 * Operations and evidence (platform admins): availability, performance, syncs,
 * real use, user feedback, SUS and retrospective validation of analyses/alerts.
 * Every figure comes from GET /api/admin/operations (measured by the system).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { Activity, Download, ShieldAlert, Gauge, RefreshCw, Users, MessageSquare, FlaskConical, ArrowLeft } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useAuthStatus } from "@/hooks/use-auth";
import { api } from "@/lib/api";

const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : "—");
const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR") : "—");
const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR")} %`);

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-2xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold tabular-nums">{value}</p>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div>;
}

export default function AdminOperations() {
  const { data: me } = useAuthStatus();
  const [days, setDays] = useState(30);
  const qc = useQueryClient();
  const isAdmin = me?.platformRole === "platform_admin";
  const { data: r, isLoading, error, refetch, isFetching } = useQuery<any>({
    queryKey: ["/api/admin/operations", days], queryFn: () => api("GET", `/api/admin/operations?days=${days}`), enabled: isAdmin,
  });
  const { data: feedback = [] } = useQuery<any[]>({ queryKey: ["/api/admin/feedback"], queryFn: () => api("GET", "/api/admin/feedback"), enabled: isAdmin });
  const setStatus = useMutation({
    mutationFn: (v: { id: number; status: string }) => api("PATCH", `/api/admin/feedback/${v.id}`, { status: v.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/feedback"] }),
  });

  if (me && !isAdmin) return <Layout><p className="text-sm flex items-center gap-2"><ShieldAlert className="w-4 h-4" aria-hidden />Restrito à administração da plataforma.</p></Layout>;

  return (
    <Layout>
      <Link href="/admin" className="text-sm underline inline-flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" aria-hidden />Painel Administrativo</Link>
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-3xl font-bold font-display flex items-center gap-2"><Activity className="w-8 h-8 text-primary" aria-hidden />Operação e evidências</h1>
          <p className="text-sm text-muted-foreground mt-1">Medido pelo próprio sistema em operação. Base para o dossiê de maturidade (TRL) — nenhum valor é estimado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="days" className="text-sm">Período</label>
          <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm">
            <option value={1}>últimas 24 h</option><option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option><option value={365}>12 meses</option>
          </select>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} aria-hidden />Atualizar</Button>
          <Button size="sm" asChild><a href={`/api/admin/evidence.json?days=${days}`} download data-testid="button-evidence"><Download className="w-4 h-4 mr-1" aria-hidden />Exportar evidências (JSON)</a></Button>
        </div>
      </header>

      {isLoading && <div className="h-64 rounded-2xl border bg-card animate-pulse" aria-busy="true" />}
      {error && <p role="alert" className="text-sm text-red-700">Não foi possível carregar: {(error as Error).message}</p>}
      {r && (
        <div className="space-y-6">
          <section aria-labelledby="av-t">
            <h2 id="av-t" className="font-semibold mb-2 flex items-center gap-2"><Gauge className="w-4 h-4" aria-hidden />Disponibilidade e desempenho</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Disponibilidade medida" value={pct(r.availability.availabilityPct)} sub={r.availability.measuredSince ? `desde ${when(r.availability.measuredSince)} · ${n(r.availability.healthyMinutes)}/${n(r.availability.expectedMinutes)} min` : "sem medições no período"} />
              <Kpi label="Latência da API (p95)" value={r.api.p95Ms != null ? `${n(r.api.p95Ms)} ms` : "—"} sub={`mediana ${r.api.p50Ms != null ? `${n(r.api.p50Ms)} ms` : "—"} · pior minuto ${r.api.worstMinuteP95Ms != null ? `${n(r.api.worstMinuteP95Ms)} ms` : "—"}`} />
              <Kpi label="Requisições à API" value={n(r.api.requests)} sub={`erros 5xx: ${n(r.api.errors5xx)} (${pct(r.api.errorRate5xxPct)})`} />
              <Kpi label="Dados desatualizados" value={`${n(r.availability.minutesInpeStale)} min`} sub={`INPE · Sisfogo: ${n(r.availability.minutesSisfogoStale)} min`} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{r.availability.note}</p>
            {r.availability.gaps.length > 0 && <details className="text-sm mt-2"><summary className="cursor-pointer">Interrupções detectadas ({r.availability.gaps.length})</summary>
              <ul className="text-xs mt-1 space-y-0.5">{r.availability.gaps.map((g: any, i: number) => <li key={i}>{when(g.from)} → {when(g.to)} · {g.minutes} min</li>)}</ul></details>}
          </section>

          <section aria-labelledby="sy-t" className="rounded-2xl border bg-card p-4">
            <h2 id="sy-t" className="font-semibold mb-2">Sincronizações no período</h2>
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Fonte</th><th>Execuções</th><th>Sucesso</th><th>Falhas</th><th>Inseridos</th><th>Último sucesso</th></tr></thead>
              <tbody>{r.syncs.map((s: any) => <tr key={s.key} className="border-t"><td className="py-1">{s.name}</td><td>{n(s.runs)}</td><td>{s.runs ? pct(Math.round((s.ok / s.runs) * 1000) / 10) : "—"}</td><td>{n(s.failed)}</td><td>{n(s.inserted)}</td><td>{when(s.lastSuccessAt)}</td></tr>)}</tbody></table>
          </section>

          <section aria-labelledby="us-t">
            <h2 id="us-t" className="font-semibold mb-2 flex items-center gap-2"><Users className="w-4 h-4" aria-hidden />Uso real</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Usuários ativos" value={n(r.usage.activeUsers)} sub={`${n(r.usage.newUsers)} novos · ${n(r.usage.activeOrganizations)} organizações ativas`} />
              <Kpi label="Análises de risco" value={n(r.usage.analyses)} sub={r.usage.medianAnalysisMs != null ? `tempo mediano ${Math.round(r.usage.medianAnalysisMs / 1000)} s (${n(r.usage.timedAnalyses)} medidas)` : "tempo ainda não medido"} />
              <Kpi label="Alertas emitidos" value={n(r.usage.alerts)} sub={`${n(r.usage.hotspotAlerts)} por foco detectado · ${n(r.usage.alertsClosed)} encerrados`} />
              <Kpi label="Propriedades" value={n(r.usage.newAreas)} sub={`novas no período · ${n(r.usage.areasWithBoundary)} com polígono (total)`} />
            </div>
          </section>

          <section aria-labelledby="oc-t" className="rounded-2xl border bg-card p-4" data-testid="section-outcomes">
            <h2 id="oc-t" className="font-semibold flex items-center gap-2"><FlaskConical className="w-4 h-4" aria-hidden />Resultados verificáveis (validação retrospectiva)</h2>
            <p className="text-xs text-muted-foreground mt-1">Para cada análise com janela encerrada: houve foco do INPE ou ROI do Sisfogo a até {r.outcomes.method.radiusKm} km nos {r.outcomes.method.windowDays} dias seguintes?</p>
            <div className="grid lg:grid-cols-2 gap-4 mt-3">
              {[["Todas as análises", r.outcomes.analyses.byLevel], ["Sem foco próximo no momento da análise", r.outcomes.analyses.withoutNearbyHotspotAtAnalysis]].map(([t, rows]: any) => (
                <div key={t}><p className="text-sm font-medium">{t}</p>
                  <table className="w-full text-sm mt-1"><thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">Nível</th><th>n</th><th>Com foco depois</th><th>Com ROI depois</th></tr></thead>
                    <tbody>{rows.map((x: any) => <tr key={x.level} className="border-t"><td className="py-1 capitalize">{x.level}</td><td>{x.n}</td><td>{pct(x.hotspotRatePct)}</td><td>{pct(x.roiRatePct)}</td></tr>)}</tbody></table></div>))}
            </div>
            <p className="text-sm mt-3">Alertas: {n(r.outcomes.alerts.total)} ({n(r.outcomes.alerts.hotspotAlerts)} por foco; {n(r.outcomes.alerts.hotspotAlertsMatchedBySisfogo)} com ROI oficial depois) ·
              avaliados por especialistas: {n(r.outcomes.alerts.evaluated)} — pertinentes {pct(r.outcomes.alerts.pertinentPct)} (meta da Prova de Valor: ≥ 80 %).</p>
            <ul className="text-[11px] text-muted-foreground mt-2 list-disc list-inside">{r.outcomes.limits.map((l: string) => <li key={l}>{l}</li>)}</ul>
          </section>

          {r.proofOfValue && (() => {
            const pv = r.proofOfValue, st: Record<string, string> = { amostra_insuficiente: "amostra insuficiente — sem conclusão", meta_atingida: "meta atingida", meta_nao_atingida: "meta não atingida" };
            const mins = (ms: number | null) => (ms == null ? "—" : `${(ms / 60000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} min`);
            return (
              <section aria-labelledby="pv-t" className="rounded-2xl border bg-card p-4" data-testid="ops-pov">
                <h2 id="pv-t" className="font-semibold">Indicadores da Prova de Valor</h2>
                <p className="text-sm mt-1"><strong>Redução do tempo de análise (meta ≥ {pv.targets.timeReductionPct} %):</strong> {pv.timeReduction.reductionPct == null ? "—" : `${pv.timeReduction.reductionPct} %`} ·
                  manual {mins(pv.timeReduction.baselineMedianMs)} (n = {pv.timeReduction.baselineN}) × plataforma {mins(pv.timeReduction.platformMedianMs)} (n = {pv.timeReduction.platformN}; {pv.timeReduction.platformExcludedFast} abaixo de 10 s excluídas) — <em>{st[pv.timeReduction.status]}</em></p>
                <p className="text-sm"><strong>Alertas e recomendações validados (meta ≥ {pv.targets.validatedPct} %):</strong> {pv.validation.combinedPct == null ? "—" : `${pv.validation.combinedPct} %`} ·
                  alertas {pv.validation.alerts.pertinent}/{pv.validation.alerts.evaluated} · recomendações {pv.validation.recommendations.pertinent}/{pv.validation.recommendations.evaluated} — <em>{st[pv.validation.status]}</em></p>
                <p className="text-xs text-muted-foreground mt-1">Linha de base registrada em <a className="underline" href="/avaliacao/linha-de-base">Avaliação → Linha de base</a>. Mínimo para conclusão: {pv.targets.minTimings} medições de cada tipo e {pv.targets.minVerdicts} avaliações. "Parcialmente pertinente" não conta como validado.</p>
              </section>
            );
          })()}

          {r.notifications && (
            <section aria-labelledby="nt-t" className="rounded-2xl border bg-card p-4" data-testid="ops-notifications">
              <h2 id="nt-t" className="font-semibold">Notificações por e-mail</h2>
              <p className="text-sm mt-1">Enviadas {n(r.notifications.enviado)} · aguardando {n(r.notifications.pendente)} · falharam {n(r.notifications.falha)} · não enviadas por falta de SMTP {n(r.notifications.bloqueado_configuracao)}</p>
              <p className="text-xs text-muted-foreground">{r.notifications.smtpConfigured ? "SMTP configurado." : "SMTP não configurado neste servidor: nenhum e-mail é enviado (registrado, não simulado)."}</p>
            </section>
          )}

          <section aria-labelledby="fb-t" className="rounded-2xl border bg-card p-4">
            <h2 id="fb-t" className="font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4" aria-hidden />Avaliação dos usuários</h2>
            <p className="text-sm mt-1">SUS: {r.sus.n ? <><strong>{r.sus.mean}</strong> de média ({r.sus.n} resposta(s), mediana {r.sus.median})</> : "nenhuma resposta ainda"} · {r.sus.note}</p>
            <p className="text-sm">Mensagens no período: {n(r.feedback.total)} ({n(r.feedback.problems)} problemas, {n(r.feedback.open)} em aberto) · nota média {r.feedback.avgRating ?? "—"}</p>
            {feedback.length > 0 && (
              <div className="overflow-x-auto mt-3"><table className="w-full text-xs"><thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">Data</th><th className="pr-2">Tipo</th><th className="pr-2">Tela</th><th className="pr-2">Usuário</th><th className="pr-2">Mensagem</th><th>Situação</th></tr></thead>
                <tbody>{feedback.slice(0, 50).map((f) => (
                  <tr key={f.id} className="border-t align-top"><td className="py-1 pr-2 whitespace-nowrap">{when(f.createdAt)}</td><td className="pr-2">{f.category}{f.rating ? ` · ${f.rating}★` : ""}</td><td className="pr-2">{f.page}</td><td className="pr-2 break-all">{f.userEmail ?? "—"}</td>
                    <td className="pr-2 max-w-[360px]">{f.message}</td>
                    <td><label className="sr-only" htmlFor={`fs-${f.id}`}>Situação</label>
                      <select id={`fs-${f.id}`} value={f.status} onChange={(e) => setStatus.mutate({ id: f.id, status: e.target.value })} className="rounded border px-1 py-0.5">
                        <option value="novo">novo</option><option value="em_analise">em análise</option><option value="resolvido">resolvido</option><option value="arquivado">arquivado</option></select></td></tr>))}</tbody></table></div>
            )}
          </section>
          <p className="text-xs text-muted-foreground">Relatório gerado em {when(r.generatedAt)}. Período: {when(r.period.from)} a {when(r.period.to)}.</p>
        </div>
      )}
    </Layout>
  );
}
