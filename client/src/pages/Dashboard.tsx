import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MapPin, AlertTriangle, Database, Flame, CheckCircle2, Info, Upload, Plus } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Layout } from "@/components/Layout";
import { RiskBadge } from "@/components/RiskBadge";
import { Button } from "@/components/ui/button";
import { useAuthStatus } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import type { RiskLevel } from "@shared/risk-engine";

interface Summary {
  generatedAt: string;
  areas: { total: number; analyzed: number; notAnalyzed: number; byLatestLevel: Record<RiskLevel, number>; source: string; lastUpdate: string | null };
  alerts: { active: number; resolved: number; discarded: number; source: string };
  occurrences: { total: number; source: string; lastUpdate: string | null };
  riskTrend: { period: string; points: { date: string; avg: number; max: number; n: number }[]; source: string };
}
interface Connector { key: string; name: string; status: string; note: string; lastSuccessAt?: string | null }

const fmt = (d: string | null) => (d ? format(new Date(d), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "sem registros");

function Tile({ icon, title, value, source, updated }: { icon: React.ReactNode; title: string; value: string | number; source: string; updated?: string }) {
  return (
    <div className="bg-card border rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">{icon}{title}</div>
      <p className="text-3xl font-bold mt-1 tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-2">Fonte: {source}</p>
      {updated && <p className="text-[11px] text-muted-foreground">Última atualização: {updated}</p>}
    </div>
  );
}

export default function Dashboard() {
  const { data: user } = useAuthStatus();
  const { data: s, isLoading, error } = useQuery<Summary>({ queryKey: ["/api/dashboard/summary"], queryFn: () => api("GET", "/api/dashboard/summary") });
  const { data: connectors = [] } = useQuery<Connector[]>({ queryKey: ["/api/connectors"], queryFn: () => api("GET", "/api/connectors") });

  return (
    <Layout>
      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display">Visão Geral</h1>
          <p className="text-muted-foreground mt-1">
            {user?.organization?.name} · gerado em {s ? fmt(s.generatedAt) : "—"} · dados armazenados da organização (não é monitoramento em tempo real)
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline"><Link href="/data-import"><Upload className="w-4 h-4 mr-1" aria-hidden />Importar ocorrências</Link></Button>
          <Button asChild><Link href="/risk-analysis"><Flame className="w-4 h-4 mr-1" aria-hidden />Nova análise</Link></Button>
        </div>
      </header>

      {isLoading && <p className="text-muted-foreground">Carregando indicadores...</p>}
      {error && <p role="alert" className="text-red-700">Não foi possível carregar os indicadores: {(error as Error).message}</p>}

      {s && s.areas.total === 0 && (
        <div className="rounded-2xl border border-dashed p-8 text-center mb-8">
          <h2 className="font-semibold text-lg">Comece cadastrando uma área</h2>
          <p className="text-sm text-muted-foreground mt-1">Os indicadores são calculados apenas a partir das áreas, análises e ocorrências da sua organização.</p>
          <Button asChild className="mt-4"><Link href="/areas"><Plus className="w-4 h-4 mr-1" aria-hidden />Cadastrar área</Link></Button>
        </div>
      )}

      {s && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8" data-tour="dashboard-summary">
            <Tile icon={<MapPin className="w-4 h-4" aria-hidden />} title="Áreas monitoradas" value={s.areas.total} source="cadastro da organização" />
            <Tile icon={<Flame className="w-4 h-4" aria-hidden />} title="Áreas analisadas" value={`${s.areas.analyzed}/${s.areas.total}`} source="análises armazenadas" updated={fmt(s.areas.lastUpdate)} />
            <Tile icon={<AlertTriangle className="w-4 h-4" aria-hidden />} title="Alertas abertos" value={s.alerts.active} source={`${s.alerts.resolved} resolvido(s), ${s.alerts.discarded} descartado(s)`} />
            <Tile icon={<Database className="w-4 h-4" aria-hidden />} title="Ocorrências históricas" value={s.occurrences.total.toLocaleString("pt-BR")} source="arquivos importados" updated={fmt(s.occurrences.lastUpdate)} />
          </div>

          <div className="grid lg:grid-cols-3 gap-6 mb-8">
            <section className="bg-card border rounded-2xl p-6 shadow-sm" aria-labelledby="dist">
              <h2 id="dist" className="font-semibold mb-1">Áreas por nível de risco</h2>
              <p className="text-xs text-muted-foreground mb-4">Última análise de cada área.</p>
              <ul className="space-y-3">
                {(["crítico", "alto", "moderado", "baixo"] as RiskLevel[]).map((l) => (
                  <li key={l} className="flex items-center justify-between">
                    <RiskBadge level={l} showIcon size="sm" />
                    <span className="font-semibold tabular-nums">{s.areas.byLatestLevel[l] ?? 0}</span>
                  </li>
                ))}
                <li className="flex items-center justify-between text-sm text-muted-foreground border-t pt-3">
                  <span>Sem análise</span><span className="font-semibold tabular-nums">{s.areas.notAnalyzed}</span>
                </li>
              </ul>
            </section>

            <section className="lg:col-span-2 bg-card border rounded-2xl p-6 shadow-sm" aria-labelledby="trend">
              <h2 id="trend" className="font-semibold">Evolução do índice médio de risco</h2>
              <p className="text-xs text-muted-foreground mb-4">{s.riskTrend.source} · {s.riskTrend.period}</p>
              {s.riskTrend.points.length === 0 ? (
                <p className="text-sm text-muted-foreground py-10 text-center">Nenhuma análise no período.</p>
              ) : (
                <>
                  <div className="h-56" aria-hidden>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={s.riskTrend.points} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => format(new Date(`${d}T12:00:00`), "dd/MM")} />
                        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(v: number, k) => [`${v}/100`, k === "avg" ? "Média" : k]}
                          labelFormatter={(d) => format(new Date(`${d}T12:00:00`), "dd/MM/yyyy")}
                        />
                        <Line type="monotone" dataKey="avg" stroke="#0F5132" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Ver dados em tabela</summary>
                    <table className="w-full text-xs mt-2">
                      <thead><tr className="text-left text-muted-foreground"><th>Data</th><th>Média</th><th>Máximo</th><th>Análises</th></tr></thead>
                      <tbody>{s.riskTrend.points.map((p) => <tr key={p.date} className="border-t"><td className="py-1">{p.date}</td><td>{p.avg}</td><td>{p.max}</td><td>{p.n}</td></tr>)}</tbody>
                    </table>
                  </details>
                </>
              )}
            </section>
          </div>
        </>
      )}

      <section className="bg-card border rounded-2xl p-6 shadow-sm mb-6" aria-labelledby="src">
        <h2 id="src" className="font-semibold mb-3">Situação das fontes de dados</h2>
        <ul className="divide-y text-sm">
          {connectors.map((c) => (
            <li key={c.key} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground sm:text-right">
                {c.status.startsWith("implementado") ? <CheckCircle2 className="inline w-3.5 h-3.5 mr-1 text-green-700" aria-hidden /> : <Info className="inline w-3.5 h-3.5 mr-1" aria-hidden />}
                <strong>{c.status}</strong> — {c.note}{c.lastSuccessAt && <> · última sincronização {new Date(c.lastSuccessAt).toLocaleString("pt-BR")}</>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />{DECISION_SUPPORT_DISCLAIMER}</p>
    </Layout>
  );
}
