import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, Info } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Layout } from "@/components/Layout";
import { riskLevelColor } from "@/components/RiskBadge";
import { STATUS_LABEL } from "@/hooks/use-alerts";
import { api } from "@/lib/api";
import { DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import type { AlertStatus } from "@shared/schema";
import type { RiskLevel } from "@shared/risk-engine";

interface Insights {
  generatedAt: string;
  period: { from: string; to: string };
  analysesByWeek: { source: string; points: ({ week: string } & Record<RiskLevel, number>)[] };
  frequentFactors: { source: string; items: { name: string; count: number }[]; totalAnalyses: number };
  alertsByStatus: { source: string; items: { status: AlertStatus; n: number }[] };
  occurrencesByMonth: { source: string; points: { month: string; n: number }[] };
}

const LEVELS: { key: RiskLevel; label: string }[] = [
  { key: "baixo", label: "Baixo" }, { key: "moderado", label: "Moderado" }, { key: "alto", label: "Alto" }, { key: "crítico", label: "Crítico" },
];
const PRIMARY = "#0F5132";
const grid = <CartesianGrid vertical={false} stroke="hsl(var(--border))" />;

function Card({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border rounded-2xl p-5 shadow-sm">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground mb-4">Fonte: {source}</p>
      {children}
    </section>
  );
}

function Empty({ text = "Sem dados no período." }: { text?: string }) {
  return <p className="text-sm text-muted-foreground py-8 text-center">{text}</p>;
}

export default function CeresInsights() {
  const [from, setFrom] = useState(format(subDays(new Date(), 90), "yyyy-MM-dd"));
  const [to, setTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const { data, isLoading, error } = useQuery<Insights>({
    queryKey: ["/api/insights", from, to],
    queryFn: () => api("GET", `/api/insights?from=${from}&to=${to}`),
  });
  const input = "rounded-lg border border-input bg-background px-3 py-2 text-sm";
  const wk = (w: string) => format(new Date(`${w}T12:00:00`), "dd/MM", { locale: ptBR });

  return (
    <Layout>
      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold font-display flex items-center gap-2"><TrendingUp className="w-8 h-8 text-primary" aria-hidden />Inteligência Operacional</h1>
          <p className="text-muted-foreground mt-1">Indicadores agregados das análises, alertas e ocorrências da organização.</p>
        </div>
        <div className="flex gap-2 items-end">
          <div><label htmlFor="i-from" className="text-xs text-muted-foreground block mb-1">De</label><input id="i-from" type="date" className={input} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label htmlFor="i-to" className="text-xs text-muted-foreground block mb-1">Até</label><input id="i-to" type="date" className={input} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
      </header>

      {isLoading && <p className="text-muted-foreground">Carregando...</p>}
      {error && <p role="alert" className="text-red-700">{(error as Error).message}</p>}

      {data && (
        <div className="grid lg:grid-cols-2 gap-6">
          <Card title="Análises por semana e nível de risco" source={data.analysesByWeek.source}>
            {data.analysesByWeek.points.length === 0 ? <Empty /> : (
              <>
                <div className="h-60" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.analysesByWeek.points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      {grid}
                      <XAxis dataKey="week" tickFormatter={wk} tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip labelFormatter={(w) => `Semana de ${wk(String(w))}`} />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span className="text-foreground">{v}</span>} />
                      {LEVELS.map((l, i) => (
                        <Bar key={l.key} dataKey={l.key} name={l.label} stackId="s" fill={riskLevelColor(l.key)}
                          stroke="hsl(var(--card))" strokeWidth={2} radius={i === LEVELS.length - 1 ? [4, 4, 0, 0] : 0} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted-foreground">Ver em tabela</summary>
                  <table className="w-full text-xs mt-2"><thead><tr className="text-left text-muted-foreground"><th>Semana</th>{LEVELS.map((l) => <th key={l.key}>{l.label}</th>)}</tr></thead>
                    <tbody>{data.analysesByWeek.points.map((p) => <tr key={p.week} className="border-t"><td className="py-1">{wk(p.week)}</td>{LEVELS.map((l) => <td key={l.key}>{p[l.key]}</td>)}</tr>)}</tbody></table>
                </details>
              </>
            )}
          </Card>

          <Card title="Fatores que mais elevaram o índice" source={`${data.frequentFactors.source} (${data.frequentFactors.totalAnalyses} análises)`}>
            {data.frequentFactors.items.length === 0 ? <Empty /> : (
              <ul className="space-y-2">
                {data.frequentFactors.items.map((f) => {
                  const pct = Math.round((f.count / Math.max(data.frequentFactors.totalAnalyses, 1)) * 100);
                  return (
                    <li key={f.name} className="text-sm">
                      <div className="flex justify-between gap-2"><span>{f.name}</span><span className="tabular-nums text-muted-foreground">{f.count} ({pct}%)</span></div>
                      <div className="h-2 rounded-full bg-muted mt-1" aria-hidden><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: PRIMARY }} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Alertas por status" source={data.alertsByStatus.source}>
            {data.alertsByStatus.items.length === 0 ? <Empty /> : (
              <ul className="divide-y text-sm">
                {data.alertsByStatus.items.map((a) => <li key={a.status} className="flex justify-between py-2"><span>{STATUS_LABEL[a.status] ?? a.status}</span><span className="font-semibold tabular-nums">{a.n}</span></li>)}
              </ul>
            )}
          </Card>

          <Card title="Ocorrências históricas por mês" source={data.occurrencesByMonth.source}>
            {data.occurrencesByMonth.points.length === 0 ? <Empty text="Nenhuma ocorrência importada." /> : (
              <>
                <div className="h-56" aria-hidden>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.occurrencesByMonth.points} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      {grid}
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [v, "Ocorrências"]} />
                      <Bar dataKey="n" fill={PRIMARY} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <details className="mt-2 text-sm"><summary className="cursor-pointer text-muted-foreground">Ver em tabela</summary>
                  <table className="w-full text-xs mt-2"><thead><tr className="text-left text-muted-foreground"><th>Mês</th><th>Ocorrências</th></tr></thead>
                    <tbody>{data.occurrencesByMonth.points.map((p) => <tr key={p.month} className="border-t"><td className="py-1">{p.month}</td><td>{p.n}</td></tr>)}</tbody></table>
                </details>
              </>
            )}
          </Card>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-6 flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />{DECISION_SUPPORT_DISCLAIMER}</p>
    </Layout>
  );
}
