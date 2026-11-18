/**
 * One monitored property: boundary, what was observed around it (INPE),
 * official fire records (Sisfogo), own imports, analyses and open alerts.
 * Every block states where its data comes from and how current it is.
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AreaWeather } from "@/components/inmet/AreaWeather";
import { Link, useLocation, useRoute } from "wouter";
import { format } from "date-fns";
import { MapContainer, TileLayer, Polygon, Circle, CircleMarker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import { MapPinned, Flame, FileText, Satellite, Landmark, Upload, BellRing, Info, ArrowLeft, Pencil } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { RiskBadge, riskLevelColor } from "@/components/RiskBadge";
import { useAuthStatus, hasRole } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { polygons, type BoundaryGeom } from "@shared/geometry";
import type { MonitoredArea } from "@shared/schema";
import type { RiskLevel } from "@shared/risk-engine";
import { OPERATION_LABELS } from "@/pages/Areas";

interface Hot { id: number; detectedAt: string; satellite: string; latitude: number; longitude: number; frpMw: number | null; distanceKm: number }
interface Roi { id: number; roiNumber: string; startedAt: string | null; latitude: number; longitude: number; burnedAreaHa: number | null; distanceKm: number }
interface Surroundings {
  area: MonitoredArea;
  reference: { kind: "poligono" | "ponto"; radiusKm: number; days: number };
  hotspots: { note: string; lastSyncAt: string | null; fresh: boolean; counts: { inside: number; km1: number; km5: number; radius: number }; nearestKm: number | null; latestAt: string | null; satellites: string[]; items: Hot[] };
  official: { note: string; lastSyncAt: string | null; counts: { inside: number; radius: number }; byYear: { year: string; n: number }[]; items: Roi[] };
  imported: { note: string; count: number };
  analyses: { id: number; score: number; level: RiskLevel; createdAt: string; engineType: string | null; isExperimental: boolean }[];
  openAlerts: { id: number; title: string; kind: string; severity: string; status: string; createdAt: string }[];
}

const HOT = "#7e22ce";
const SIS = "#b45309";
const when = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : "—");
const km = (v: number) => (v === 0 ? "dentro da propriedade" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`);

/** Frames the property once the map has its real size (it may mount during a page transition). */
function FitArea({ g, center, radiusKm }: { g: BoundaryGeom | null; center: [number, number]; radiusKm: number }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      if (g) map.fitBounds(L.latLngBounds(polygons(g).flatMap((p) => p[0].map(([x, y]) => [y, x] as [number, number]))), { padding: [40, 40], maxZoom: 16, animate: false });
      else map.fitBounds(L.latLng(center).toBounds(radiusKm * 2000), { animate: false });
    };
    fit();
    const t = setTimeout(fit, 400);
    return () => clearTimeout(t);
  }, [map, g, center[0], center[1], radiusKm]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const ALERT_STATUS: Record<string, string> = { novo: "novo", reconhecido: "reconhecido", em_acompanhamento: "em acompanhamento", resolvido: "resolvido", descartado: "descartado" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="rounded-xl bg-muted/50 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold tabular-nums">{value}</p>{sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}</div>;
}

