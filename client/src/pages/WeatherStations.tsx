import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, CircleMarker, Tooltip as LTooltip } from "react-leaflet";
import { CloudSun } from "lucide-react";
import { Layout } from "@/components/Layout";
import { CompareTable, DailyCharts, FmaChart, StatsTable, type DailyRow, type FmaDay, type PeriodSummary } from "@/components/inmet/WeatherCharts";

interface Station { code: string; name: string; state: string | null; latitude: number; longitude: number; altitudeM: number | null; status: string | null; lastDay: string | null; availability30dPct: number | null }
interface Status { stations: number; stationsOperating: number; stationsWithData: number; observations: string; flaggedObservations: string; firstObservation: string | null; lastObservation: string | null;
  runs: { id: number; status: string; startedAt: string; finishedAt: string | null; params: any; recordsRead: number; recordsInserted: number; recordsUpdated: number; recordsRejected: number; error: string | null }[]; access: { archive: string; hourlyApi: string } }

const shift = (d: string, days: number) => new Date(Date.parse(d + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
const avLabel = (p: number | null) => (p == null ? "sem dados" : p >= 90 ? "boa" : p >= 50 ? "parcial" : "baixa");
// availability is a STATE → status colors, always with a text label in the tooltip and the table
const avColor = (p: number | null) => (p == null ? "#8a8984" : p >= 90 ? "#0ca30c" : p >= 50 ? "#c98500" : "#d03b3b");
const n = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR");

/** INMET automatic stations: location, availability, daily history, period comparison and FMA. */
export default function WeatherStations() {
  const { data: list } = useQuery<{ stations: Station[] }>({ queryKey: ["/api/weather-stations"] });
  const { data: status } = useQuery<Status>({ queryKey: ["/api/connectors/inmet/status"] });
  const stations = list?.stations ?? [];
  // ?code=A001 (link from the map) preselects a station
  const [code, setCode] = useState<string>(() => { try { return new URLSearchParams(window.location.search).get("code")?.toUpperCase().replace(/[^A-Z0-9]/g, "") ?? ""; } catch { return ""; } });
  const [uf, setUf] = useState("");
  const st = stations.find((s) => s.code === code) ?? null;
  const [to, setTo] = useState(""); const [from, setFrom] = useState("");
  useEffect(() => { if (!code && stations.length) { const first = stations.find((s) => s.code === "A001") ?? stations.find((s) => s.lastDay); if (first) setCode(first.code); } }, [stations, code]);
  useEffect(() => { if (st?.lastDay) { setTo(st.lastDay); setFrom(shift(st.lastDay, -29)); } }, [st?.code, st?.lastDay]);
  const len = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 : 0;
  const prevTo = from ? shift(from, -1) : "", prevFrom = from ? shift(from, -len) : "";
  const ok = !!(st && from && to);
  const { data: daily } = useQuery<{ days: DailyRow[]; summary: PeriodSummary; note: string }>({ queryKey: [`/api/weather-stations/${code}/daily?from=${from}&to=${to}`], enabled: ok });
  const { data: cmp } = useQuery<{ a: PeriodSummary; b: PeriodSummary }>({ queryKey: [`/api/weather-stations/${code}/compare?aFrom=${prevFrom}&aTo=${prevTo}&bFrom=${from}&bTo=${to}`], enabled: ok });
  const { data: fma } = useQuery<{ days: FmaDay[]; reference: string }>({ queryKey: [`/api/weather-stations/${code}/fma?from=${from}&to=${to}`], enabled: ok });
  const states = useMemo(() => Array.from(new Set(stations.map((s) => s.state).filter(Boolean))).sort() as string[], [stations]);
  const shown = uf ? stations.filter((s) => s.state === uf) : stations;
  const lastRun = status?.runs.find((r) => r.params?.kind === "ano");

  return (
    <Layout>
      <div className="max-w-6xl mx-auto space-y-5">
        <header>
          <h1 className="text-3xl font-bold font-display flex items-center gap-2"><CloudSun className="w-8 h-8 text-primary" aria-hidden />Estações meteorológicas do INMET</h1>
          <p className="text-muted-foreground text-sm mt-1">Observações horárias oficiais das estações automáticas do INMET (medição no local da estação). Complementam — não substituem — as estimativas do Open-Meteo, os focos do INPE e os registros do Sisfogo.</p>
        </header>

        {status && (
          <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Disponibilidade da fonte" data-testid="inmet-status">
            {[["Estações no cadastro", `${n(status.stations)}`, `${n(status.stationsOperating)} operantes · ${n(status.stations - status.stationsOperating)} em pane ou outra situação`],
              ["Estações com dados", n(status.stationsWithData), "com observações carregadas"],
              ["Observações horárias", n(status.observations), `${n(status.flaggedObservations)} com alerta de qualidade`],
              ["Período coberto", status.lastObservation ? `até ${new Date(status.lastObservation).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : "—", status.firstObservation ? `desde ${new Date(status.firstObservation).toLocaleDateString("pt-BR", { timeZone: "UTC" })}` : ""],
            ].map(([t, v, s]) => (
              <div key={t} className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">{t}</p><p className="text-2xl font-semibold">{v}</p><p className="text-xs text-muted-foreground">{s}</p></div>))}
            <p className="sm:col-span-2 lg:col-span-4 text-xs text-muted-foreground">
              {status.access.archive}. {status.access.hourlyApi}. {lastRun ? `Última sincronização do arquivo anual: ${lastRun.status} em ${new Date(lastRun.finishedAt ?? lastRun.startedAt).toLocaleString("pt-BR")} (${n(lastRun.recordsInserted)} inseridas, ${n(lastRun.recordsUpdated)} atualizadas, ${n(lastRun.recordsRejected)} linhas descartadas — horas sem nenhuma medida ou inválidas).` : ""}
            </p>
          </section>
        )}

        <section className="grid lg:grid-cols-[1fr_340px] gap-4" aria-label="Localização das estações">
          <div className="rounded-xl border overflow-hidden h-[420px]">
            <MapContainer center={[-14.5, -51]} zoom={4} className="h-full w-full" scrollWheelZoom attributionControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {shown.map((s) => (
                <CircleMarker key={s.code} center={[s.latitude, s.longitude]} radius={s.code === code ? 9 : 6}
                  pathOptions={{ color: s.code === code ? "#0b0b0b" : "#fcfcfb", weight: 2, fillColor: avColor(s.availability30dPct), fillOpacity: 0.9 }}
                  eventHandlers={{ click: () => setCode(s.code) }}>
                  <LTooltip>{s.code} · {s.name}/{s.state} — disponibilidade {avLabel(s.availability30dPct)}{s.availability30dPct != null ? ` (${s.availability30dPct} %)` : ""} · {s.status ?? "—"}</LTooltip>
                </CircleMarker>))}
            </MapContainer>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Cor = disponibilidade nos últimos 30 dias de dados: <span className="font-medium">boa</span> ≥ 90 % · <span className="font-medium">parcial</span> 50–90 % · <span className="font-medium">baixa</span> &lt; 50 % · cinza sem dados.</p>
            <label className="block text-sm font-medium" htmlFor="uf">Estado</label>
            <select id="uf" value={uf} onChange={(e) => setUf(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"><option value="">Todos</option>{states.map((s) => <option key={s}>{s}</option>)}</select>
            <label className="block text-sm font-medium" htmlFor="st">Estação</label>
            <select id="st" value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {shown.map((s) => <option key={s.code} value={s.code}>{s.code} — {s.name}/{s.state}{s.lastDay ? "" : " (sem dados)"}</option>)}
            </select>
            {st && <dl className="text-xs grid grid-cols-2 gap-1 mt-2"><dt className="text-muted-foreground">Situação</dt><dd>{st.status ?? "—"}</dd><dt className="text-muted-foreground">Altitude</dt><dd>{st.altitudeM != null ? `${st.altitudeM} m` : "—"}</dd>
              <dt className="text-muted-foreground">Coordenadas</dt><dd>{st.latitude.toFixed(4)}, {st.longitude.toFixed(4)}</dd><dt className="text-muted-foreground">Último dia</dt><dd>{st.lastDay ?? "—"}</dd></dl>}
          </div>
        </section>

        {st && !st.lastDay && <p className="text-sm">Esta estação ainda não tem observações carregadas.</p>}
        {ok && (
          <section className="space-y-3" aria-labelledby="hist-t">
            <div className="flex flex-wrap items-end gap-3">
              <h2 id="hist-t" className="text-xl font-semibold mr-auto">{st!.code} — {st!.name}/{st!.state}</h2>
              <label className="text-sm">De <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="ml-1 rounded border px-2 py-1" /></label>
              <label className="text-sm">Até <input type="date" value={to} min={from} max={st!.lastDay ?? undefined} onChange={(e) => setTo(e.target.value)} className="ml-1 rounded border px-2 py-1" /></label>
            </div>
            {daily && <p className="text-xs text-muted-foreground">{daily.note}</p>}
            {daily && <DailyCharts days={daily.days} />}
            {daily && <StatsTable s={daily.summary} />}
            {cmp && <div><h3 className="text-sm font-medium mb-1">Comparação com o período anterior de mesma duração</h3><CompareTable a={cmp.a} b={cmp.b} /></div>}
            {fma && <FmaChart days={fma.days} reference={fma.reference} />}
          </section>
        )}
      </div>
    </Layout>
  );
}
