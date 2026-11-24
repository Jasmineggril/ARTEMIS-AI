import { useState } from "react";
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

/** Categorical slots in fixed order (validated: CVD ΔE ≥ 9.2 light). Slot 3 is below 3:1 contrast → legend + table view always available. */
export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"] as const;
const GRID = "hsl(var(--border))";
const INK = "hsl(var(--muted-foreground))";
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const num = (v: unknown, digits = 1) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: digits }));

export interface DailyRow {
  day: string; hoursObserved: number; hoursPrecipitation: number; temperatureMeanC: number | null; temperatureMaxC: number | null; temperatureMinC: number | null;
  humidityMeanPct: number | null; humidityMinPct: number | null; humidity13hPct: number | null; windMeanMs: number | null; windMaxMs: number | null;
  gustMaxMs: number | null; precipitationMm: number | null; flaggedHours: number;
}

function ChartFrame({ title, unit, children, height = 190 }: { title: string; unit: string; children: React.ReactElement; height?: number }) {
  return (
    <figure className="rounded-xl border bg-card p-3">
      <figcaption className="text-sm font-medium mb-1">{title} <span className="text-xs text-muted-foreground">({unit})</span></figcaption>
      <div style={{ height }}><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </figure>
  );
}
const tooltipStyle = { contentStyle: { fontSize: 12, borderRadius: 8 }, labelFormatter: (d: string) => `Dia ${fmtDay(String(d))}` };
const axes = (unit: string) => [
  <CartesianGrid key="g" vertical={false} stroke={GRID} />,
  <XAxis key="x" dataKey="day" tickFormatter={fmtDay} tick={{ fontSize: 11, fill: INK }} minTickGap={24} stroke={GRID} />,
  <YAxis key="y" tick={{ fontSize: 11, fill: INK }} width={38} stroke={GRID} unit={unit === "%" ? "" : ""} />,
];
const line = (key: string, name: string, color: string) => (
  <Line key={key} type="monotone" dataKey={key} name={name} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#fcfcfb" }} connectNulls={false} isAnimationActive={false} />
);

/** Daily series of an INMET station: one measure per chart (no dual axes) + a table view. */
export function DailyCharts({ days }: { days: DailyRow[] }) {
  const [table, setTable] = useState(false);
  if (!days.length) return <p className="text-sm text-muted-foreground">Sem observações no período.</p>;
  return (
    <div className="space-y-3" data-testid="inmet-daily-charts">
      <div className="flex justify-end"><button type="button" className="text-xs underline" onClick={() => setTable(!table)}>{table ? "Ver gráficos" : "Ver dados em tabela"}</button></div>
      {table ? <DailyTable days={days} /> : (
        <div className="grid md:grid-cols-2 gap-3">
          <ChartFrame title="Temperatura do ar" unit="°C">
            <LineChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>{axes("°C")}<Tooltip {...tooltipStyle} formatter={(v: number) => `${num(v)} °C`} /><Legend wrapperStyle={{ fontSize: 12 }} />
              {line("temperatureMaxC", "Máxima", SERIES[1])}{line("temperatureMeanC", "Média", SERIES[0])}{line("temperatureMinC", "Mínima", SERIES[2])}</LineChart>
          </ChartFrame>
          <ChartFrame title="Umidade relativa" unit="%">
            <LineChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>{axes("%")}<Tooltip {...tooltipStyle} formatter={(v: number) => `${num(v, 0)} %`} /><Legend wrapperStyle={{ fontSize: 12 }} />
              {line("humidityMinPct", "Mínima do dia", SERIES[0])}{line("humidity13hPct", "Às 13 h locais", SERIES[1])}</LineChart>
          </ChartFrame>
          <ChartFrame title="Precipitação diária" unit="mm">
            <BarChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>{axes("mm")}<Tooltip {...tooltipStyle} formatter={(v: number) => `${num(v)} mm`} />
              <Bar dataKey="precipitationMm" name="Chuva" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} /></BarChart>
          </ChartFrame>
          <ChartFrame title="Vento" unit="m/s">
            <LineChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>{axes("m/s")}<Tooltip {...tooltipStyle} formatter={(v: number) => `${num(v)} m/s (${num(Number(v) * 3.6, 0)} km/h)`} /><Legend wrapperStyle={{ fontSize: 12 }} />
              {line("gustMaxMs", "Rajada máxima", SERIES[1])}{line("windMeanMs", "Velocidade média", SERIES[0])}</LineChart>
          </ChartFrame>
        </div>
      )}
    </div>
  );
}

