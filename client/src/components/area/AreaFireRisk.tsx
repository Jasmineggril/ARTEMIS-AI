/**
 * Série do risco de fogo oficial do INPE e índice de Haines numa propriedade.
 *
 * Observado = produto diário do INPE calculado sobre o polígono da área.
 * Previsto = GFS, com antecedência; linha tracejada para não confundir com
 * observação. Nenhum valor é inventado quando a fonte falha ou a área não tem
 * polígono válido. Haines usa níveis de pressão e não é risco de ignição.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Flame, Info } from "lucide-react";
import { apiGet } from "@/lib/api";
import { RF_CLASS_LABEL, RF_CLASS_LIMITS, rfClass, type RfClass } from "@shared/inpe-fire-risk";
import { HAINES_LABEL, type HainesClass, type HainesVariant } from "@shared/haines";

interface SeriesRow {
  day: string;
  mean: number | null;
  max: number | null;
  min: number | null;
  class: string | null;
  pixelsValid: number;
  pixelsTotal: number;
  method: string;
  sourceFile: string | null;
}
interface ForecastRow {
  day: string;
  lead: number;
  issuedOn: string | null;
  mean: number | null;
  max: number | null;
  class: string | null;
  method: string;
}
interface FireRiskResponse {
  from: string;
  to: string;
  series: SeriesRow[];
  forecast: ForecastRow[];
  method: { name: string; what: string; notThis: string; reference: string; source: string; limits: string[] };
}
interface HainesValue {
  at: string;
  result: { hi: number; A: number; B: number; stabilityDeltaC: number; dewpointDepressionC: number; cls: HainesClass; variant: HainesVariant } | null;
}
interface HainesResponse {
  status: "ok" | "indisponivel";
  source: string;
  nature: string;
  method: string;
  reason?: string;
  elevationM?: number;
  variant?: HainesVariant;
  values?: HainesValue[];
  note?: string;
}

interface ChartRow {
  day: string;
  observed: number | null;
  observedMax: number | null;
  observedClass: string | null;
  pixelsValid: number | null;
  pixelsTotal: number | null;
  forecast: number | null;
  forecastMax: number | null;
  forecastLead: number | null;
  forecastClass: string | null;
}

const GRID = "hsl(var(--border))";
const INK = "hsl(var(--muted-foreground))";
const OBS = "#2a78d6";
const PRE = "#eb6834";
const VARIANT_LABEL: Record<HainesVariant, string> = {
  baixa: "baixa (950/850 hPa)",
  media: "média (850/700 hPa)",
  alta: "alta (700/500 hPa)",
};

const num = (v: unknown, digits = 2) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: digits }));
const fmtDay = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? format(new Date(`${d}T12:00:00Z`), "dd/MM/yyyy") : d);
const fmtAt = (iso: string) => format(new Date(iso), "dd/MM HH:mm");
const classLabel = (c: string | null | undefined) => (c && c in RF_CLASS_LABEL ? RF_CLASS_LABEL[c as RfClass] : "—");

function mergeRows(series: SeriesRow[], forecast: ForecastRow[]): ChartRow[] {
  const rows = new Map<string, ChartRow>();
  for (const s of series) {
    rows.set(s.day, {
      day: s.day, observed: s.mean, observedMax: s.max, observedClass: s.class,
      pixelsValid: s.pixelsValid, pixelsTotal: s.pixelsTotal,
      forecast: null, forecastMax: null, forecastLead: null, forecastClass: null,
    });
  }
  for (const f of forecast) {
    const r = rows.get(f.day) ?? {
      day: f.day, observed: null, observedMax: null, observedClass: null,
      pixelsValid: null, pixelsTotal: null, forecast: null, forecastMax: null,
      forecastLead: null, forecastClass: null,
    };
    r.forecast = f.mean;
    r.forecastMax = f.max;
    r.forecastLead = f.lead;
    r.forecastClass = f.class;
    rows.set(f.day, r);
  }
  return Array.from(rows.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function HainesCard({ areaId }: { areaId: number }) {
  const { data, error, isLoading } = useQuery<HainesResponse>({
    queryKey: [`/api/areas/${areaId}/haines`],
    queryFn: () => apiGet<HainesResponse>(`/api/areas/${areaId}/haines`),
    enabled: Number.isInteger(areaId) && areaId > 0,
    retry: 1,
  });

  return (
    <section className="rounded-xl border bg-card p-3 mt-3" data-testid="haines-card" aria-labelledby="haines-t">
      <h3 id="haines-t" className="text-sm font-medium flex items-center gap-1"><Info className="h-4 w-4 text-primary" aria-hidden />Índice de Haines — potencial de crescimento do fogo</h3>
      <p className="text-xs text-muted-foreground mt-0.5">Calculado com temperatura e ponto de orvalho em níveis de pressão (modelo numérico), nunca com valores de superfície. Não é risco de ignição.</p>
      {isLoading ? <p className="text-sm mt-2">Consultando níveis de pressão...</p>
        : error || !data ? <p role="status" className="text-sm text-amber-800 dark:text-amber-200 mt-2">{(error as Error)?.message ?? "Índice indisponível no momento."}</p>
          : data.status !== "ok" ? <p role="status" className="text-sm text-amber-800 dark:text-amber-200 mt-2">Indisponível: {data.reason}</p>
            : (
              <div className="mt-2 space-y-2">
                <p className="text-sm">Variante <strong>{VARIANT_LABEL[data.variant ?? "media"]}</strong> · elevação {num(data.elevationM, 0)} m · fonte: {data.source}</p>
                <div className="grid sm:grid-cols-2 gap-2">
                  {(data.values ?? []).map((v) => (
                    <div key={v.at} className="rounded-lg border p-2">
                      <p className="text-xs text-muted-foreground">{fmtAt(v.at)} UTC</p>
                      {v.result ? (
                        <>
                          <p className="text-lg font-bold tabular-nums">{v.result.hi}/6 <span className="text-sm font-normal">{HAINES_LABEL[v.result.cls]}</span></p>
                          <p className="text-[11px] text-muted-foreground">A={v.result.A} (ΔT {num(v.result.stabilityDeltaC, 1)} °C) · B={v.result.B} (T−Td {num(v.result.dewpointDepressionC, 1)} °C)</p>
                        </>
                      ) : <p className="text-xs text-muted-foreground">Sem níveis suficientes neste horário.</p>}
                    </div>
                  ))}
                </div>
                {data.note && <p className="text-xs text-muted-foreground">{data.note}</p>}
              </div>
            )}
    </section>
  );
}

/** Bloco completo da área: série observada/prevista + Haines. */
export function AreaFireRisk({ areaId }: { areaId: number }) {
  const [table, setTable] = useState(false);
  const { data, error, isLoading } = useQuery<FireRiskResponse>({
    queryKey: [`/api/areas/${areaId}/fire-risk`],
    queryFn: () => apiGet<FireRiskResponse>(`/api/areas/${areaId}/fire-risk`),
    enabled: Number.isInteger(areaId) && areaId > 0,
    retry: 1,
  });

  if (!Number.isInteger(areaId) || areaId <= 0) return null;
  if (isLoading) return <section className="rounded-2xl border bg-card p-4 mt-4" aria-busy="true"><div className="h-40 animate-pulse rounded-xl bg-muted/50" /></section>;
  if (error || !data) {
    return <section className="rounded-2xl border bg-card p-4 mt-4" role="status">
      <p className="text-sm text-amber-800 dark:text-amber-200">Risco de fogo oficial indisponível: {(error as Error)?.message ?? "sem resposta da API."}</p>
    </section>;
  }

  const rows = mergeRows(data.series, data.forecast);
  const latest = [...data.series].reverse().find((s) => s.mean != null);
  const thresholds: Array<[number, string]> = [
    [RF_CLASS_LIMITS.minimo, "Mínimo 0,15"],
    [RF_CLASS_LIMITS.baixo, "Baixo 0,40"],
    [RF_CLASS_LIMITS.medio, "Médio 0,70"],
    [RF_CLASS_LIMITS.alto, "Alto 0,95"],
  ];

  return (
    <section className="rounded-2xl border bg-card p-4 mt-4 space-y-3" data-testid="area-fire-risk" aria-labelledby="afr-t">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="afr-t" className="font-semibold flex items-center gap-2"><Flame className="h-5 w-5 text-primary" aria-hidden />Risco de fogo oficial — INPE <span className="text-xs font-normal text-muted-foreground">(índice meteorológico 0–1)</span></h2>
        <button type="button" className="text-xs underline" onClick={() => setTable(!table)}>{table ? "Ver gráfico" : "Ver dados em tabela"}</button>
      </div>
      <p className="text-xs text-muted-foreground">{data.method.what} Período: {fmtDay(data.from)} a {fmtDay(data.to)}. {data.method.source}. {data.method.notThis}</p>
      {latest && (() => {
        // INPE publishes day D in the early hours of D+1: more than 2 days old means the sync is behind
        const ageDays = Math.floor((Date.now() - Date.parse(latest.day + "T12:00:00Z")) / 86_400_000);
        return ageDays > 2 ? <p role="status" data-testid="area-fire-risk-stale" className="text-xs rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Dado desatualizado: o último dia disponível é de {ageDays} dias atrás. A sincronização com o INPE pode estar parada; o valor abaixo não descreve a condição de hoje.</p> : null;
      })()}
      {latest && (
        <p className="text-sm">Último observado ({fmtDay(latest.day)}): <strong className="tabular-nums">{num(latest.mean)}</strong> — <strong>{classLabel(latest.class)}</strong>
          {" · "}máx. {num(latest.max)} · {latest.pixelsValid.toLocaleString("pt-BR")}/{latest.pixelsTotal.toLocaleString("pt-BR")} pixels válidos</p>
      )}
      {rows.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">Ainda não há valores calculados sobre esta área no período. A sincronização do produto oficial precisa rodar.</p>
      ) : table ? (
        <div className="overflow-x-auto max-h-80 rounded-xl border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted"><tr className="text-left">
              {["Dia", "Observado", "Máx.", "Classe", "Pixels", "Previsto", "Lead", "Classe prevista"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.day} className="border-t">
                <td className="px-2 py-1 whitespace-nowrap">{fmtDay(r.day)}</td>
                <td className="px-2">{num(r.observed)}</td><td className="px-2">{num(r.observedMax)}</td>
                <td className="px-2">{classLabel(r.observedClass)}</td>
                <td className="px-2">{r.pixelsValid == null ? "—" : `${r.pixelsValid}/${r.pixelsTotal}`}</td>
                <td className="px-2">{num(r.forecast)}</td><td className="px-2">{r.forecastLead == null ? "—" : `+${r.forecastLead} d`}</td>
                <td className="px-2">{classLabel(r.forecastClass)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ height: 230 }} data-testid="fire-risk-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 6, right: 10, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: INK }} minTickGap={22} stroke={GRID} />
              <YAxis domain={[0, 1]} tickFormatter={(v: number) => v.toFixed(2)} tick={{ fontSize: 11, fill: INK }} width={42} stroke={GRID} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                labelFormatter={(d: string) => `Dia ${fmtDay(String(d))}`}
                formatter={(v: number, name: string) => [`${num(v)} — ${classLabel(rfClass(v))}`, name]} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {thresholds.map(([y, label]) => (
                <ReferenceLine key={label} y={y} stroke={INK} strokeDasharray="2 4" strokeOpacity={0.5}
                  label={{ value: label, position: "insideTopLeft", fill: INK, fontSize: 9 }} />
              ))}
              <Line type="monotone" dataKey="observed" name="Observado (INPE)" stroke={OBS} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="forecast" name="Previsto (INPE)" stroke={PRE} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-muted-foreground">Linha contínua: observado calculado sobre a área. Tracejada: previsão GFS. Linhas finas: limites oficiais das classes.</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{data.method.reference} {data.method.limits.join(" ")}</p>
      <HainesCard areaId={areaId} />
    </section>
  );
}
