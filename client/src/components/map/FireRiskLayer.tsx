/**
 * Map layers of INPE's official fire-risk products (served by /api/fire-risk/*):
 *   - Risco de Fogo observado (by day) and previsto (T0..T3), 0.2° cells (mean or max of the 1 km pixels);
 *   - Dias sem chuva (INPE, consecutive days ≤ 1 mm in the last 120 days).
 * The grid is drawn on ONE canvas, row by row in Web-Mercator, so cells stay where they are
 * (a lat-regular image stretched over Mercator bounds would drift north/south).
 * Clicking the map while a layer is on queries the cell under the point.
 * Wording: a meteorological index — not a hotspot, not a confirmed fire, not a probability.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOverlay, Popup, useMapEvents } from "react-leaflet";
import { api } from "@/lib/api";

export type RfSel = { kind: "off" | "rf" | "dry"; product: "observado" | "previsto"; day: string; lead: number; stat: "mean" | "max" };
export const RF_SEL_OFF: RfSel = { kind: "off", product: "observado", day: "", lead: 0, stat: "mean" };

interface Available { layers: { index: string; product: string; lead: number; days: string[] }[]; method: { name: string; notThis: string; source: string; limits: string[]; reference: string } }
interface Grid { index: string; product: string; validDay: string; lead: number; cellDeg: number; lat0: number; lon0: number; nlat: number; nlon: number; mean: (number | null)[]; max: (number | null)[]; sourceFile: string; computedAt: string; unit: string }

export const RF_CLASSES = [
  { key: "minimo", label: "Mínimo", upTo: 0.15, color: "#1a9850" },
  { key: "baixo", label: "Baixo", upTo: 0.4, color: "#a6d96a" },
  { key: "medio", label: "Médio", upTo: 0.7, color: "#fee08b" },
  { key: "alto", label: "Alto", upTo: 0.95, color: "#f46d43" },
  { key: "critico", label: "Crítico", upTo: Infinity, color: "#a50026" },
];
export const DRY_BINS = [
  { label: "0–9", upTo: 9, color: "#f7fbff" }, { label: "10–29", upTo: 29, color: "#fdd0a2" }, { label: "30–59", upTo: 59, color: "#fd8d3c" },
  { label: "60–89", upTo: 89, color: "#d94801" }, { label: "90–120", upTo: Infinity, color: "#7f2704" },
];
const rfColor = (v: number) => RF_CLASSES.find((c) => v <= c.upTo)!.color;
const dryColor = (v: number) => DRY_BINS.find((c) => v <= c.upTo)!.color;
export const rfLabel = (v: number | null | undefined) => (v == null ? "sem valor" : RF_CLASSES.find((c) => v <= c.upTo)!.label);
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d }));

export function useFireRiskAvailable() {
  return useQuery<Available>({ queryKey: ["/api/fire-risk/available"], queryFn: () => api("GET", "/api/fire-risk/available"), staleTime: 15 * 60_000 });
}
export function useFireRiskGrid(sel: RfSel) {
  const index = sel.kind === "dry" ? "inpe_dias_sem_chuva" : "inpe_rf_oficial";
  const product = sel.kind === "dry" ? "observado" : sel.product;
  const qs = new URLSearchParams({ index, product, lead: String(product === "previsto" ? sel.lead : 0), ...(product === "observado" && sel.day ? { day: sel.day } : {}) });
  return useQuery<Grid>({ queryKey: ["/api/fire-risk/grid", qs.toString()], queryFn: () => api("GET", `/api/fire-risk/grid?${qs}`), enabled: sel.kind !== "off", staleTime: 15 * 60_000, retry: false });
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOfMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

function gridImage(g: Grid, stat: "mean" | "max", dry: boolean) {
  const vals = stat === "max" ? g.max : g.mean;
  const latMax = g.lat0 + g.nlat * g.cellDeg, yTop = mercY(latMax), yBot = mercY(g.lat0);
  const W = g.nlon, H = g.nlat * 2;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d")!; const img = ctx.createImageData(W, H);
  const rgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const cache = new Map<string, number[]>();
  for (let py = 0; py < H; py++) {
    const lat = latOfMercY(yTop - ((py + 0.5) / H) * (yTop - yBot));
    const iy = Math.floor((lat - g.lat0) / g.cellDeg); if (iy < 0 || iy >= g.nlat) continue;
    for (let x = 0; x < W; x++) {
      const v = vals[iy * g.nlon + x]; if (v == null) continue;
      const hex = dry ? dryColor(v) : rfColor(v);
      let c = cache.get(hex); if (!c) { c = rgb(hex); cache.set(hex, c); }
      const o = (py * W + x) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { url: cv.toDataURL("image/png"), bounds: [[g.lat0, g.lon0], [latMax, g.lon0 + g.nlon * g.cellDeg]] as [[number, number], [number, number]] };
}

/** Inside <MapContainer>: the overlay + click-to-query popup. */
export function FireRiskOverlay({ sel, grid }: { sel: RfSel; grid: Grid | undefined }) {
  const img = useMemo(() => (grid && sel.kind !== "off" ? gridImage(grid, sel.stat, sel.kind === "dry") : null), [grid, sel.kind, sel.stat]);
  const [at, setAt] = useState<[number, number] | null>(null);
  useEffect(() => setAt(null), [sel.kind]);
  useMapEvents({ click: (e) => { if (sel.kind !== "off") setAt([e.latlng.lat, e.latlng.lng]); } });
  if (!img) return null;
  return (
    <>
      <ImageOverlay url={img.url} bounds={img.bounds} opacity={0.6} className="artemis-pixelated" interactive={false} />
      {at && <Popup position={at} eventHandlers={{ remove: () => setAt(null) }}><PointValues lat={at[0]} lng={at[1]} /></Popup>}
    </>
  );
}

