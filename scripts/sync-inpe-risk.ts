/**
 * INPE official fire risk (model 2.2) → fire_risk_values (areas, INMET stations) + fire_risk_grids (map).
 *   npm run sync:inpe-risk                                  -> last 3 observed days + forecast T0–T3 (what the scheduler runs)
 *   npm run sync:inpe-risk -- --from 2026-08-01 --to 2026-11-22   (observed backfill; INPE keeps ~10 months online)
 *   npm run sync:inpe-risk -- --forecast                    -> forecast only
 *   add --dry-days to the backfill to also load "dias sem chuva" grids
 * Exit code 1 if any file failed (failures are recorded in source_sync_runs).
 */
import { syncDryDays, syncForecast, syncObserved, syncRecentRisk } from "../server/services/inpe-fire-risk-sync";
import { pool } from "../server/db";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
async function main() {
  const from = arg("from"), to = arg("to");
  let results: { status: string }[];
  if (from && to) {
    const days: string[] = [];
    for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
    if (days.length > 400) throw new Error("Intervalo máximo de 400 dias.");
    results = [...(await syncObserved(days)), ...(process.argv.includes("--dry-days") ? await syncDryDays(days) : [])];
  } else if (process.argv.includes("--forecast")) results = await syncForecast();
  else { const r = await syncRecentRisk(3); results = [...r.observado, ...r.previsto, ...r.diasSemChuva]; }
  for (const r of results) console.log(JSON.stringify({ source: "inpe-risco-fogo", ...r }));
  process.exitCode = results.some((r) => r.status === "falha") ? 1 : 0;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool?.end());
