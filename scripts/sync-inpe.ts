/**
 * Sync INPE satellite fire detections (incremental, idempotent).
 *   npm run sync:inpe                 -> today + yesterday (UTC) — schedule hourly via cron
 *   npm run sync:inpe -- --days 7     -> last 7 days
 *   npm run sync:inpe -- --from 2026-11-01 --to 2026-11-10   (backfill, max 62 days)
 * Exit code 1 if any day failed (cron can alert on it). Failures are recorded
 * in source_sync_runs; a failed day leaves no partial rows.
 */
import { syncInpeDay, recentUtcDays } from "../server/connectors/inpe";
import { evaluateHotspotAlerts } from "../server/services/hotspot-alerts";
import { pool } from "../server/db";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  let days: string[];
  const from = arg("from"), to = arg("to");
  if (from && to) {
    const a = Date.parse(`${from}T00:00:00Z`), b = Date.parse(`${to}T00:00:00Z`);
    if (!(a <= b) || (b - a) / 86_400_000 > 61) throw new Error("Intervalo inválido (máx. 62 dias).");
    days = [];
    for (let t = a; t <= b; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  } else {
    days = recentUtcDays(Math.min(Math.max(Number(arg("days") ?? 2), 1), 62));
  }
  let failed = 0;
  for (const day of days) {
    const r = await syncInpeDay(day);
    console.log(JSON.stringify({ source: "inpe-queimadas", ...r }));
    if (r.status === "falha") failed++;
  }
  // Detected-condition alerts: hotspots in/near monitored properties (last 24 h).
  const alerts = await evaluateHotspotAlerts({ windowHours: 24 });
  console.log(JSON.stringify({ source: "hotspot-alerts", ...alerts }));
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool?.end());
