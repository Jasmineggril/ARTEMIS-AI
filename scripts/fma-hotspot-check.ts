/**
 * Empirical check of the FMA implementation with REAL data (not a calibration):
 * for every INMET station-day with a valid FMA, was there an INPE hotspot within
 * 25 km of the station on that local day or the next two? Reports the rate by
 * FMA danger class. A sensible index should show rates increasing with the class.
 *
 *   npx tsx scripts/fma-hotspot-check.ts --from 2026-08-01 --to 2026-10-31 --out fma.json
 */
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { fmaSeries } from "../server/services/inmet-stations";

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const FROM = arg("from", "2026-08-01"), TO = arg("to", "2026-10-31"), KM = Number(arg("km", "25")), OUT = arg("out", "");

async function main() {
  const t0 = Date.now();
  const stations = (await db.execute<{ id: number; code: string; off: number }>(sql`
    SELECT s.id, s.code, s.utc_offset_hours AS off FROM weather_stations s WHERE EXISTS (SELECT 1 FROM weather_station_daily d WHERE d.station_id = s.id AND d.day BETWEEN ${FROM}::date AND ${TO}::date)`)).rows;
  // station-local days with a hotspot within KM (one spatial join, GiST on both sides)
  const hits = (await db.execute<{ id: number; day: string }>(sql`
    SELECT s.id, (h.detected_at + make_interval(hours => s.utc_offset_hours))::date::text AS day
    FROM weather_stations s JOIN satellite_hotspots h ON ST_DWithin(h.geom, s.geom, ${KM * 1000})
    WHERE h.detected_at >= ${FROM}::date - interval '1 day' AND h.detected_at < ${TO}::date + interval '4 days'
    GROUP BY 1, 2`)).rows;
  const hot = new Set(hits.map((h) => `${h.id}|${h.day}`));
  const next = (d: string, k: number) => new Date(Date.parse(d + "T00:00:00Z") + k * 86_400_000).toISOString().slice(0, 10);
  const byClass: Record<string, { n: number; withHotspot: number }> = {};
  let ok = 0, skipped = 0;
  for (const s of stations) {
    const { days } = await fmaSeries(s.id, FROM, TO);
    for (const d of days) {
      if (d.fma == null || d.status !== "ok") { skipped++; continue; }
      ok++;
      const c = (byClass[d.class!] ??= { n: 0, withHotspot: 0 });
      c.n++;
      if ([0, 1, 2].some((k) => hot.has(`${s.id}|${next(d.day, k)}`))) c.withHotspot++;
    }
  }
  const order = ["nulo", "pequeno", "medio", "alto", "muito_alto"];
  const table = order.map((k) => ({ class: k, ...(byClass[k] ?? { n: 0, withHotspot: 0 }), ratePct: byClass[k]?.n ? Math.round((byClass[k].withHotspot / byClass[k].n) * 1000) / 10 : null }));
  const report = {
    period: { from: FROM, to: TO }, radiusKm: KM, window: "dia local e os 2 seguintes", stations: stations.length, stationDaysValid: ok, stationDaysExcluded: skipped,
    excludedReason: "sem dados suficientes ou acumulação iniciada sem zeramento por chuva (possivelmente subestimada)",
    byClass: table, durationS: Math.round((Date.now() - t0) / 1000),
    limits: ["Foco de calor é detecção por satélite, não incêndio confirmado.", "Verifica coerência do índice implementado, não calibra limiares.", "Uma temporada; dias consecutivos da mesma estação não são independentes."],
  };
  if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool?.end());
