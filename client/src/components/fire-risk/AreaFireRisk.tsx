/**
 * Property page: official INPE fire risk over the polygon (daily observed series + forecast)
 * and the Haines index (pressure-level model data, or "indisponível" with the reason).
 * Every value states its nature, method, source and date; nothing is shown as a probability.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { Flame, Wind } from "lucide-react";
import { api } from "@/lib/api";
import { RF_CLASSES, rfLabel } from "@/components/map/FireRiskLayer";

interface Pt { day: string; mean: number | null; max: number | null; class: string | null; method: string; pixelsValid?: number; pixelsTotal?: number; lead?: number; issuedOn?: string | null }
interface Resp { series: Pt[]; forecast: Pt[]; method: { name: string; what: string; notThis: string; reference: string; source: string; limits: string[] } }
interface Haines { status: "ok" | "indisponivel"; reason?: string; source: string; method: string; variant?: string; elevationM?: number; note?: string;
  values?: { at: string; result: { hi: number; cls: string; stabilityDeltaC: number; dewpointDepressionC: number } | null }[] }

const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const n2 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const HAINES_LABEL: Record<string, string> = { muito_baixo: "Muito baixo", baixo: "Baixo", moderado: "Moderado", alto: "Alto" };
const VARIANT: Record<string, string> = { baixa: "baixa (950–850 hPa)", media: "média (850–700 hPa)", alta: "alta (700–500 hPa)" };

export function AreaFireRisk({ areaId }: { areaId: number }) {
  const { data, isLoading } = useQuery<Resp>({ queryKey: [`/api/areas/${areaId}/fire-risk`], queryFn: () => api("GET", `/api/areas/${areaId}/fire-risk`) });
  const [table, setTable] = useState(false);
  if (isLoading) return null;
  const series = data?.series ?? [], forecast = data?.forecast ?? [];
  const lastObs = series.at(-1);
  const fc = forecast.filter((f) => !lastObs || f.day > lastObs.day);
  // one line, two styles: observed (solid) and forecast (dashed), joined at the last observed day
  const rows = [
    ...series.map((p) => ({ day: p.day, obs: p.mean, fc: p.day === lastObs?.day && fc.length ? p.mean : null, max: p.max, kind: "Observado" })),
    ...fc.map((p) => ({ day: p.day, obs: null, fc: p.mean, max: p.max, kind: `Previsão (T${p.lead})` })),
  ];
  return (
    <section className="bg-card border rounded-2xl p-5 space-y-3" aria-labelledby="rf-title" data-testid="area-fire-risk">
      <h2 id="rf-title" className="font-semibold text-lg flex items-center gap-2"><Flame className="w-5 h-5 text-primary" aria-hidden />Risco de fogo oficial (INPE)</h2>
      {!series.length && !fc.length ? (
        <p className="text-sm text-muted-foreground">Ainda não há valores do índice oficial para esta área. Eles aparecem após a próxima sincronização com o INPE (a cada 6 horas).</p>
      ) : (<>
        {lastObs && (() => {
          // INPE publishes day D in the early hours of D+1: more than 2 days old means the sync is behind
          const ageDays = Math.floor((Date.now() - Date.parse(lastObs.day + "T12:00:00Z")) / 86_400_000);
          return ageDays > 2 ? <p role="status" className="text-xs rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            Dado desatualizado: o último dia disponível é de {ageDays} dias atrás. A sincronização com o INPE pode estar parada; o valor abaixo não descreve a condição de hoje.</p> : null;
        })()}
        {lastObs && <p className="text-sm">Último dia observado, {fmt(lastObs.day)}: <b>{rfLabel(lastObs.mean)}</b> (média {n2(lastObs.mean)}, pior pixel {n2(lastObs.max)} na escala 0–1)
          {fc.length > 0 && <> · previsão: {fc.map((f) => `${fmt(f.day)} ${rfLabel(f.mean)}`).join(", ")}</>}.</p>}
        <div className="h-56" role="img" aria-label={`Série diária do risco de fogo oficial na área, ${series.length} dias observados e ${fc.length} previstos`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 56, bottom: 0, left: -16 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.5} vertical={false} />
              <XAxis dataKey="day" tickFormatter={fmt} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--border))" minTickGap={24} />
              <YAxis domain={[0, 1]} ticks={[0, 0.15, 0.4, 0.7, 0.95, 1]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--border))" />
              {RF_CLASSES.slice(0, 4).map((c) => (
                <ReferenceLine key={c.key} y={c.upTo} stroke="hsl(var(--muted-foreground))" strokeOpacity={0.35} strokeDasharray="2 3"
                  label={{ value: `${RF_CLASSES[RF_CLASSES.indexOf(c) + 1].label} ▲`, position: "right", fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />))}
              <Tooltip formatter={(v: number, k: string) => [`${n2(v)} — ${rfLabel(v)}`, k === "obs" ? "Observado (média)" : "Previsão (média)"]} labelFormatter={(d: string) => fmt(d)} />
              <Line type="monotone" dataKey="obs" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="fc" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-xs text-muted-foreground flex flex-wrap gap-x-4">
          <span><span aria-hidden className="inline-block w-5 border-t-2 border-primary align-middle mr-1" />Observado</span>
          {fc.length > 0 && <span><span aria-hidden className="inline-block w-5 border-t-2 border-dashed border-primary align-middle mr-1" />Previsão do INPE</span>}
          <span>Linhas pontilhadas: limites oficiais das classes.</span>
        </p>
        <button type="button" className="text-xs underline" onClick={() => setTable(!table)} aria-expanded={table}>{table ? "Ocultar tabela" : "Ver valores em tabela"}</button>
        {table && (
          <div className="overflow-x-auto"><table className="text-xs w-full">
            <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">Dia</th><th className="pr-2">Tipo</th><th className="pr-2">Média</th><th className="pr-2">Máximo</th><th className="pr-2">Classe</th><th>Método</th></tr></thead>
            <tbody>{[...series.map((p) => ({ ...p, kind: "Observado" })), ...fc.map((p) => ({ ...p, kind: `Previsão T${p.lead}` }))].map((p) => (
              <tr key={p.kind + p.day} className="border-t"><td className="py-1 pr-2">{fmt(p.day)}</td><td className="pr-2">{p.kind}</td><td className="pr-2">{n2(p.mean)}</td><td className="pr-2">{n2(p.max)}</td><td className="pr-2">{rfLabel(p.mean)}</td>
                <td>{p.method}{p.pixelsValid != null ? ` (${p.pixelsValid}/${p.pixelsTotal} pixels)` : ""}</td></tr>))}</tbody>
          </table></div>)}
      </>)}
      {data?.method && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">O que é este índice</summary>
          <p className="mt-1">{data.method.name}. {data.method.what} <b>{data.method.notThis}</b></p>
          <ul className="list-disc pl-4 mt-1">{data.method.limits.map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="mt-1">{data.method.source}. Referência: {data.method.reference}</p>
        </details>)}
      <HainesCard areaId={areaId} />
    </section>
  );
}

function HainesCard({ areaId }: { areaId: number }) {
  const { data } = useQuery<Haines>({ queryKey: [`/api/areas/${areaId}/haines`], queryFn: () => api("GET", `/api/areas/${areaId}/haines`), staleTime: 3 * 3_600_000 });
  if (!data) return null;
  return (
    <div className="border-t pt-3 text-sm" data-testid="area-haines">
      <h3 className="font-semibold flex items-center gap-2"><Wind className="w-4 h-4" aria-hidden />Índice de Haines (atmosfera)</h3>
      {data.status !== "ok" ? (
        <p className="text-muted-foreground mt-1"><b>Indisponível.</b> {data.reason} O índice exige temperatura e umidade em níveis de pressão (altitude); não é calculado com dados de superfície.</p>
      ) : (<>
        <ul className="mt-1">{data.values!.filter((v) => v.result).map((v) => (
          <li key={v.at}>{fmt(v.at.slice(0, 10))} às 15 h (18 UTC): <b>{v.result!.hi} — {HAINES_LABEL[v.result!.cls]}</b>
            <span className="text-muted-foreground"> (estabilidade ΔT {v.result!.stabilityDeltaC.toLocaleString("pt-BR")} °C; secura T−Td {v.result!.dewpointDepressionC.toLocaleString("pt-BR")} °C)</span></li>))}</ul>
        <p className="text-xs text-muted-foreground mt-1">Escala 2–6, variante {VARIANT[data.variant!]} pela altitude ({Math.round(data.elevationM!)} m). {data.note} Fonte: {data.source}. Método: {data.method}.</p>
      </>)}
    </div>
  );
}
