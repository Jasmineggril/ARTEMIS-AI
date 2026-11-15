import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MapContainer, TileLayer, CircleMarker, Popup, GeoJSON, useMap } from "react-leaflet";
import { format } from "date-fns";
import { MapPin, Flame, Filter, Download, Info } from "lucide-react";
import type L from "leaflet";
import { Layout } from "@/components/Layout";
import { RiskBadge, riskLevelColor } from "@/components/RiskBadge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuthStatus, hasRole } from "@/hooks/use-auth";
import { type BrazilianBiome } from "@/lib/biomes";
import { BR_STATES } from "@shared/br-states";
import { DECISION_SUPPORT_DISCLAIMER } from "@shared/identity";
import type { RiskLevel } from "@shared/risk-engine";
import type { MonitoredArea, FireOccurrence } from "@shared/schema";


// ── Biome GeoJSON polygons (simplified approximations for Brazil) ────────────
const BIOME_COLORS: Record<BrazilianBiome, string> = {
  "Amazônia":      "#2d6a2d",
  "Cerrado":       "#b8860b",
  "Mata Atlântica":"#1a6b3a",
  "Caatinga":      "#c4713a",
  "Pantanal":      "#2e7d7d",
  "Pampa":         "#5a8a3c",
};

// Simplified polygon coordinates [lon, lat] — approximate visual representations
const BIOME_GEOJSON: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { biome: "Amazônia" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-74, 5], [-50, 5], [-44, 0], [-44, -8], [-48, -13], [-55, -16],
          [-60, -15], [-68, -10], [-73, -5], [-74, 5],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Cerrado" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-60, -4], [-47, -2], [-41, -6], [-40, -14], [-40, -24],
          [-55, -24], [-60, -18], [-60, -4],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Caatinga" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-44, -3], [-34.5, -3], [-34.5, -15], [-44, -15], [-44, -3],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Mata Atlântica" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-50, -5], [-34, -6], [-34, -33], [-52, -33], [-52, -25],
          [-47, -18], [-46, -12], [-50, -5],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Pantanal" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-58.5, -15], [-54, -15], [-54, -22.5], [-58.5, -22.5], [-58.5, -15],
        ]],
      },
    },
    {
      type: "Feature",
      properties: { biome: "Pampa" },
      geometry: {
        type: "Polygon",
        coordinates: [[
          [-57.5, -27.5], [-48.5, -27.5], [-48.5, -33.8], [-57.5, -33.8], [-57.5, -27.5],
        ]],
      },
    },
  ],
};


type AreaRow = MonitoredArea & { latestAnalysis: { id: number; score: number; level: RiskLevel; createdAt: string } | null };
const NO_ANALYSIS_COLOR = "#64748b";
const OCC_COLOR = "#7c2d12";

function FitTo({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 10);
    else if (points.length > 1) map.fitBounds(points as any, { padding: [30, 30], maxZoom: 11 });
  }, [points.length]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function toCsv(rows: FireOccurrence[]) {
  const head = ["data", "hora", "municipio", "uf", "latitude", "longitude", "tipo", "situacao", "fonte", "lote"];
  const esc = (v: unknown) => {
    let x = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(x)) x = `'${x}`;
    return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
  };
  return [head.join(","), ...rows.map((r) => [r.occurrenceDate, r.occurrenceTime, r.municipality, r.state, r.latitude, r.longitude, r.occurrenceType, r.occurrenceStatus, r.source, r.importBatchId].map(esc).join(","))].join("\n");
}

