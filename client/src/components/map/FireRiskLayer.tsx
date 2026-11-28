/**
 * Camada de risco de fogo oficial do INPE no mapa.
 *
 * A grade 0,2° vem de /api/fire-risk/grid (média/máximo dos pixels de 1 km por
 * célula). Cada célula é desenhada numa única canvas, reprojetada para Web
 * Mercator pelo próprio Leaflet; a consulta por clique usa
 * /api/fire-risk/point e deixa claro que o valor é da célula, não da propriedade.
 *
 * Este índice é susceptibilidade meteorológica da vegetação para queimar.
 * Não é detecção de fogo, incêndio confirmado nem probabilidade calibrada.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download, Info, X } from "lucide-react";
import { apiGet } from "@/lib/api";
import { RF_CLASS_LABEL, RF_CLASS_LIMITS, rfClass, type RfClass } from "@shared/inpe-fire-risk";

export type FireRiskIndex = "inpe_rf_oficial" | "inpe_dias_sem_chuva";
export type FireRiskProduct = "observado" | "previsto";

export interface FireRiskSelection {
  index: FireRiskIndex;
  product: FireRiskProduct;
  day: string;
  lead: number;
}

export const DEFAULT_FIRE_RISK: FireRiskSelection = {
  index: "inpe_rf_oficial",
  product: "observado",
  day: "",
  lead: 0,
};

interface GridResponse {
  index: FireRiskIndex;
  product: FireRiskProduct;
  validDay: string;
  lead: number;
  cellDeg: number;
  lat0: number;
  lon0: number;
  nlat: number;
  nlon: number;
  mean: Array<number | null>;
  max: Array<number | null>;
  sourceFile: string | null;
  computedAt: string;
  unit: string;
  method?: { source?: string; reference?: string; notThis?: string; what?: string };
}

interface AvailableLayer { index: FireRiskIndex; product: FireRiskProduct; lead: number; days: string[] }
interface AvailableResponse { layers: AvailableLayer[]; method?: unknown }

interface PointValue {
  index: FireRiskIndex;
  product: FireRiskProduct;
  lead: number;
  validDay: string;
  mean: number | null;
  max: number | null;
  cellDeg: number;
}
interface PointResponse { lat: number; lng: number; note: string; values: PointValue[] }

export function useFireRiskAvailable() {
  return useQuery<AvailableResponse>({
    queryKey: ["/api/fire-risk/available"],
    queryFn: () => apiGet<AvailableResponse>("/api/fire-risk/available"),
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

export function useFireRiskGrid(selection: FireRiskSelection) {
  const query = useMemo(() => {
    const p = new URLSearchParams({ index: selection.index, product: selection.product, lead: String(selection.lead) });
    if (selection.day) p.set("day", selection.day);
    return p.toString();
  }, [selection.index, selection.product, selection.day, selection.lead]);
  return useQuery<GridResponse>({
    queryKey: ["/api/fire-risk/grid", query],
    queryFn: () => apiGet<GridResponse>(`/api/fire-risk/grid?${query}`),
    staleTime: 15 * 60_000,
    retry: 1,
  });
}

/** Cores com significado explícito na legenda — a cor nunca é o único indicador. */
const RF_COLORS: Record<RfClass, string> = {
  minimo: "#1b7f5a",
  baixo: "#7fb539",
  medio: "#e8b329",
  alto: "#e2711d",
  critico: "#b3261e",
};
const RF_KEYS: RfClass[] = ["minimo", "baixo", "medio", "alto", "critico"];

/** Faixas apenas para leitura visual do produto de dias sem chuva; não são classes oficiais do INPE. */
const DRY_BINS = [
  { max: 15, label: "0–15 dias", color: "#dbeafe" },
  { max: 30, label: "16–30 dias", color: "#93c5fd" },
  { max: 60, label: "31–60 dias", color: "#fcd34d" },
  { max: 90, label: "61–90 dias", color: "#fb923c" },
  { max: Infinity, label: "> 90 dias", color: "#b3261e" },
];

function colorFor(index: FireRiskIndex, value: number | null): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (index === "inpe_rf_oficial") return RF_COLORS[rfClass(value)];
  return DRY_BINS.find((b) => value <= b.max)?.color ?? null;
}

function labelFor(index: FireRiskIndex, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "sem dado";
  if (index === "inpe_rf_oficial") return `${value.toFixed(2)} — ${RF_CLASS_LABEL[rfClass(value)]}`;
  return `${value.toFixed(0)} dias`;
}

const fmtDay = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? format(new Date(`${d}T12:00:00Z`), "dd/MM/yyyy") : d);
const fmtWhen = (iso: string | null | undefined) => (iso ? format(new Date(iso), "dd/MM/yyyy HH:mm") : "—");

