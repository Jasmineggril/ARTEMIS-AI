import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, GeoJSON, useMap } from "react-leaflet";
import { format, differenceInCalendarDays, subDays } from "date-fns";
import { MapPin, Flame, Filter, Download, Info, Layers } from "lucide-react";
import type L from "leaflet";
import { Layout } from "@/components/Layout";
import { RiskBadge, riskLevelColor } from "@/components/RiskBadge";
import { ClusteredPoints } from "@/components/map/ClusteredPoints";
import { DEFAULT_FIRE_RISK, FireRiskLayer, FireRiskLegend, type FireRiskSelection } from "@/components/map/FireRiskLayer";
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
const AREA_COLOR = "#0f172a";
const NO_ANALYSIS_COLOR = "#64748b";
const OCC_COLOR = "#7c2d12";
const SIS_COLOR = "#b45309";
const HOT_COLOR = "#7e22ce";
const STATION_COLOR = "#0369a1";
interface StationRow { code: string; name: string; state: string; latitude: number; longitude: number; altitudeM: number | null; lastDay: string | null; availability30dPct: number | null }
/** Radius used by the risk engine for historical occurrences; also the "near this area" filter. */
const NEAR_KM = 10;

interface HotspotPoint { detectedAt: string; satellite: string; latitude: number; longitude: number; municipality: string | null; state: string | null; biome: string | null }
interface HotspotSummary { lastSyncAt: string | null; period: { from: string; to: string } }
interface SisfogoPoint { id: number; roiNumber: string; startedAt: string | null; startedOn: string | null; extinguishedAt: string | null; latitude: number; longitude: number; municipality: string | null; state: string | null; biome: string | null; localityType: string | null; burnedAreaHa: number | null; rectified: boolean | null; revision: number }
interface SisfogoPoints { total: number; truncated: boolean; points: SisfogoPoint[]; localityTypes: string[]; lastCompleteSyncAt: string | null }

type Filters = { from: string; to: string; state: string; municipality: string; localityType: string; areaId: string };
const EMPTY: Filters = { from: "", to: "", state: "", municipality: "", localityType: "", areaId: "" };

