/**
 * Screen-space grid clustering for Leaflet (no extra dependency).
 * Points in the same `cellPx` screen cell merge into one numbered bubble, drawn at the
 * cell centre plus a per-layer offset, so bubbles never overlap and stay ≥ 24 px targets; a
 * click on the bubble zooms into its points. From `disableAtZoom` on, every
 * point is drawn individually. Only points inside the visible map (plus a
 * margin) are rendered, so thousands of records stay responsive.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CircleMarker, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

export interface MapPoint { key: string; lat: number; lng: number }

interface Props<T extends MapPoint> {
  points: T[];
  color: string;
  /** Accessible name of the layer, used in cluster tooltips ("12 registros do Sisfogo"). */
  label: string;
  radius?: number;
  cellPx?: number;
  disableAtZoom?: number;
  shape?: "circle" | "diamond";
  /**
   * Pixel offset of this layer's bubbles inside the cell. Layers drawn together use
   * different offsets (e.g. [-15,-10], [15,-10], [0,16]) so their bubbles never coincide:
   * with 60 px cells and 26 px bubbles every pair stays ≥ 30 px apart.
   */
  offset?: [number, number];
  renderPopup: (p: T) => ReactNode;
}

const BUBBLE_PX = 26;

export function ClusteredPoints<T extends MapPoint>({ points, color, label, radius = 4, cellPx = 60, disableAtZoom = 11, shape = "circle", offset = [0, 0], renderPopup }: Props<T>) {
  const map = useMap();
  const [view, setView] = useState(() => ({ zoom: map.getZoom(), bounds: map.getBounds() }));
  useMapEvents({ moveend: () => setView({ zoom: map.getZoom(), bounds: map.getBounds() }) });
  useEffect(() => setView({ zoom: map.getZoom(), bounds: map.getBounds() }), [points, map]);

  const { singles, clusters } = useMemo(() => {
    const padded = view.bounds.pad(0.2);
    const visible = points.filter((p) => padded.contains([p.lat, p.lng]));
    if (view.zoom >= disableAtZoom) return { singles: visible, clusters: [] as { lat: number; lng: number; items: T[] }[] };
    const cells = new Map<string, T[]>();
    for (const p of visible) {
      const px = map.project([p.lat, p.lng], view.zoom);
      const k = `${Math.floor(px.x / cellPx)}:${Math.floor(px.y / cellPx)}`;
      const arr = cells.get(k);
      if (arr) arr.push(p); else cells.set(k, [p]);
    }
    const singles: T[] = [];
    const clusters: { lat: number; lng: number; items: T[] }[] = [];
    cells.forEach((items, k) => {
      if (items.length === 1) { singles.push(items[0]); return; }
      // Anchor at the cell centre: neighbouring bubbles stay a full cell apart (no overlapping targets).
      const [cx, cy] = k.split(":").map(Number);
      const c = map.unproject([(cx + 0.5) * cellPx + offset[0], (cy + 0.5) * cellPx + offset[1]], view.zoom);
      clusters.push({ lat: c.lat, lng: c.lng, items });
    });
    return { singles, clusters };
  }, [points, view, map, cellPx, disableAtZoom, offset[0], offset[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {clusters.map((c) => {
        const n = c.items.length;
        const size = BUBBLE_PX;
        const icon = L.divIcon({
          className: "",
          iconSize: [size, size],
          html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:600 11px system-ui,sans-serif">${n > 999 ? `${Math.round(n / 100) / 10}k` : n}</div>`,
        });
        return (
          <Marker key={`c${c.items[0].key}`} position={[c.lat, c.lng]} icon={icon} keyboard
            eventHandlers={{ click: () => map.fitBounds(L.latLngBounds(c.items.map((p) => [p.lat, p.lng] as [number, number])).pad(0.3), { maxZoom: disableAtZoom }) }}>
            <Tooltip>{n} {label} — clique para aproximar</Tooltip>
          </Marker>
        );
      })}
      {singles.map((p) =>
        shape === "diamond" ? (
          <Marker key={p.key} position={[p.lat, p.lng]} icon={L.divIcon({ className: "", iconSize: [radius * 2 + 4, radius * 2 + 4], html: `<div style="width:${radius * 2}px;height:${radius * 2}px;margin:2px;transform:rotate(45deg);background:${color};border:1px solid #fff"></div>` })}>
            <Popup>{renderPopup(p)}</Popup>
          </Marker>
        ) : (
          <CircleMarker key={p.key} center={[p.lat, p.lng]} radius={radius} pathOptions={{ color: "#fff", weight: 1, fillColor: color, fillOpacity: 0.85 }}>
            <Popup>{renderPopup(p)}</Popup>
          </CircleMarker>
        ),
      )}
    </>
  );
}