function PointValues({ lat, lng }: { lat: number; lng: number }) {
  const { data, isLoading, error } = useQuery<{ values: { index: string; product: string; lead: number; validDay: string; mean: number | null; max: number | null }[]; note: string }>({
    queryKey: ["/api/fire-risk/point", lat.toFixed(3), lng.toFixed(3)], queryFn: () => api("GET", `/api/fire-risk/point?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`), retry: false,
  });
  if (isLoading) return <span>Consultando…</span>;
  if (error || !data) return <span>Ponto fora da área coberta (Brasil) ou consulta indisponível.</span>;
  const rf = data.values.filter((v) => v.index === "inpe_rf_oficial"), dry = data.values.find((v) => v.index === "inpe_dias_sem_chuva");
  return (
    <div className="text-xs space-y-1 max-w-[240px]" data-testid="rf-point">
      <strong>Risco de fogo oficial (INPE) — {lat.toFixed(3)}, {lng.toFixed(3)}</strong>
      {rf.length === 0 && <p>Sem dados do índice para este ponto.</p>}
      <ul>{rf.map((v) => (
        <li key={`${v.product}${v.lead}`}>{v.product === "observado" ? "Observado" : `Previsto (+${v.lead} d)`} {fmtDay(v.validDay)}: <b>{rfLabel(v.mean)}</b> · média {num(v.mean)} · máx. {num(v.max)}</li>
      ))}</ul>
      {dry && <p>Dias sem chuva (INPE, {fmtDay(dry.validDay)}): <b>{num(dry.mean, 0)}</b> (média) · máx. {num(dry.max, 0)}</p>}
      <p className="text-muted-foreground">{data.note} Índice meteorológico: não é foco de calor nem incêndio confirmado.</p>
    </div>
  );
}