/** Um único canvas, actualizado em move/zoom/resize; só desenha células visíveis. */
function drawGrid(canvas: HTMLCanvasElement, map: L.Map, grid: GridResponse, index: FireRiskIndex) {
  const size = map.getSize();
  if (!size || size.x === 0 || size.y === 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(size.x * dpr), h = Math.round(size.y * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.x, size.y);

  const bounds = map.getBounds();
  const { lat0, lon0, cellDeg, nlat, nlon, mean } = grid;
  const iy0 = Math.max(0, Math.floor((bounds.getSouth() - lat0) / cellDeg));
  const iy1 = Math.min(nlat - 1, Math.ceil((bounds.getNorth() - lat0) / cellDeg));
  const ix0 = Math.max(0, Math.floor((bounds.getWest() - lon0) / cellDeg));
  const ix1 = Math.min(nlon - 1, Math.ceil((bounds.getEast() - lon0) / cellDeg));
  ctx.globalAlpha = 0.58;
  for (let iy = iy0; iy <= iy1; iy++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const v = mean[iy * nlon + ix];
      const color = colorFor(index, v);
      if (!color) continue;
      const p1 = map.latLngToContainerPoint([lat0 + (iy + 1) * cellDeg, lon0 + ix * cellDeg]);
      const p2 = map.latLngToContainerPoint([lat0 + iy * cellDeg, lon0 + (ix + 1) * cellDeg]);
      if (p2.x < 0 || p1.x > size.x || p2.y < 0 || p1.y > size.y) continue;
      ctx.fillStyle = color;
      ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
    }
  }
  ctx.globalAlpha = 1;
}

function ClickProbe({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

/** Malha desenhada no mapa + consulta por clique. A legenda/exportação está em FireRiskLegend. */
export function FireRiskLayer({ selection, visible }: { selection: FireRiskSelection; visible: boolean }) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { data: grid } = useFireRiskGrid(selection);
  const [probe, setProbe] = useState<{ lat: number; lng: number; data?: PointResponse; error?: string } | null>(null);

  useEffect(() => {
    if (!visible || !grid || !canvasRef.current) return;
    let frame = 0;
    const render = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (canvasRef.current) drawGrid(canvasRef.current, map, grid, selection.index);
      });
    };
    render();
    map.on("move zoom resize", render);
    return () => {
      cancelAnimationFrame(frame);
      map.off("move zoom resize", render);
    };
  }, [map, grid, selection.index, visible]);

  useEffect(() => setProbe(null), [selection.index, selection.product, selection.day, selection.lead]);

  if (!visible) return null;

  async function pick(lat: number, lng: number) {
    setProbe({ lat, lng });
    try {
      const url = `/api/fire-risk/point?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}`;
      setProbe({ lat, lng, data: await apiGet<PointResponse>(url) });
    } catch (e) {
      setProbe({ lat, lng, error: e instanceof Error ? e.message : "Não foi possível consultar o ponto." });
    }
  }

  return (
    <>
      <canvas ref={canvasRef} aria-hidden="true" data-testid="fire-risk-canvas"
        className="pointer-events-none absolute inset-0 z-[350] h-full w-full" />
      <ClickProbe onPick={pick} />
      {probe && (
        <div role="status" data-testid="fire-risk-point"
          className="absolute bottom-3 left-3 z-[900] w-[min(20rem,calc(100%-1.5rem))] rounded-xl border bg-background/95 p-3 text-xs shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">Risco de fogo no ponto clicado</p>
            <button type="button" aria-label="Fechar consulta" className="rounded p-0.5 hover:bg-muted" onClick={() => setProbe(null)}><X className="h-3.5 w-3.5" aria-hidden /></button>
          </div>
          <p className="mt-0.5 text-muted-foreground">{probe.lat.toFixed(3)}°, {probe.lng.toFixed(3)}°</p>
          {probe.error ? <p className="mt-2 text-amber-800 dark:text-amber-200">{probe.error}</p> : probe.data && (
            <>
              <ul className="mt-2 space-y-1">
                {probe.data.values.filter((v) => v.mean != null).map((v) => (
                  <li key={`${v.index}-${v.product}-${v.lead}-${v.validDay}`} className="border-t pt-1">
                    <span className="font-medium">{labelFor(v.index, v.mean)}</span>
                    {" · "}máx. {labelFor(v.index, v.max)}
                    <br /><span className="text-muted-foreground">{v.product === "observado" ? "Observado" : `Previsto +${v.lead} d`} · {fmtDay(v.validDay)} · célula {v.cellDeg}°</span>
                  </li>
                ))}
                {probe.data.values.every((v) => v.mean == null) && <li className="text-muted-foreground">Sem valor válido na célula para este ponto.</li>}
              </ul>
              <p className="mt-2 text-muted-foreground">{probe.data.note}</p>
            </>
          )}
        </div>
      )}
    </>
  );
}

function csvCell(v: unknown): string {
  let x = v == null ? "" : String(v);
  // CSV injection guard, sem transformar coordenadas negativas em texto.
  if (/^[=+@-]/.test(x) && !Number.isFinite(Number(x))) x = `'${x}`;
  return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
}

