/**
 * Reads a property boundary from a file in the browser:
 *   .geojson/.json  GeoJSON (Feature, FeatureCollection or geometry)
 *   .kml / .kmz     Google Earth (KMZ = zipped KML)
 *   .zip            Shapefile (.shp + .dbf [+ .prj]) — e.g. the CAR "perímetro do imóvel"
 * Only Polygon/MultiPolygon parts are kept; Z values are dropped. Several
 * polygons become one MultiPolygon. The server re-validates everything.
 */
import JSZip from "jszip";
import { kml } from "@tmcw/togeojson";
import shp from "shpjs";
import type { BoundaryGeom, Ring } from "@shared/geometry";

export type BoundarySource = "geojson" | "kml" | "kmz" | "shapefile";
export interface ImportedBoundary { geometry: BoundaryGeom; source: BoundarySource; polygons: number; ignored: number; fileName: string }

const MAX_BYTES = 15 * 1024 * 1024;

function collect(input: any, out: Ring[][], counter: { ignored: number }) {
  if (!input) return;
  if (Array.isArray(input)) return input.forEach((x) => collect(x, out, counter));
  if (input.type === "FeatureCollection") return (input.features ?? []).forEach((f: any) => collect(f, out, counter));
  if (input.type === "Feature") return collect(input.geometry, out, counter);
  if (input.type === "GeometryCollection") return (input.geometries ?? []).forEach((g: any) => collect(g, out, counter));
  const strip = (rings: any[]): Ring[] => rings.map((r: any[]) => r.map((p: number[]) => [Number(p[0]), Number(p[1])] as [number, number]));
  if (input.type === "Polygon") out.push(strip(input.coordinates));
  else if (input.type === "MultiPolygon") input.coordinates.forEach((p: any[]) => out.push(strip(p)));
  else if (input.type) counter.ignored++;
}

function toBoundary(data: unknown, source: BoundarySource, fileName: string): ImportedBoundary {
  const polys: Ring[][] = [];
  const counter = { ignored: 0 };
  collect(data, polys, counter);
  if (!polys.length) throw new Error("Nenhum polígono encontrado no arquivo. Pontos e linhas não delimitam uma área.");
  // close open rings (common in hand-made files); the server still validates
  for (const p of polys) for (const r of p) {
    const [f, l] = [r[0], r[r.length - 1]];
    if (f && l && (f[0] !== l[0] || f[1] !== l[1])) r.push([f[0], f[1]]);
  }
  const geometry: BoundaryGeom = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  return { geometry, source, polygons: polys.length, ignored: counter.ignored, fileName };
}

function parseKml(text: string) {
  const doc = new DOMParser().parseFromString(text, "text/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("KML inválido.");
  return kml(doc);
}

export async function readBoundaryFile(file: File): Promise<ImportedBoundary> {
  if (file.size > MAX_BYTES) throw new Error("Arquivo maior que 15 MB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    let data: unknown;
    try { data = JSON.parse(await file.text()); } catch { throw new Error("GeoJSON inválido (JSON mal formado)."); }
    return toBoundary(data, "geojson", file.name);
  }
  if (name.endsWith(".kml")) return toBoundary(parseKml(await file.text()), "kml", file.name);
  if (name.endsWith(".kmz")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const entry = Object.values(zip.files).find((f) => !f.dir && f.name.toLowerCase().endsWith(".kml"));
    if (!entry) throw new Error("KMZ sem arquivo .kml dentro.");
    return toBoundary(parseKml(await entry.async("text")), "kmz", file.name);
  }
  if (name.endsWith(".zip")) {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files).map((n) => n.toLowerCase());
    if (!names.some((n) => n.endsWith(".shp")) || !names.some((n) => n.endsWith(".dbf"))) {
      throw new Error("O .zip precisa conter o shapefile completo (.shp e .dbf, de preferência com .prj).");
    }
    let data: unknown;
    try { data = await shp(buf); } catch (e) { throw new Error(`Shapefile não pôde ser lido: ${e instanceof Error ? e.message : e}`); }
    return toBoundary(data, "shapefile", file.name);
  }
  throw new Error("Formato não suportado. Use .geojson, .kml, .kmz ou shapefile em .zip.");
}