export default function CeresMaps() {
  const [, setLocation] = useLocation();
  const { data: user } = useAuthStatus();
  const [level, setLevel] = useState<"all" | RiskLevel | "none">("all");
  const [showAreas, setShowAreas] = useState(true);
  const [showOcc, setShowOcc] = useState(true);
  const [showBiomes, setShowBiomes] = useState(false);
  const [occFilter, setOccFilter] = useState({ from: "", to: "", state: "", municipality: "" });
  const [applied, setApplied] = useState(occFilter);

  const { data: areas = [] } = useQuery<AreaRow[]>({ queryKey: ["/api/areas"], queryFn: () => api("GET", "/api/areas") });
  const occQuery = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
  const { data: occurrences = [], isFetching } = useQuery<FireOccurrence[]>({
    queryKey: ["/api/fire-occurrences", occQuery],
    queryFn: () => api("GET", `/api/fire-occurrences${occQuery ? `?${occQuery}` : ""}`),
  });

  const visibleAreas = areas.filter((a) => level === "all" || (level === "none" ? !a.latestAnalysis : a.latestAnalysis?.level === level));
  const mappedOcc = occurrences.filter((o) => o.latitude != null && o.longitude != null);
  const points = useMemo<[number, number][]>(
    () => [...areas.filter((a) => a.latitude != null).map((a) => [a.latitude!, a.longitude!] as [number, number]),
      ...mappedOcc.slice(0, 500).map((o) => [o.latitude!, o.longitude!] as [number, number])],
    [areas, mappedOcc],
  );

  const biomeStyle = (feature?: GeoJSON.Feature) => {
    const biome = feature?.properties?.biome as BrazilianBiome | undefined;
    const color = biome ? BIOME_COLORS[biome] : "#666";
    return { color, weight: 1, fillColor: color, fillOpacity: 0.08, opacity: 0.4, dashArray: "4" };
  };
  const areaColor = (a: AreaRow) => (a.latestAnalysis ? riskLevelColor(a.latestAnalysis.level) : NO_ANALYSIS_COLOR);

  function exportCsv() {
    const blob = new Blob(["\uFEFF" + toCsv(occurrences)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `artemis-ocorrencias-${format(new Date(), "yyyyMMdd")}.csv`; el.click();
    URL.revokeObjectURL(url);
  }

  const input = "rounded-lg border border-input bg-background px-2 py-1.5 text-sm w-full";
  return (
    <Layout>
      <header className="mb-4">
        <h1 className="text-3xl font-bold font-display flex items-center gap-2"><MapPin className="w-8 h-8 text-primary" aria-hidden />Mapa Ambiental</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {areas.length} área(s) da organização · {mappedOcc.length} ocorrência(s) histórica(s) importada(s) com coordenadas.
          Ocorrências importadas são registros históricos, não monitoramento em tempo real. Focos de calor por satélite (INPE) ainda não estão integrados.
        </p>
      </header>

      <div className="grid lg:grid-cols-[300px_1fr] gap-4">
        <aside className="space-y-4" aria-label="Camadas e filtros">
          <fieldset className="bg-card border rounded-2xl p-4 space-y-2">
            <legend className="font-semibold text-sm px-1">Camadas</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showAreas} onChange={(e) => setShowAreas(e.target.checked)} />Áreas monitoradas</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showOcc} onChange={(e) => setShowOcc(e.target.checked)} />Ocorrências importadas</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showBiomes} onChange={(e) => setShowBiomes(e.target.checked)} />Biomas (contorno ilustrativo, não oficial)</label>
          </fieldset>

          <fieldset className="bg-card border rounded-2xl p-4 space-y-2">
            <legend className="font-semibold text-sm px-1 flex items-center gap-1"><Filter className="w-4 h-4" aria-hidden />Áreas por risco</legend>
            <label htmlFor="lvl" className="sr-only">Nível</label>
            <select id="lvl" className={input} value={level} onChange={(e) => setLevel(e.target.value as any)}>
              <option value="all">Todos os níveis</option><option value="crítico">Crítico</option><option value="alto">Alto</option>
              <option value="moderado">Moderado</option><option value="baixo">Baixo</option><option value="none">Sem análise</option>
            </select>
          </fieldset>

          <form className="bg-card border rounded-2xl p-4 space-y-2" onSubmit={(e) => { e.preventDefault(); setApplied(occFilter); }}>
            <p className="font-semibold text-sm">Ocorrências</p>
            <div className="grid grid-cols-2 gap-2">
              <div><label htmlFor="f-from" className="text-xs text-muted-foreground">De</label>
                <input id="f-from" type="date" className={input} value={occFilter.from} onChange={(e) => setOccFilter({ ...occFilter, from: e.target.value })} /></div>
              <div><label htmlFor="f-to" className="text-xs text-muted-foreground">Até</label>
                <input id="f-to" type="date" className={input} value={occFilter.to} onChange={(e) => setOccFilter({ ...occFilter, to: e.target.value })} /></div>
            </div>
            <div><label htmlFor="f-uf" className="text-xs text-muted-foreground">UF</label>
              <select id="f-uf" className={input} value={occFilter.state} onChange={(e) => setOccFilter({ ...occFilter, state: e.target.value })}>
                <option value="">Todas</option>{BR_STATES.map((s) => <option key={s}>{s}</option>)}
              </select></div>
            <div><label htmlFor="f-mun" className="text-xs text-muted-foreground">Município</label>
              <input id="f-mun" className={input} value={occFilter.municipality} onChange={(e) => setOccFilter({ ...occFilter, municipality: e.target.value })} /></div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="flex-1">{isFetching ? "Filtrando..." : "Aplicar"}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { const e = { from: "", to: "", state: "", municipality: "" }; setOccFilter(e); setApplied(e); }}>Limpar</Button>
            </div>
            {hasRole(user, "analyst") && occurrences.length > 0 && (
              <Button type="button" size="sm" variant="outline" className="w-full" onClick={exportCsv}><Download className="w-4 h-4 mr-1" aria-hidden />Exportar resultado (CSV)</Button>
            )}
          </form>

          <section className="bg-card border rounded-2xl p-4 text-xs space-y-1.5" aria-labelledby="legend">
            <p id="legend" className="font-semibold text-sm">Legenda</p>
            {(["crítico", "alto", "moderado", "baixo"] as RiskLevel[]).map((l) => <div key={l}><RiskBadge level={l} size="sm" showIcon /></div>)}
            <p className="flex items-center gap-2"><span className="inline-block w-3 h-3 rounded-full border-2" style={{ borderColor: NO_ANALYSIS_COLOR }} />Área sem análise</p>
            <p className="flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rotate-45" style={{ background: OCC_COLOR }} />Ocorrência importada (ponto pequeno)</p>
          </section>
        </aside>

        <div className="rounded-2xl overflow-hidden border h-[70vh] min-h-[420px]">
          <MapContainer center={[-14.5, -49]} zoom={5} className="h-full w-full" scrollWheelZoom>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
            <FitTo points={points} />
            {showBiomes && <GeoJSON data={BIOME_GEOJSON} style={biomeStyle as any}
              onEachFeature={(f, layer) => (layer as L.Path).bindTooltip(`${f.properties?.biome} (contorno aproximado)`, { sticky: true })} />}
            {showAreas && visibleAreas.map((a) => (
              <div key={a.id}>
                {a.boundary ? <GeoJSON data={a.boundary as any} style={{ color: areaColor(a), weight: 2, fillOpacity: 0.15 }} /> : null}
                {a.latitude != null && (
                  <CircleMarker center={[a.latitude, a.longitude!]} radius={10} pathOptions={{ color: "#fff", weight: 2, fillColor: areaColor(a), fillOpacity: 0.95 }}>
                    <Popup>
                      <strong>{a.name}</strong><br />{a.municipality}/{a.state}<br />
                      {a.latestAnalysis ? <>Índice {a.latestAnalysis.score}/100 — {a.latestAnalysis.level}<br />Análise de {format(new Date(a.latestAnalysis.createdAt), "dd/MM/yyyy HH:mm")}</> : "Sem análise"}
                      <br /><button className="underline mt-1" onClick={() => setLocation(`/risk-analysis?area=${a.id}`)}>Analisar</button>
                    </Popup>
                  </CircleMarker>
                )}
              </div>
            ))}
            {showOcc && mappedOcc.map((o) => (
              <CircleMarker key={`o${o.id}`} center={[o.latitude!, o.longitude!]} radius={4} pathOptions={{ color: OCC_COLOR, weight: 1, fillColor: OCC_COLOR, fillOpacity: 0.7 }}>
                <Popup>
                  <strong>Ocorrência histórica importada</strong><br />
                  {o.occurrenceDate ?? "data não informada"} {o.occurrenceTime ?? ""}<br />
                  {o.municipality ?? "—"}/{o.state ?? "—"}<br />
                  {o.occurrenceType && <>Tipo: {o.occurrenceType}<br /></>}
                  Fonte: {o.source || "arquivo importado"} · lote #{o.importBatchId}<br />
                  Validação: {o.validationStatus}
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-4 flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
        Agrupamento de pontos, seleção por polígono desenhado e camada de focos de calor estão pendentes. {DECISION_SUPPORT_DISCLAIMER}</p>
      {areas.length === 0 && (
        <p className="text-sm mt-2"><Flame className="inline w-4 h-4" aria-hidden /> Cadastre áreas em <button className="underline" onClick={() => setLocation("/areas")}>Áreas Monitoradas</button> para vê-las no mapa.</p>
      )}
    </Layout>
  );
}
