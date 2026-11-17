/**
 * Property boundary geometry (GeoJSON, WGS 84, [longitude, latitude]).
 * Shared by the browser (live feedback while drawing/importing) and the server
 * (authoritative validation). No external dependency.
 *
 * Area: spherical polygon area on the WGS 84 equatorial radius (same method as
 * Turf/Leaflet.draw); error vs. an ellipsoidal calculation is well under 1 %
 * for property-sized polygons. It is a CALCULATED value, labelled as such.
 */
export type Position = [number, number];
export type Ring = Position[];
export interface PolygonGeom { type: "Polygon"; coordinates: Ring[] }
export interface MultiPolygonGeom { type: "MultiPolygon"; coordinates: Ring[][] }
export type BoundaryGeom = PolygonGeom | MultiPolygonGeom;

const R = 6378137;
const rad = (d: number) => (d * Math.PI) / 180;

/** Generous box around Brazil (incl. oceanic islands). */
export const BRAZIL_BOX = { minLng: -74.1, maxLng: -28.5, minLat: -34.9, maxLat: 5.4 };

export function ringAreaM2(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += rad(x2 - x1) * (2 + Math.sin(rad(y1)) + Math.sin(rad(y2)));
  }
  return Math.abs((a * R * R) / 2);
}

export const polygons = (g: BoundaryGeom): Ring[][] => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);

export function areaHa(g: BoundaryGeom): number {
  let m2 = 0;
  for (const p of polygons(g)) {
    m2 += ringAreaM2(p[0]);
    for (const hole of p.slice(1)) m2 -= ringAreaM2(hole);
  }
  return m2 / 10_000;
}

function orient(a: Position, b: Position, c: Position) {
  const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  return Math.abs(v) < 1e-15 ? 0 : v > 0 ? 1 : 2;
}
function onSeg(a: Position, b: Position, c: Position) {
  return Math.min(a[0], c[0]) <= b[0] && b[0] <= Math.max(a[0], c[0]) && Math.min(a[1], c[1]) <= b[1] && b[1] <= Math.max(a[1], c[1]);
}
function segmentsIntersect(p1: Position, q1: Position, p2: Position, q2: Position) {
  const o1 = orient(p1, q1, p2), o2 = orient(p1, q1, q2), o3 = orient(p2, q2, p1), o4 = orient(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSeg(p1, p2, q1)) || (o2 === 0 && onSeg(p1, q2, q1)) || (o3 === 0 && onSeg(p2, p1, q2)) || (o4 === 0 && onSeg(p2, q1, q2));
}

/** True if any two non-adjacent edges of the ring touch or cross (a "bow-tie"). */
export function ringSelfIntersects(ring: Ring): boolean {
  const n = ring.length - 1; // closed ring: last == first
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

export function bbox(g: BoundaryGeom) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const p of polygons(g)) for (const [x, y] of p[0]) {
    if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
    if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function pointInRing([x, y]: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function pointInBoundary(pt: Position, g: BoundaryGeom): boolean {
  return polygons(g).some((p) => pointInRing(pt, p[0]) && !p.slice(1).some((h) => pointInRing(pt, h)));
}

/** Area-weighted centroid of the outer rings (planar; fine at property scale). Falls back to a vertex mean. */
export function centroid(g: BoundaryGeom): Position {
  let ax = 0, ay = 0, aw = 0;
  for (const p of polygons(g)) {
    const r = p[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < r.length - 1; i++) {
      const f = r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
      a += f; cx += (r[i][0] + r[i + 1][0]) * f; cy += (r[i][1] + r[i + 1][1]) * f;
    }
    if (Math.abs(a) > 1e-14) { ax += cx / 3; ay += cy / 3; aw += a; }
  }
  if (Math.abs(aw) > 1e-14) return [ax / aw, ay / aw];
  const pts = polygons(g).flatMap((p) => p[0]);
  return [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
}

export function haversineKm(a: Position, b: Position): number {
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}

/** Distance (km) from a point to the boundary: 0 if inside, else to the nearest edge (local equirectangular projection). */
export function distanceToBoundaryKm(pt: Position, g: BoundaryGeom): number {
  if (pointInBoundary(pt, g)) return 0;
  const kx = 111.32 * Math.cos(rad(pt[1])), ky = 110.574;
  let best = Infinity;
  for (const p of polygons(g)) for (const r of p) for (let i = 0; i < r.length - 1; i++) {
    const ax = (r[i][0] - pt[0]) * kx, ay = (r[i][1] - pt[1]) * ky, bx = (r[i + 1][0] - pt[0]) * kx, by = (r[i + 1][1] - pt[1]) * ky;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}

export interface BoundaryCheck { ok: boolean; errors: string[]; warnings: string[]; areaHa: number | null; centroid: Position | null; vertices: number }

/** Full validation used by the server before storing a boundary. */
export function validateBoundary(g: BoundaryGeom, opts: { maxHa?: number; minHa?: number } = {}): BoundaryCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  let vertices = 0;
  const polys = polygons(g);
  for (let pi = 0; pi < polys.length; pi++) {
    const p = polys[pi];
    for (let ri = 0; ri < p.length; ri++) {
      const r: Ring = p[ri];
      const label = `${polys.length > 1 ? `polígono ${pi + 1}, ` : ""}${ri === 0 ? "limite externo" : `buraco ${ri}`}`;
      vertices += r.length - 1;
      if (r.length < 4) { errors.push(`${label}: precisa de pelo menos 3 vértices.`); continue; }
      const [f, l] = [r[0], r[r.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) { errors.push(`${label}: o anel não está fechado.`); continue; }
      if (r.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) { errors.push(`${label}: coordenada inválida.`); continue; }
      if (r.some(([x, y]) => x < BRAZIL_BOX.minLng || x > BRAZIL_BOX.maxLng || y < BRAZIL_BOX.minLat || y > BRAZIL_BOX.maxLat)) {
        errors.push(`${label}: há vértices fora do Brasil. Confira se as coordenadas estão em [longitude, latitude] e em graus decimais (WGS 84).`);
        continue;
      }
      if (r.length - 1 <= 2500 && ringSelfIntersects(r)) errors.push(`${label}: as bordas se cruzam (polígono inválido). Redesenhe sem cruzar linhas.`);
      if (r.length - 1 > 2500) warnings.push(`${label}: ${r.length - 1} vértices — verificação de cruzamento de bordas não realizada (limite 2.500).`);
    }
  }
  if (errors.length) return { ok: false, errors, warnings, areaHa: null, centroid: null, vertices };
  const ha = areaHa(g);
  const minHa = opts.minHa ?? 0.01, maxHa = opts.maxHa ?? 5_000_000;
  if (ha < minHa) errors.push(`Área calculada muito pequena (${ha.toFixed(4)} ha). Confira o desenho.`);
  if (ha > maxHa) errors.push(`Área calculada muito grande (${Math.round(ha).toLocaleString("pt-BR")} ha). Confira o arquivo.`);
  return { ok: errors.length === 0, errors, warnings, areaHa: ha, centroid: centroid(g), vertices };
}