export default function AreaDetail() {
  const [, params] = useRoute("/areas/:id");
  const [, setLocation] = useLocation();
  const { data: user } = useAuthStatus();
  const [days, setDays] = useState(7);
  const id = Number(params?.id);
  const { data, error, isLoading } = useQuery<Surroundings>({
    queryKey: ["/api/areas", id, "surroundings", days],
    queryFn: () => api("GET", `/api/areas/${id}/surroundings?days=${days}&radiusKm=10`),
    enabled: Number.isInteger(id) && id > 0,
    retry: false,
  });

  if (isLoading) return <Layout><div className="h-96 rounded-2xl border bg-card animate-pulse" aria-busy="true" /></Layout>;
  if (error || !data) {
    return (
      <Layout>
        <Link href="/areas" className="text-sm underline inline-flex items-center gap-1 mb-4"><ArrowLeft className="w-4 h-4" aria-hidden />Áreas</Link>
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 text-amber-950 p-4 text-sm">{(error as Error)?.message ?? "Área não encontrada."}</p>
      </Layout>
    );
  }
  const a = data.area;
  const g = a.boundary as BoundaryGeom | null;
  const center: [number, number] = [a.latitude ?? -14.5, a.longitude ?? -52];
  const latest = data.analyses[0];

  return (
    <Layout>
      <Link href="/areas" className="text-sm underline inline-flex items-center gap-1 mb-3"><ArrowLeft className="w-4 h-4" aria-hidden />Áreas monitoradas</Link>
      <header className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold font-display flex items-center gap-2 break-words"><MapPinned className="w-8 h-8 text-primary shrink-0" aria-hidden />{a.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {a.municipality}/{a.state} · {OPERATION_LABELS[a.operationType] ?? a.operationType}
            {a.areaHectares != null && <> · {a.areaHectares.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ha ({a.areaHectaresSource === "calculada" ? "calculada do polígono" : "informada"})</>}
          </p>
          {(a as any).municipalityCheck?.status === "confere" && <p className="text-xs text-muted-foreground mt-1" data-testid="municipality-check">✓ {(a as any).municipalityCheck.message}</p>}
          {(a as any).municipalityCheck?.status === "diverge" && <p role="status" className="text-xs mt-1 text-amber-800 dark:text-amber-200" data-testid="municipality-check">⚠ {(a as any).municipalityCheck.message}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {hasRole(user, "analyst") && <Button onClick={() => setLocation(`/risk-analysis?area=${a.id}`)} data-testid="button-analyze-area"><Flame className="w-4 h-4 mr-1" aria-hidden />Analisar risco</Button>}
          <Button variant="outline" onClick={() => setLocation(`/reports?area=${a.id}`)}><FileText className="w-4 h-4 mr-1" aria-hidden />Relatório</Button>
          {hasRole(user, "manager") && <Button variant="outline" onClick={() => setLocation(`/areas?edit=${a.id}`)}><Pencil className="w-4 h-4 mr-1" aria-hidden />Editar</Button>}
        </div>
      </header>

      {!g && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-950 p-3 text-sm flex gap-2"><Info className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          Sem limite cadastrado: as distâncias são medidas a partir do ponto informado, não da borda da propriedade. Desenhe ou importe o limite em Editar.</p>
      )}

      <div className="grid lg:grid-cols-[1fr_360px] gap-4 mb-6">
        <figure className="m-0">
          <div className="h-[420px] rounded-2xl overflow-hidden border" role="region" aria-label="Mapa da propriedade e entorno">
            <MapContainer center={center} zoom={11} className="h-full w-full" scrollWheelZoom attributionControl={false}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <FitArea g={g} center={center} radiusKm={data.reference.radiusKm} />
              {g ? polygons(g).map((p, i) => <Polygon key={i} positions={p.map((r) => r.map(([x, y]) => [y, x] as [number, number]))} pathOptions={{ color: "#0f172a", weight: 2, fillOpacity: 0.08 }} />)
                : <CircleMarker center={center} radius={8} pathOptions={{ color: "#fff", weight: 2, fillColor: "#0f172a", fillOpacity: 1 }} />}
              {!g && <Circle center={center} radius={data.reference.radiusKm * 1000} pathOptions={{ color: "#0f172a", weight: 1, dashArray: "6", fillOpacity: 0.02 }} />}
              {data.official.items.map((r) => (
                <CircleMarker key={`s${r.id}`} center={[r.latitude, r.longitude]} radius={6} pathOptions={{ color: "#fff", weight: 1, fillColor: SIS, fillOpacity: 0.9 }}>
                  <Popup><strong>ROI {r.roiNumber}</strong><br />Início: {when(r.startedAt)}<br />{km(r.distanceKm)}<br />Área queimada estimada: {r.burnedAreaHa != null ? `${r.burnedAreaHa} ha` : "não informada"}<br />Fonte: Sisfogo (Ibama/Prevfogo)</Popup>
                </CircleMarker>))}
              {data.hotspots.items.map((h) => (
                <CircleMarker key={`h${h.id}`} center={[h.latitude, h.longitude]} radius={4} pathOptions={{ color: "#fff", weight: 1, fillColor: HOT, fillOpacity: 0.9 }}>
                  <Popup><strong>Foco de calor (satélite)</strong><br />{when(h.detectedAt)} · {h.satellite}<br />{km(h.distanceKm)}{h.frpMw != null && <><br />FRP {h.frpMw} MW</>}<br />Não é incêndio confirmado. Fonte: INPE.</Popup>
                </CircleMarker>))}
            </MapContainer>
          </div>
          <figcaption className="text-[11px] text-muted-foreground mt-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style={{ background: HOT }} />focos INPE ·
            <span className="inline-block w-2.5 h-2.5 rounded-full align-middle mx-1" style={{ background: SIS }} />ROIs Sisfogo · raio de {data.reference.radiusKm} km ·
            Mapa base © colaboradores do OpenStreetMap
          </figcaption>
        </figure>

        <aside className="space-y-4">
          <section className="rounded-2xl border bg-card p-4" aria-labelledby="risk-t">
            <h2 id="risk-t" className="font-semibold mb-2">Última análise de risco <span className="text-xs font-normal text-muted-foreground">(resultado calculado)</span></h2>
            {latest ? (
              <div className="space-y-1">
                <RiskBadge level={latest.level} score={latest.score} showIcon />
                <p className="text-xs text-muted-foreground">{when(latest.createdAt)} · {latest.engineType ?? "motor"}{latest.isExperimental ? " · experimental" : ""}</p>
                <Link href={`/reports?area=${a.id}`} className="text-sm underline">Ver relatório completo</Link>
              </div>
            ) : <p className="text-sm text-muted-foreground">Nenhuma análise ainda.{hasRole(user, "analyst") && " Use \"Analisar risco\"."}</p>}
          </section>
          <section className="rounded-2xl border bg-card p-4" aria-labelledby="alerts-t">
            <h2 id="alerts-t" className="font-semibold mb-2 flex items-center gap-2"><BellRing className="w-4 h-4" aria-hidden />Alertas abertos</h2>
            {data.openAlerts.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum alerta aberto.</p> : (
              <ul className="space-y-1 text-sm">{data.openAlerts.map((al) => (
                <li key={al.id}><Link href={`/alerts?id=${al.id}`} className="underline">{al.title}</Link>
                  <span className="text-xs text-muted-foreground"> · {al.kind === "foco_proximo" ? "foco detectado" : "análise de risco"} · {ALERT_STATUS[al.status] ?? al.status}</span></li>))}</ul>
            )}
          </section>
        </aside>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <label htmlFor="days" className="text-sm">Período dos focos:</label>
        <select id="days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-input bg-background px-2 py-1 text-sm">
          <option value={2}>últimos 2 dias</option><option value={7}>últimos 7 dias</option><option value={31}>últimos 31 dias</option>
        </select>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <section className="rounded-2xl border bg-card p-4" aria-labelledby="hot-t" data-testid="section-hotspots">
          <h2 id="hot-t" className="font-semibold flex items-center gap-2"><Satellite className="w-4 h-4" style={{ color: HOT }} aria-hidden />Focos de calor — INPE <span className="text-xs font-normal text-muted-foreground">(observado)</span></h2>
          <p className="text-xs text-muted-foreground mt-1">{data.hotspots.note}</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Stat label="Dentro da propriedade" value={String(data.hotspots.counts.inside)} />
            <Stat label="Até 5 km" value={String(data.hotspots.counts.km5)} />
            <Stat label={`Até ${data.reference.radiusKm} km`} value={String(data.hotspots.counts.radius)} />
            <Stat label="Mais próximo" value={data.hotspots.nearestKm == null ? "—" : data.hotspots.nearestKm === 0 ? "dentro" : `${data.hotspots.nearestKm.toLocaleString("pt-BR")} km`} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">Última detecção: {when(data.hotspots.latestAt)} · satélites: {data.hotspots.satellites.join(", ") || "—"}</p>
          <p className={`text-xs mt-1 ${data.hotspots.fresh ? "text-muted-foreground" : "text-amber-800"}`}>Sincronizado em {when(data.hotspots.lastSyncAt)}{data.hotspots.fresh ? "" : " — dados possivelmente desatualizados"}.</p>
        </section>

        <section className="rounded-2xl border bg-card p-4" aria-labelledby="roi-t" data-testid="section-official">
          <h2 id="roi-t" className="font-semibold flex items-center gap-2"><Landmark className="w-4 h-4" style={{ color: SIS }} aria-hidden />Histórico oficial — Sisfogo <span className="text-xs font-normal text-muted-foreground">(registro oficial)</span></h2>
          <p className="text-xs text-muted-foreground mt-1">{data.official.note}</p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Stat label="Dentro da propriedade" value={String(data.official.counts.inside)} />
            <Stat label={`Até ${data.reference.radiusKm} km`} value={String(data.official.counts.radius)} />
          </div>
          {data.official.byYear.length > 0 && <p className="text-xs mt-2">Por ano: {data.official.byYear.map((y) => `${y.year}: ${y.n}`).join(" · ")}</p>}
          {data.official.items.length > 0 && (
            <ul className="text-xs mt-2 space-y-0.5 max-h-28 overflow-y-auto">{data.official.items.slice(0, 15).map((r) => (
              <li key={r.id}>{when(r.startedAt).slice(0, 10)} · {r.roiNumber} · {km(r.distanceKm)}{r.burnedAreaHa != null && ` · ~${r.burnedAreaHa} ha (estimativa)`}</li>))}</ul>
          )}
          <p className="text-xs text-muted-foreground mt-1">Sincronizado em {when(data.official.lastSyncAt)}.</p>
        </section>

        <section className="rounded-2xl border bg-card p-4" aria-labelledby="imp-t">
          <h2 id="imp-t" className="font-semibold flex items-center gap-2"><Upload className="w-4 h-4 text-primary" aria-hidden />Ocorrências importadas <span className="text-xs font-normal text-muted-foreground">(informado pela organização)</span></h2>
          <p className="text-xs text-muted-foreground mt-1">{data.imported.note}</p>
          <div className="mt-3"><Stat label={`Até ${data.reference.radiusKm} km`} value={String(data.imported.count)} /></div>
          {hasRole(user, "manager") && <Link href="/data-import" className="text-sm underline mt-2 inline-block">Importar histórico</Link>}
        </section>
      </div>

      <div className="mt-4"><AreaWeather areaId={a.id} /></div>

      {data.analyses.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 mt-4" aria-labelledby="hist-t">
          <h2 id="hist-t" className="font-semibold mb-2">Histórico de análises</h2>
          <ul className="flex flex-wrap gap-2">{data.analyses.map((x) => (
            <li key={x.id} className="text-xs rounded-lg border px-2 py-1" style={{ borderColor: riskLevelColor(x.level) }}>{when(x.createdAt)} · {x.level} ({x.score})</li>))}</ul>
        </section>
      )}
    </Layout>
  );
}
