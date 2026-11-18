/**
 * Draw a property boundary on the map (click to add vertices) or show an
 * imported one. Live feedback uses the same geometry code as the server:
 * calculated area, crossing edges. The server re-validates on save.
 */
import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Polygon, Polyline, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { Undo2, Check, Trash2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { areaHa, ringSelfIntersects, polygons, type BoundaryGeom, type Position, type Ring } from "@shared/geometry";

interface Props {
  value: BoundaryGeom | null;
  onChange: (g: BoundaryGeom | null, source: "desenho" | null) => void;
  center?: [number, number] | null; // [lat, lng]
}

function Fit({ g, center }: { g: BoundaryGeom | null; center?: [number, number] | null }) {
  const map = useMap();
  const key = g ? JSON.stringify(polygons(g)[0][0].slice(0, 3)) : center ? center.join(",") : "br";
  useEffect(() => {
    if (g) map.fitBounds(L.latLngBounds(polygons(g).flatMap((p) => p[0].map(([x, y]) => [y, x] as [number, number]))), { padding: [20, 20], maxZoom: 16, animate: false });
    else if (center) map.setView(center, 14, { animate: false });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Clicks({ active, onAdd }: { active: boolean; onAdd: (p: Position) => void }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    el.style.cursor = active ? "crosshair" : "";
    if (active) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  }, [active, map]);
  useMapEvents({ click: (e) => active && onAdd([Math.round(e.latlng.lng * 1e7) / 1e7, Math.round(e.latlng.lat * 1e7) / 1e7]) });
  return null;
}

export function BoundaryEditor({ value, onChange, center }: Props) {
  const [drawing, setDrawing] = useState(false);
  const [pts, setPts] = useState<Position[]>([]);

  const draftRing: Ring | null = pts.length >= 3 ? [...pts, pts[0]] : null;
  const draftCrosses = draftRing ? ringSelfIntersects(draftRing) : false;
  const draftHa = draftRing && !draftCrosses ? areaHa({ type: "Polygon", coordinates: [draftRing] }) : null;
  const currentHa = useMemo(() => (value ? areaHa(value) : null), [value]);
  const fmt = (ha: number) => ha.toLocaleString("pt-BR", { maximumFractionDigits: ha < 10 ? 2 : 1 });

  function finish() {
    if (!draftRing || draftCrosses) return;
    onChange({ type: "Polygon", coordinates: [draftRing] }, "desenho");
    setDrawing(false);
    setPts([]);
  }

  return (
    <div className="space-y-2">
      <div className="h-72 rounded-xl overflow-hidden border relative" role="application" aria-label="Mapa para desenhar o limite da propriedade">
        <MapContainer center={center ?? [-14.5, -52]} zoom={center ? 14 : 4} className="h-full w-full" scrollWheelZoom attributionControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Fit g={drawing ? null : value} center={center} />
          <Clicks active={drawing} onAdd={(p) => setPts((a) => [...a, p])} />
          {!drawing && value && polygons(value).map((p, i) => (
            <Polygon key={i} positions={p.map((r) => r.map(([x, y]) => [y, x] as [number, number]))} pathOptions={{ color: "#0f5132", weight: 2, fillOpacity: 0.15 }} />
          ))}
          {drawing && pts.length > 1 && <Polyline positions={(draftRing ?? pts).map(([x, y]) => [y, x] as [number, number])} pathOptions={{ color: draftCrosses ? "#b91c1c" : "#0f5132", weight: 2, dashArray: "5" }} />}
          {drawing && pts.map(([x, y], i) => <CircleMarker key={i} center={[y, x]} radius={4} pathOptions={{ color: "#fff", weight: 2, fillColor: "#0f5132", fillOpacity: 1 }} />)}
        </MapContainer>
        {drawing && (
          <p className="absolute top-2 left-2 right-2 z-[500] rounded-lg bg-white/95 border px-2 py-1 text-xs shadow">
            Clique no mapa para marcar os vértices do limite, na ordem. Use zoom e arraste para se localizar.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {!drawing ? (
          <>
            <Button type="button" size="sm" variant="outline" onClick={() => { setDrawing(true); setPts([]); }} data-testid="button-draw-boundary">
              <PenLine className="w-4 h-4 mr-1" aria-hidden />{value ? "Redesenhar" : "Desenhar no mapa"}
            </Button>
            {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null, null)}><Trash2 className="w-4 h-4 mr-1" aria-hidden />Remover limite</Button>}
            {currentHa != null && <span className="text-muted-foreground">Área calculada do polígono: <strong className="text-foreground">{fmt(currentHa)} ha</strong></span>}
          </>
        ) : (
          <>
            <Button type="button" size="sm" onClick={finish} disabled={!draftRing || draftCrosses} data-testid="button-finish-boundary"><Check className="w-4 h-4 mr-1" aria-hidden />Concluir</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPts((a) => a.slice(0, -1))} disabled={!pts.length}><Undo2 className="w-4 h-4 mr-1" aria-hidden />Desfazer ponto</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setDrawing(false); setPts([]); }}>Cancelar</Button>
            <span className={draftCrosses ? "text-red-700 font-medium" : "text-muted-foreground"} role="status">
              {pts.length} vértice(s){draftCrosses ? " — as bordas se cruzam; desfaça o último ponto" : draftHa != null ? ` · ${fmt(draftHa)} ha` : pts.length < 3 ? " (mínimo 3)" : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
