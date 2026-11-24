import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { CloudSun } from "lucide-react";
import { DailyCharts, FmaChart, StatsTable, type DailyRow, type FmaDay, type PeriodSummary } from "./WeatherCharts";

interface Linked { code: string; name: string; state: string | null; distanceKm: number; representativeness: string; note: string; lastObservationAt: string | null; availability30dPct: number | null; status: string | null; method: string }
const REP: Record<string, string> = { proxima: "próxima (≤ 25 km)", intermediaria: "intermediária (≤ 50 km)", distante: "distante (≤ 100 km)", nao_representativa: "não representativa" };
const shift = (d: string, days: number) => new Date(Date.parse(d + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);

/** Stations linked to a property (distance, representativeness, availability) and the history of the nearest usable one. */
export function AreaWeather({ areaId }: { areaId: number }) {
  const { data } = useQuery<{ criteria: { distance: string }; stations: Linked[] }>({ queryKey: [`/api/areas/${areaId}/weather-stations`] });
  const usable = data?.stations.find((s) => s.lastObservationAt && s.distanceKm <= 50) ?? null;
  const to = usable?.lastObservationAt?.slice(0, 10) ?? "", from = to ? shift(to, -29) : "";
  const { data: hist } = useQuery<{ station: Linked | null; days: DailyRow[]; summary: PeriodSummary | null; fma: { days: FmaDay[]; reference: string } | null; message?: string }>({
    queryKey: [`/api/areas/${areaId}/weather-history?from=${from}&to=${to}`], enabled: !!to });
  if (!data) return null;
  return (
    <section className="rounded-2xl border bg-card p-4 space-y-3" aria-labelledby="aw-t" data-testid="area-weather">
      <h2 id="aw-t" className="font-semibold flex items-center gap-2"><CloudSun className="w-5 h-5 text-primary" aria-hidden />Meteorologia observada (INMET)</h2>
      <p className="text-xs text-muted-foreground">Estações automáticas mais próximas; distância medida {data.criteria.distance}. A estação mede as condições no local dela — relevo, altitude e uso do solo podem fazer a propriedade ser diferente.</p>
      {data.stations.length === 0 ? <p className="text-sm">Nenhuma estação do INMET a até 150 km.</p> : (
        <div className="overflow-x-auto"><table className="w-full text-xs">
          <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">Estação</th><th className="pr-2">Distância</th><th className="pr-2">Representatividade</th><th className="pr-2">Disponibilidade (30 d)</th><th className="pr-2">Última observação</th><th>Situação</th></tr></thead>
          <tbody>{data.stations.map((s) => (
            <tr key={s.code} className="border-t align-top"><td className="py-1 pr-2">{s.code} — {s.name}/{s.state}</td><td className="pr-2">{s.distanceKm.toLocaleString("pt-BR")} km</td>
              <td className="pr-2" title={s.note}>{REP[s.representativeness]}</td><td className="pr-2">{s.availability30dPct == null ? "sem dados" : `${s.availability30dPct.toLocaleString("pt-BR")} %`}</td>
              <td className="pr-2">{s.lastObservationAt ? new Date(s.lastObservationAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}</td><td>{s.status ?? "—"}</td></tr>))}</tbody>
        </table></div>
      )}
      {!usable && data.stations.length > 0 && <p className="text-sm">Nenhuma estação com dados a até 50 km: o histórico observado não é mostrado para esta área.</p>}
      {usable && hist && hist.station && (
        <div className="space-y-3">
          <p className="text-sm">Histórico de <strong>{hist.station.code} — {hist.station.name}</strong> ({hist.station.distanceKm.toLocaleString("pt-BR")} km; {REP[hist.station.representativeness]}) nos 30 dias até a última observação disponível. <Link href="/estacoes" className="underline">Ver todas as estações</Link></p>
          <DailyCharts days={hist.days} />
          {hist.summary && <StatsTable s={hist.summary} />}
          {hist.fma && <FmaChart days={hist.fma.days} reference={hist.fma.reference} />}
        </div>
      )}
    </section>
  );
}