/** Sidebar: layer selector, legend, provenance and export. */
export function FireRiskPanel({ sel, onChange, grid, gridError }: { sel: RfSel; onChange: (s: RfSel) => void; grid: Grid | undefined; gridError: boolean }) {
  const { data: av } = useFireRiskAvailable();
  const obsDays = av?.layers.find((l) => l.index === "inpe_rf_oficial" && l.product === "observado")?.days ?? [];
  const leads = (av?.layers.filter((l) => l.index === "inpe_rf_oficial" && l.product === "previsto") ?? []).map((l) => ({ lead: l.lead, day: l.days[0] }));
  const hasDry = av?.layers.some((l) => l.index === "inpe_dias_sem_chuva");
  const input = "rounded-lg border border-input bg-background px-2 py-1.5 text-sm w-full";
  function exportCsv() {
    if (!grid) return;
    const rows = ["latitude_centro;longitude_centro;media;maximo"];
    for (let iy = 0; iy < grid.nlat; iy++) for (let ix = 0; ix < grid.nlon; ix++) {
      const i = iy * grid.nlon + ix; if (grid.mean[i] == null) continue;
      rows.push([(grid.lat0 + (iy + 0.5) * grid.cellDeg).toFixed(2), (grid.lon0 + (ix + 0.5) * grid.cellDeg).toFixed(2), grid.mean[i], grid.max[i]].join(";"));
    }
    const name = `inpe-${grid.index === "inpe_dias_sem_chuva" ? "dias-sem-chuva" : "risco-fogo"}-${grid.product}-${grid.validDay}${grid.product === "previsto" ? `-T${grid.lead}` : ""}.csv`;
    const header = `# Fonte: Programa Queimadas/INPE (${grid.sourceFile}); grade ARTEMIS de ${grid.cellDeg}° (média e máximo dos pixels de 1 km); ${grid.unit}\n`;
    const url = URL.createObjectURL(new Blob(["﻿" + header + rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  }
  return (
    <fieldset className="bg-card border rounded-2xl p-4 space-y-2" data-testid="rf-panel">
      <legend className="font-semibold text-sm px-1">Índices oficiais do INPE</legend>
      <div><label htmlFor="rf-kind" className="text-xs text-muted-foreground">Camada</label>
        <select id="rf-kind" className={input} value={sel.kind === "off" ? "off" : sel.kind === "dry" ? "dry" : sel.product}
          onChange={(e) => { const v = e.target.value; onChange(v === "off" ? { ...sel, kind: "off" } : v === "dry" ? { ...sel, kind: "dry" } : { ...sel, kind: "rf", product: v as RfSel["product"] }); }}>
          <option value="off">Nenhuma</option>
          <option value="observado" disabled={!obsDays.length}>Risco de fogo — observado</option>
          <option value="previsto" disabled={!leads.length}>Risco de fogo — previsão (até 3 dias)</option>
          <option value="dry" disabled={!hasDry}>Dias sem chuva</option>
        </select></div>
      {sel.kind === "rf" && sel.product === "observado" && (
        <div><label htmlFor="rf-day" className="text-xs text-muted-foreground">Dia</label>
          <select id="rf-day" className={input} value={sel.day || obsDays[0] || ""} onChange={(e) => onChange({ ...sel, day: e.target.value })}>
            {obsDays.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
          </select></div>)}
      {sel.kind === "rf" && sel.product === "previsto" && (
        <div><label htmlFor="rf-lead" className="text-xs text-muted-foreground">Dia previsto</label>
          <select id="rf-lead" className={input} value={sel.lead} onChange={(e) => onChange({ ...sel, lead: Number(e.target.value) })}>
            {leads.map((l) => <option key={l.lead} value={l.lead}>{fmtDay(l.day)} (T{l.lead})</option>)}
          </select></div>)}
      {sel.kind !== "off" && (
        <div><label htmlFor="rf-stat" className="text-xs text-muted-foreground">Valor da célula de {grid?.cellDeg ?? 0.2}° (≈ 22 km)</label>
          <select id="rf-stat" className={input} value={sel.stat} onChange={(e) => onChange({ ...sel, stat: e.target.value as RfSel["stat"] })}>
            <option value="mean">Média dos pixels de 1 km</option><option value="max">Máximo (pior pixel)</option>
          </select></div>)}
      {sel.kind !== "off" && gridError && <p role="status" className="text-xs text-amber-800">Grade indisponível para esta seleção (ainda não sincronizada).</p>}
      {sel.kind !== "off" && grid && (
        <div className="text-xs space-y-1" aria-label="Legenda do índice">
          <div className="flex flex-wrap gap-x-2 gap-y-1">
            {(sel.kind === "dry" ? DRY_BINS : RF_CLASSES).map((c) => (
              <span key={c.label} className="flex items-center gap-1"><span aria-hidden className="inline-block w-3 h-3 border" style={{ background: c.color }} />{c.label}</span>))}
          </div>
          {sel.kind === "rf"
            ? <p className="text-muted-foreground">Classes oficiais do INPE (Mínimo ≤ 0,15 · Baixo ≤ 0,40 · Médio ≤ 0,70 · Alto ≤ 0,95 · Crítico &gt; 0,95). Índice meteorológico de suscetibilidade da vegetação: <b>não é foco de calor, não é incêndio confirmado e não é probabilidade</b>.</p>
            : <p className="text-muted-foreground">Dias consecutivos com chuva ≤ 1 mm nos últimos 120 dias (INPE, estimativa por satélite).</p>}
          <p className="text-muted-foreground">Fonte: Programa Queimadas/INPE · {grid.product === "previsto" ? `previsão para ${fmtDay(grid.validDay)}` : `dia ${fmtDay(grid.validDay)}`} · arquivo {grid.sourceFile} · processado em {new Date(grid.computedAt).toLocaleString("pt-BR")}. Clique no mapa para consultar um ponto.</p>
          <button type="button" className="underline" onClick={exportCsv}>Exportar grade (CSV)</button>
        </div>)}
    </fieldset>
  );
}