/** Re-frames the map when the filters (signal) change: chosen area > filtered data > the organisation's areas > Brazil. */
function FitTo({ points, maxZoom, signal }: { points: [number, number][]; maxZoom: number; signal: string }) {
  const map = useMap();
  useEffect(() => {
    // No animation: data for several layers arrives in quick succession, and
    // overlapping animated fits leave Leaflet's layers out of sync.
    map.stop();
    if (points.length === 1) map.setView(points[0], maxZoom, { animate: false });
    else if (points.length > 1) map.fitBounds(points as any, { padding: [30, 30], maxZoom, animate: false });
    else map.setView([-14.5, -52], 4, { animate: false });
  }, [signal]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
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

const when = (iso: string | null | undefined, withTime = true) => (iso ? format(new Date(iso), withTime ? "dd/MM/yyyy HH:mm" : "dd/MM/yyyy") : "—");

export default function EnvironmentalMap() {
  const [, setLocation] = useLocation();
  const { data: user } = useAuthStatus();
  const [level, setLevel] = useState<"all" | RiskLevel | "none">("all");
  const [show, setShow] = useState({ areas: true, risk: true, occ: true, sisfogo: true, hot: true, biomes: false, fireRisk: true, stations: false });
  const [fireRisk, setFireRisk] = useState<FireRiskSelection>(DEFAULT_FIRE_RISK);
  const { data: st } = useQuery<{ stations: StationRow[] }>({ queryKey: ["/api/weather-stations"], queryFn: () => api("GET", "/api/weather-stations"), enabled: show.stations, staleTime: 30 * 60_000 });
  const [form, setForm] = useState<Filters>(EMPTY);
  const [f, setF] = useState<Filters>(EMPTY);

  const { data: areas = [] } = useQuery<AreaRow[]>({ queryKey: ["/api/areas"], queryFn: () => api("GET", "/api/areas") });
  const area = areas.find((a) => String(a.id) === f.areaId && a.latitude != null && a.longitude != null) ?? null;
  const near = <T,>(rows: T[], lat: (r: T) => number | null, lng: (r: T) => number | null) =>
    area ? rows.filter((r) => lat(r) != null && km(area.latitude!, area.longitude!, lat(r)!, lng(r)!) <= NEAR_KM) : rows;

  // 1. Organisation's imported occurrences
  const occQuery = new URLSearchParams(Object.entries({ from: f.from, to: f.to, state: f.state, municipality: f.municipality, limit: "5000" }).filter(([, v]) => v)).toString();
  const { data: occurrences = [], isFetching } = useQuery<FireOccurrence[]>({
    queryKey: ["/api/fire-occurrences", occQuery], queryFn: () => api("GET", `/api/fire-occurrences?${occQuery}`), enabled: show.occ,
  });
  const mappedOcc = near(occurrences.filter((o) => o.latitude != null && o.longitude != null), (o) => o.latitude, (o) => o.longitude);

  // 2. Official Sisfogo ROIs (bounding box around the chosen area)
  const bbox = area ? [area.longitude! - 0.12, area.latitude! - 0.1, area.longitude! + 0.12, area.latitude! + 0.1].map((n) => n.toFixed(4)).join(",") : "";
  const sisQuery = new URLSearchParams(Object.entries({ from: f.from, to: f.to, state: f.state, municipality: f.municipality, localityType: f.localityType, bbox, limit: "5000" }).filter(([, v]) => v)).toString();
  const { data: sis } = useQuery<SisfogoPoints>({
    queryKey: ["/api/public/sisfogo/points", sisQuery], queryFn: () => api("GET", `/api/public/sisfogo/points?${sisQuery}`), enabled: show.sisfogo,
  });
  const sisPoints = near(sis?.points ?? [], (p) => p.latitude, (p) => p.longitude);

  // 3. INPE hotspots: the API allows up to 31 days; a longer period falls back to the last 2 days.
  const period = f.from && f.to ? differenceInCalendarDays(new Date(`${f.to}T12:00:00`), new Date(`${f.from}T12:00:00`)) : null;
  const hotPeriodOk = period !== null && period >= 0 && period <= 31;
  const hotQuery = new URLSearchParams(Object.entries({ state: f.state, municipality: f.municipality, ...(hotPeriodOk ? { from: f.from, to: f.to } : {}) }).filter(([, v]) => v)).toString();
  const { data: hot } = useQuery<{ points: HotspotPoint[]; truncated: boolean }>({
    queryKey: ["/api/public/hotspots", hotQuery], queryFn: () => api("GET", `/api/public/hotspots?${hotQuery}`), enabled: show.hot,
  });
  const { data: hotSum } = useQuery<HotspotSummary>({
    queryKey: ["/api/public/hotspots/summary", hotQuery], queryFn: () => api("GET", `/api/public/hotspots/summary?${hotQuery}`), enabled: show.hot,
  });
  const hotPoints = near(hot?.points ?? [], (h) => h.latitude, (h) => h.longitude);

  // 4. Areas + 5. latest risk result per area
  const placed = areas.filter((a) => a.latitude != null && a.longitude != null && (!area || a.id === area.id) && (!f.state || a.state === f.state)
    && (!f.municipality || (a.municipality ?? "").toLowerCase() === f.municipality.trim().toLowerCase()));
  const riskAreas = placed.filter((a) => level === "all" || (level === "none" ? !a.latestAnalysis : a.latestAnalysis?.level === level));

  const placeFiltered = Boolean(f.state || f.municipality || f.localityType);
  const fit = useMemo<{ points: [number, number][]; maxZoom: number }>(() => {
    if (area) return { points: [[area.latitude!, area.longitude!]], maxZoom: 11 };
    if (placeFiltered) {
      const pts: [number, number][] = [
        ...(show.sisfogo ? sisPoints.map((p) => [p.latitude, p.longitude] as [number, number]) : []),
        ...(show.hot ? hotPoints.slice(0, 2000).map((h) => [h.latitude, h.longitude] as [number, number]) : []),
        ...(show.occ ? mappedOcc.map((o) => [o.latitude!, o.longitude!] as [number, number]) : []),
      ];
      if (pts.length) return { points: pts, maxZoom: 9 };
    }
    return { points: placed.map((a) => [a.latitude!, a.longitude!] as [number, number]), maxZoom: 6 };
  }, [area, placeFiltered, sis, hot, occurrences, placed.length, show.sisfogo, show.hot, show.occ]); // eslint-disable-line react-hooks/exhaustive-deps
  const fitSignal = `${f.areaId}|${f.state}|${f.municipality}|${f.localityType}|${placed.length}|${placeFiltered ? `${sis?.total ?? "-"}:${hot?.points.length ?? "-"}` : ""}`;

  const biomeStyle = (feature?: GeoJSON.Feature) => {
    const biome = feature?.properties?.biome as BrazilianBiome | undefined;
    const color = biome ? BIOME_COLORS[biome] : "#666";
    return { color, weight: 1, fillColor: color, fillOpacity: 0.08, opacity: 0.4, dashArray: "4" };
  };

  function exportCsv() {
    const blob = new Blob(["﻿" + toCsv(mappedOcc)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const el = document.createElement("a");
    el.href = url; el.download = `artemis-ocorrencias-${format(new Date(), "yyyyMMdd")}.csv`; el.click();
    URL.revokeObjectURL(url);
  }

  const input = "rounded-lg border border-input bg-background px-2 py-1.5 text-sm w-full";
  const toggle = (k: keyof typeof show, text: string, swatch: React.ReactNode) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />{swatch}{text}</label>
  );
  const dot = (c: string, cls = "rounded-full") => <span aria-hidden className={`inline-block w-2.5 h-2.5 shrink-0 ${cls}`} style={{ background: c }} />;

  return (
    <Layout>
      <header className="mb-4">
        <h1 className="text-3xl font-bold font-display flex items-center gap-2"><MapPin className="w-8 h-8 text-primary" aria-hidden />Mapa Ambiental</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Cada camada vem de uma fonte diferente e é mostrada separadamente — um registro do Sisfogo, um foco do INPE e uma ocorrência importada
          podem ser o mesmo incêndio e não são somados.
        </p>
      </header>

      <div className="grid lg:grid-cols-[310px_1fr] gap-4">
        <aside className="space-y-4" aria-label="Camadas e filtros">
          <fieldset className="bg-card border rounded-2xl p-4 space-y-2">
            <legend className="font-semibold text-sm px-1 flex items-center gap-1"><Layers className="w-4 h-4" aria-hidden />Camadas (fonte)</legend>
            {toggle("areas", "Áreas monitoradas", dot(AREA_COLOR))}
            {toggle("risk", "Resultado da análise de risco", dot(riskLevelColor("alto")))}
            {toggle("occ", "Ocorrências importadas pela organização", dot(OCC_COLOR, "rotate-45"))}
            {toggle("sisfogo", "Registros oficiais — Sisfogo", dot(SIS_COLOR))}
            {toggle("hot", "Focos de calor — INPE", dot(HOT_COLOR))}
            {toggle("fireRisk", "Risco de fogo — INPE (índice 0–1)", <span aria-hidden className="inline-block h-2.5 w-2.5 bg-emerald-700" />)}
            {toggle("stations", "Estações meteorológicas — INMET", dot(STATION_COLOR, ""))}
            {toggle("biomes", "Biomas (contorno ilustrativo)", <span aria-hidden className="inline-block w-2.5 h-2.5 border border-dashed border-emerald-700" />)}
          </fieldset>

          <form className="bg-card border rounded-2xl p-4 space-y-2" onSubmit={(e) => { e.preventDefault(); setF(form); }} aria-label="Filtros do mapa">
            <p className="font-semibold text-sm flex items-center gap-1"><Filter className="w-4 h-4" aria-hidden />Filtros</p>
            <div><label htmlFor="f-area" className="text-xs text-muted-foreground">Área monitorada (raio de {NEAR_KM} km)</label>
              <select id="f-area" className={input} value={form.areaId} onChange={(e) => setForm({ ...form, areaId: e.target.value })}>
                <option value="">Todas</option>{areas.filter((a) => a.latitude != null).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label htmlFor="f-from" className="text-xs text-muted-foreground">De</label>
                <input id="f-from" type="date" className={input} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></div>
              <div><label htmlFor="f-to" className="text-xs text-muted-foreground">Até</label>
                <input id="f-to" type="date" className={input} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></div>
            </div>
            <div><label htmlFor="f-uf" className="text-xs text-muted-foreground">UF</label>
              <select id="f-uf" className={input} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}>
                <option value="">Todas</option>{BR_STATES.map((s) => <option key={s}>{s}</option>)}
              </select></div>
            <div><label htmlFor="f-mun" className="text-xs text-muted-foreground">Município</label>
              <input id="f-mun" className={input} value={form.municipality} onChange={(e) => setForm({ ...form, municipality: e.target.value })} /></div>
            <div><label htmlFor="f-type" className="text-xs text-muted-foreground">Tipo de local (Sisfogo)</label>
              <select id="f-type" className={input} value={form.localityType} onChange={(e) => setForm({ ...form, localityType: e.target.value })}>
                <option value="">Todos</option>{(sis?.localityTypes ?? []).map((t) => <option key={t}>{t}</option>)}
              </select></div>
            <div><label htmlFor="lvl" className="text-xs text-muted-foreground">Nível de risco</label>
              <select id="lvl" className={input} value={level} onChange={(e) => setLevel(e.target.value as any)}>
                <option value="all">Todos os níveis</option><option value="crítico">Crítico</option><option value="alto">Alto</option>
                <option value="moderado">Moderado</option><option value="baixo">Baixo</option><option value="none">Sem análise</option>
              </select></div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="flex-1">{isFetching ? "Filtrando..." : "Aplicar"}</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setForm(EMPTY); setF(EMPTY); }}>Limpar</Button>
            </div>
            {hasRole(user, "analyst") && mappedOcc.length > 0 && (
              <Button type="button" size="sm" variant="outline" className="w-full" onClick={exportCsv}><Download className="w-4 h-4 mr-1" aria-hidden />Exportar ocorrências importadas (CSV)</Button>
            )}
          </form>

          <section className="bg-card border rounded-2xl p-4 text-xs space-y-3" aria-labelledby="legend">
            <p id="legend" className="font-semibold text-sm">Legenda e atualização</p>
            {show.risk && <div className="space-y-1">
              <p className="font-medium">Resultado da análise de risco</p>
              <div className="flex flex-wrap gap-1">{(["crítico", "alto", "moderado", "baixo"] as RiskLevel[]).map((l) => <RiskBadge key={l} level={l} size="sm" />)}</div>
              <p className="text-muted-foreground">Anel em volta da área: nível da última análise (data no balão). Apoio à decisão, não laudo.</p>
            </div>}
            {show.areas && <p className="flex items-start gap-2">{dot(AREA_COLOR, "rounded-full mt-1")}<span><b>Áreas monitoradas</b> — {placed.length} com coordenadas. Cinza = sem análise.</span></p>}
            {show.occ && <p className="flex items-start gap-2">{dot(OCC_COLOR, "rotate-45 mt-1")}<span><b>Ocorrências importadas</b> — {mappedOcc.length} no mapa. Arquivos da organização (privados).</span></p>}
            {show.sisfogo && <p className="flex items-start gap-2">{dot(SIS_COLOR, "rounded-full mt-1")}<span><b>Sisfogo (Ibama/Prevfogo)</b> — {sisPoints.length}{sis?.truncated ? ` de ${sis.total}` : ""} ROI(s) finalizado(s).
              {" "}{sis?.lastCompleteSyncAt ? `Sincronizado em ${when(sis.lastCompleteSyncAt)}.` : "Aguardando primeira sincronização completa."} Cobre só órgãos aderentes.</span></p>}
            {show.hot && <p className="flex items-start gap-2">{dot(HOT_COLOR, "rounded-full mt-1")}<span><b>Focos INPE</b> — {hotPoints.length} detecção(ões){hotSum ? ` de ${when(`${hotSum.period.from}T12:00:00`, false)} a ${when(`${hotSum.period.to}T12:00:00`, false)}` : ""}.
              {" "}{f.from && !hotPeriodOk ? "Período maior que 31 dias: mostrando os 2 últimos dias. " : ""}Sincronizado em {when(hotSum?.lastSyncAt)}. Foco de calor não é incêndio confirmado.</span></p>}
            {show.fireRisk && <div className="border-t pt-2"><FireRiskLegend selection={fireRisk} onChange={setFireRisk} visible={show.fireRisk} /></div>}
            {show.stations && <p className="flex items-start gap-2">{dot(STATION_COLOR, "mt-1")}<span><b>Estações INMET</b> — {st?.stations.length ?? "…"} estação(ões). Medição local; representa bem apenas o entorno da estação.</span></p>}
            <p className="text-muted-foreground">Números em círculos agrupam pontos próximos; clique para aproximar. Com a camada de risco ligada, o clique também consulta o valor da célula.</p>
          </section>
        </aside>

        <figure className="m-0">
        <div className="rounded-2xl overflow-hidden border h-[70vh] min-h-[420px]" role="region" aria-label="Mapa">
          {/* Attribution is shown below the map, so no control covers clickable points. */}
          <MapContainer center={[-14.5, -49]} zoom={5} className="h-full w-full" scrollWheelZoom attributionControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {show.fireRisk && <FireRiskLayer selection={fireRisk} visible={show.fireRisk} />}
            <FitTo points={fit.points} maxZoom={fit.maxZoom} signal={fitSignal} />
            {show.stations && <ClusteredPoints label="estações INMET" color={STATION_COLOR} radius={5} shape="diamond"
              points={(st?.stations ?? []).filter((x) => x.latitude != null && x.longitude != null).map((x) => ({ ...x, key: `st${x.code}`, lat: x.latitude, lng: x.longitude }))}
              renderPopup={(x) => <>
                <strong>Estação INMET {x.code}</strong><br />{x.name}/{x.state}{x.altitudeM != null ? ` · ${Math.round(x.altitudeM)} m` : ""}<br />
                Último dia com dados: {x.lastDay ? x.lastDay.split("-").reverse().join("/") : "sem dados importados"}<br />
                {x.availability30dPct != null && <>Disponibilidade (30 dias): {x.availability30dPct.toLocaleString("pt-BR")}%<br /></>}
                <button className="underline mt-1" onClick={() => setLocation(`/estacoes?code=${x.code}`)}>Ver série da estação</button>
              </>} />}
            {show.biomes && <GeoJSON data={BIOME_GEOJSON} style={biomeStyle as any}
              onEachFeature={(feat, layer) => (layer as L.Path).bindTooltip(`${feat.properties?.biome} (contorno aproximado)`, { sticky: true })} />}
            {area && <Circle center={[area.latitude!, area.longitude!]} radius={NEAR_KM * 1000} pathOptions={{ color: AREA_COLOR, weight: 1, dashArray: "6", fillOpacity: 0.03 }} />}

            {show.hot && <ClusteredPoints label="focos INPE" color={HOT_COLOR} radius={3} offset={[15, -10]}
              points={hotPoints.map((h, i) => ({ ...h, key: `h${i}`, lat: h.latitude, lng: h.longitude }))}
              renderPopup={(h) => <><strong>Foco de calor (satélite)</strong><br />{when(h.detectedAt)} · {h.satellite}<br />{h.municipality ?? "—"}/{h.state ?? "—"}<br />Não é incêndio confirmado. Fonte: INPE.</>} />}

            {show.sisfogo && <ClusteredPoints label="registros do Sisfogo" color={SIS_COLOR} radius={5} offset={[-15, -10]}
              points={sisPoints.map((p) => ({ ...p, key: `s${p.id}`, lat: p.latitude, lng: p.longitude }))}
              renderPopup={(p) => <>
                <strong>Registro oficial de incêndio (ROI)</strong><br />
                {p.roiNumber}{p.revision > 1 || p.rectified ? " · retificado" : ""}<br />
                Início: {when(p.startedAt)}{p.extinguishedAt ? <> · extinção: {when(p.extinguishedAt)}</> : null}<br />
                {p.municipality ?? "—"}/{p.state ?? "—"} · {p.biome ?? "—"}<br />
                {p.localityType && <>Local: {p.localityType}<br /></>}
                Área queimada estimada: {p.burnedAreaHa != null ? `${p.burnedAreaHa.toLocaleString("pt-BR")} ha` : "não informada"}<br />
                Fonte: Ibama/Prevfogo — Sisfogo
              </>} />}

            {show.occ && <ClusteredPoints label="ocorrências importadas" color={OCC_COLOR} radius={4} shape="diamond" offset={[0, 16]}
              points={mappedOcc.map((o) => ({ ...o, key: `o${o.id}`, lat: o.latitude!, lng: o.longitude! }))}
              renderPopup={(o) => <>
                <strong>Ocorrência histórica importada</strong><br />
                {o.occurrenceDate ?? "data não informada"} {o.occurrenceTime ?? ""}<br />
                {o.municipality ?? "—"}/{o.state ?? "—"}<br />
                {o.occurrenceType && <>Tipo: {o.occurrenceType}<br /></>}
                Fonte: {o.source || "arquivo importado"} · lote #{o.importBatchId}<br />
                Validação: {o.validationStatus}
              </>} />}

            {show.risk && riskAreas.filter((a) => a.latestAnalysis).map((a) => (
              <CircleMarker key={`r${a.id}`} center={[a.latitude!, a.longitude!]} radius={16} pathOptions={{ color: riskLevelColor(a.latestAnalysis!.level), weight: 4, fillOpacity: 0 }}>
                <Popup><strong>{a.name}</strong><br />Índice {a.latestAnalysis!.score}/100 — {a.latestAnalysis!.level}<br />Análise de {when(a.latestAnalysis!.createdAt)}<br />
                  <button className="underline mt-1" onClick={() => setLocation(`/reports?area=${a.id}`)}>Ver relatório</button></Popup>
              </CircleMarker>
            ))}
            {show.areas && placed.map((a) => (
              <div key={a.id}>
                {a.boundary ? <GeoJSON data={a.boundary as any} style={{ color: AREA_COLOR, weight: 2, fillOpacity: 0.08 }} /> : null}
                <CircleMarker center={[a.latitude!, a.longitude!]} radius={8} pathOptions={{ color: "#fff", weight: 2, fillColor: a.latestAnalysis ? AREA_COLOR : NO_ANALYSIS_COLOR, fillOpacity: 0.95 }}>
                  <Popup>
                    <strong>{a.name}</strong><br />{a.municipality}/{a.state}<br />
                    {a.latestAnalysis ? <>Última análise: {when(a.latestAnalysis.createdAt)}</> : "Sem análise"}
                    <br /><button className="underline mt-1" onClick={() => setLocation(`/risk-analysis?area=${a.id}`)}>Analisar</button>
                  </Popup>
                </CircleMarker>
              </div>
            ))}
          </MapContainer>
        </div>
        <figcaption className="text-[11px] text-muted-foreground mt-1 text-right">
          Mapa base © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">colaboradores do OpenStreetMap</a> · <a className="underline" href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a>
        </figcaption>
        </figure>
      </div>
      {(hot?.truncated || sis?.truncated) && (
        <p className="text-xs text-muted-foreground mt-2">Há mais pontos do que o limite de 5.000 por camada. Filtre por UF, município, período ou área para ver todos.</p>
      )}
      <p className="text-xs text-muted-foreground mt-4 flex items-start gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
        Seleção por polígono desenhado ainda não está disponível. {DECISION_SUPPORT_DISCLAIMER}</p>
      {areas.length === 0 && (
        <p className="text-sm mt-2"><Flame className="inline w-4 h-4" aria-hidden /> Cadastre áreas em <button className="underline" onClick={() => setLocation("/areas")}>Áreas Monitoradas</button> para vê-las no mapa.</p>
      )}
    </Layout>
  );
}