function gridToCsv(grid: GridResponse): string {
  const head = ["data_validade", "produto", "lead_dias", "indice", "lat_centro", "lon_centro", "media", "maximo", "unidade", "arquivo_fonte", "gerado_em"];
  const rows: string[] = [head.join(",")];
  for (let iy = 0; iy < grid.nlat; iy++) {
    for (let ix = 0; ix < grid.nlon; ix++) {
      const mean = grid.mean[iy * grid.nlon + ix];
      const max = grid.max[iy * grid.nlon + ix];
      if (mean == null && max == null) continue;
      rows.push([
        grid.validDay, grid.product, grid.lead, grid.index,
        (grid.lat0 + (iy + 0.5) * grid.cellDeg).toFixed(4),
        (grid.lon0 + (ix + 0.5) * grid.cellDeg).toFixed(4),
        mean, max, grid.unit, grid.sourceFile, grid.computedAt,
      ].map(csvCell).join(","));
    }
  }
  return rows.join("\n");
}

function downloadCsv(grid: GridResponse) {
  const blob = new Blob(["\ufeff" + gridToCsv(grid)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `artemis-risco-fogo-${grid.index}-${grid.validDay}-${grid.product}${grid.lead ? `-lead${grid.lead}` : ""}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Controles, legenda e exportação da camada — renderizada na barra lateral do mapa. */
export function FireRiskLegend({ selection, onChange, visible }: {
  selection: FireRiskSelection;
  onChange: (s: FireRiskSelection) => void;
  visible: boolean;
}) {
  const { data: available } = useFireRiskAvailable();
  const { data: grid, isFetching, error } = useFireRiskGrid(selection);
  if (!visible) return null;
  const days = available?.layers.find((l) => l.index === selection.index && l.product === selection.product && l.lead === selection.lead)?.days ?? [];
  const input = "rounded-lg border border-input bg-background px-2 py-1 text-xs w-full";

  return (
    <div className="space-y-2" data-testid="fire-risk-legend">
      <p className="font-medium">Risco de fogo oficial — INPE <span className="font-normal text-muted-foreground">(índice 0–1, não probabilidade)</span></p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs text-muted-foreground">Índice
          <select className={input} value={selection.index}
            onChange={(e) => {
              const index = e.target.value as FireRiskIndex;
              onChange({ ...selection, index, product: index === "inpe_dias_sem_chuva" ? "observado" : selection.product, lead: 0, day: "" });
            }}>
            <option value="inpe_rf_oficial">Risco de fogo (0–1)</option>
            <option value="inpe_dias_sem_chuva">Dias sem chuva (120 dias)</option>
          </select></label>
        <label className="text-xs text-muted-foreground">Produto
          <select className={input} value={selection.product}
            onChange={(e) => onChange({ ...selection, product: e.target.value as FireRiskProduct, day: "" })}>
            <option value="observado">Observado</option><option value="previsto">Previsto</option>
          </select></label>
        <label className="text-xs text-muted-foreground">Antecedência
          <select className={input} value={selection.lead} onChange={(e) => onChange({ ...selection, lead: Number(e.target.value), day: "" })}>
            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n === 0 ? "dia atual" : `+${n} dia(s)`}</option>)}
          </select></label>
      </div>
      <label className="text-xs text-muted-foreground">Data da grade
        <select className={input} value={selection.day} onChange={(e) => onChange({ ...selection, day: e.target.value })}>
          <option value="">Mais recente disponível</option>
          {days.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}
        </select></label>
      {selection.index === "inpe_rf_oficial" ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {RF_KEYS.map((k) => (
            <span key={k} className="flex items-center gap-1 text-[11px]">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: RF_COLORS[k] }} />
              {RF_CLASS_LABEL[k]} {k === "minimo" ? `≤ ${RF_CLASS_LIMITS.minimo}` : k === "critico" ? `> ${RF_CLASS_LIMITS.alto}` : `até ${RF_CLASS_LIMITS[k]}`}
            </span>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {DRY_BINS.map((b) => <span key={b.label} className="flex items-center gap-1 text-[11px]">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />{b.label}</span>)}
          <span className="text-[11px] text-muted-foreground">Faixas de leitura da ARTEMIS, não classes oficiais.</span>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        {isFetching ? "Carregando grade..." : grid
          ? <>Válido em {fmtDay(grid.validDay)} · {grid.unit} · células de {grid.cellDeg}° · gerado em {fmtWhen(grid.computedAt)}.</>
          : "Sem grade para estes parâmetros."}
        {error && !isFetching && " Verifique se a sincronização do INPE já rodou."}
      </p>
      {grid && (
        <>
          <p className="text-[11px] text-muted-foreground">{grid.method?.source ?? "Fonte: Programa Queimadas/INPE (dados abertos)"}. Clique no mapa para consultar a célula; para uma propriedade cadastrada, use o valor calculado sobre o polígono.</p>
          <ButtonCsv grid={grid} />
        </>
      )}
      <p className="flex items-start gap-1 text-[11px] text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Susceptibilidade da vegetação para queimar. Não é foco detectado, incêndio confirmado nem probabilidade calibrada.</p>
    </div>
  );
}

function ButtonCsv({ grid }: { grid: GridResponse }) {
  return (
    <button type="button" onClick={() => downloadCsv(grid)}
      className="inline-flex items-center gap-1 text-xs underline" data-testid="fire-risk-export">
      <Download className="h-3.5 w-3.5" aria-hidden />Exportar grade (CSV)
    </button>
  );
}