export function DailyTable({ days }: { days: DailyRow[] }) {
  return (
    <div className="overflow-x-auto max-h-96 rounded-xl border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted"><tr className="text-left">{["Dia", "Horas", "T máx", "T méd", "T mín", "UR mín", "UR 13 h", "Vento méd", "Rajada", "Chuva", "Horas c/ alerta"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
        <tbody>{days.map((d) => (
          <tr key={d.day} className="border-t">
            <td className="px-2 py-1 whitespace-nowrap">{fmtDay(d.day)}/{d.day.slice(0, 4)}</td><td className="px-2">{d.hoursObserved}/24</td>
            <td className="px-2">{num(d.temperatureMaxC)}</td><td className="px-2">{num(d.temperatureMeanC)}</td><td className="px-2">{num(d.temperatureMinC)}</td>
            <td className="px-2">{num(d.humidityMinPct, 0)}</td><td className="px-2">{num(d.humidity13hPct, 0)}</td><td className="px-2">{num(d.windMeanMs)}</td>
            <td className="px-2">{num(d.gustMaxMs)}</td><td className="px-2">{d.precipitationMm == null ? "—" : `${num(d.precipitationMm)}${d.hoursPrecipitation < 22 ? " (incompleto)" : ""}`}</td>
            <td className="px-2">{d.flaggedHours || ""}</td>
          </tr>))}</tbody>
      </table>
    </div>
  );
}

type Desc = { n: number; mean: number | null; min: number | null; max: number | null; p10: number | null; p50: number | null; p90: number | null; std: number | null };
export interface PeriodSummary { from: string; to: string; expectedDays: number; daysWithData: number; availabilityPct: number; temperatureMax: Desc; temperatureMean: Desc; humidityMin: Desc; humidity13h: Desc; windMax: Desc; gustMax: Desc; precipitationTotalMm: number | null; daysWithoutRain: number; daysHumidityBelow30: number; flaggedHours: number }

const STAT_ROWS: [keyof PeriodSummary, string, string][] = [
  ["temperatureMax", "Temperatura máxima diária", "°C"], ["temperatureMean", "Temperatura média diária", "°C"], ["humidityMin", "Umidade mínima diária", "%"],
  ["humidity13h", "Umidade às 13 h", "%"], ["windMax", "Vento máximo (média horária)", "m/s"], ["gustMax", "Rajada máxima", "m/s"],
];
export function StatsTable({ s }: { s: PeriodSummary }) {
  return (
    <div className="overflow-x-auto rounded-xl border" data-testid="inmet-stats">
      <table className="w-full text-xs">
        <caption className="text-left text-sm font-medium p-2">Estatísticas descritivas · {fmtDay(s.from)}/{s.from.slice(0, 4)} a {fmtDay(s.to)}/{s.to.slice(0, 4)} · disponibilidade {num(s.availabilityPct)} % das horas</caption>
        <thead className="bg-muted"><tr className="text-left">{["Variável", "n (dias)", "Média", "Mín", "P10", "Mediana", "P90", "Máx", "Desvio"].map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}</tr></thead>
        <tbody>{STAT_ROWS.map(([k, label, unit]) => { const d = s[k] as Desc; return (
          <tr key={k} className="border-t"><td className="px-2 py-1">{label} ({unit})</td><td className="px-2">{d.n}</td>
            {[d.mean, d.min, d.p10, d.p50, d.p90, d.max, d.std].map((v, i) => <td key={i} className="px-2">{num(v)}</td>)}</tr>); })}</tbody>
      </table>
      <p className="text-xs p-2 text-muted-foreground">Chuva total {s.precipitationTotalMm == null ? "—" : `${num(s.precipitationTotalMm)} mm`} · {s.daysWithoutRain} dia(s) com menos de 1 mm · {s.daysHumidityBelow30} dia(s) com umidade mínima abaixo de 30 % · {s.flaggedHours} hora(s) com alerta de qualidade.</p>
    </div>
  );
}

export function CompareTable({ a, b }: { a: PeriodSummary; b: PeriodSummary }) {
  const rows: [string, number | null | undefined, number | null | undefined, string][] = [
    ["Temperatura máxima média", a.temperatureMax.mean, b.temperatureMax.mean, "°C"], ["Umidade mínima média", a.humidityMin.mean, b.humidityMin.mean, "%"],
    ["Umidade às 13 h (mediana)", a.humidity13h.p50, b.humidity13h.p50, "%"], ["Rajada máxima", a.gustMax.max, b.gustMax.max, "m/s"],
    ["Chuva total", a.precipitationTotalMm, b.precipitationTotalMm, "mm"], ["Dias com UR mín < 30 %", a.daysHumidityBelow30, b.daysHumidityBelow30, "dias"],
    ["Disponibilidade", a.availabilityPct, b.availabilityPct, "%"],
  ];
  const lbl = (s: PeriodSummary) => `${fmtDay(s.from)}/${s.from.slice(2, 4)}–${fmtDay(s.to)}/${s.to.slice(2, 4)}`;
  return (
    <div className="overflow-x-auto rounded-xl border" data-testid="inmet-compare">
      <table className="w-full text-xs">
        <thead className="bg-muted"><tr className="text-left"><th className="px-2 py-1 font-medium">Indicador</th><th className="px-2 font-medium">{lbl(a)}</th><th className="px-2 font-medium">{lbl(b)}</th><th className="px-2 font-medium">Diferença</th></tr></thead>
        <tbody>{rows.map(([n, x, y, u]) => (
          <tr key={n} className="border-t"><td className="px-2 py-1">{n} ({u})</td><td className="px-2">{num(x)}</td><td className="px-2">{num(y)}</td>
            <td className="px-2">{x == null || y == null ? "—" : `${Number(y) - Number(x) > 0 ? "+" : ""}${num(Number(y) - Number(x))}`}</td></tr>))}</tbody>
      </table>
    </div>
  );
}

export interface FmaDay { day: string; fma: number | null; class: string | null; status: string }
const FMA_LABEL: Record<string, string> = { nulo: "Nulo", pequeno: "Pequeno", medio: "Médio", alto: "Alto", muito_alto: "Muito alto" };
const STATUS_LABEL: Record<string, string> = { ok: "", reiniciado_por_chuva: "zerado por chuva > 12,9 mm", sem_dados: "sem dados suficientes", subestimado_apos_lacuna: "pode estar subestimado (início da série ou lacuna)" };

/** FMA series: single measure → bars, class in tooltip and table (status colors are not used for a series). */
export function FmaChart({ days, reference }: { days: FmaDay[]; reference: string }) {
  const [table, setTable] = useState(false);
  const last = [...days].reverse().find((d) => d.fma != null);
  return (
    <section className="rounded-xl border bg-card p-3" data-testid="inmet-fma">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Fórmula de Monte Alegre (FMA) — índice calculado pela plataforma</h3>
        <button type="button" className="text-xs underline" onClick={() => setTable(!table)}>{table ? "Ver gráfico" : "Ver dados em tabela"}</button>
      </div>
      <p className="text-xs text-muted-foreground">{reference}. Classes: nulo ≤ 1 · pequeno ≤ 3 · médio ≤ 8 · alto ≤ 20 · muito alto &gt; 20. Usa a umidade às 13 h locais e a chuva diária observadas na estação; não calibrado pela ARTEMIS para a região e não entra na pontuação do motor de risco.</p>
      {last && <p className="text-sm mt-1">Último valor ({fmtDay(last.day)}): <strong>{num(last.fma)}</strong> — perigo <strong>{FMA_LABEL[last.class ?? ""] ?? "—"}</strong>{STATUS_LABEL[last.status] ? ` · ${STATUS_LABEL[last.status]}` : ""}</p>}
      {table ? (
        <div className="overflow-x-auto max-h-72 mt-2"><table className="w-full text-xs"><thead className="bg-muted"><tr className="text-left"><th className="px-2 py-1">Dia</th><th className="px-2">FMA</th><th className="px-2">Classe</th><th className="px-2">Observação</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.day} className="border-t"><td className="px-2 py-1">{fmtDay(d.day)}</td><td className="px-2">{num(d.fma)}</td><td className="px-2">{FMA_LABEL[d.class ?? ""] ?? "—"}</td><td className="px-2">{STATUS_LABEL[d.status]}</td></tr>)}</tbody></table></div>
      ) : (
        <div style={{ height: 180 }} className="mt-2"><ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>{axes("")}
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(d: string) => `Dia ${fmtDay(String(d))}`}
              formatter={(v: number, _n, p: any) => [`${num(v)} — ${FMA_LABEL[p?.payload?.class] ?? "sem dados"}${STATUS_LABEL[p?.payload?.status] ? ` (${STATUS_LABEL[p.payload.status]})` : ""}`, "FMA"]} />
            <Bar dataKey="fma" name="FMA" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart></ResponsiveContainer></div>
      )}
    </section>
  );
}
