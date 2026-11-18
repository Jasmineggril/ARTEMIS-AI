/**
 * INMET sync (official station observations).
 *   npm run sync:inmet -- --stations            -> station registry (apitempo /estacoes/T)
 *   npm run sync:inmet -- --year 2026           -> yearly archive (incremental: unchanged file is skipped)
 *   npm run sync:inmet -- --year 2025 --force   -> reprocess even if the archive did not change
 *   npm run sync:inmet                          -> stations + current year (what the scheduler runs)
 * Exit code 1 on failure (failures are recorded in source_sync_runs).
 */
import { syncInmetStations } from "../server/connectors/inmet";
import { syncInmetYear } from "../server/services/inmet-sync";
import { pool } from "../server/db";

const has = (n: string) => process.argv.includes(`--${n}`);
const years = process.argv.flatMap((a, i) => (a === "--year" ? [Number(process.argv[i + 1])] : []));

async function main() {
  let failed = 0;
  if (has("stations") || !years.length) {
    const s = await syncInmetStations();
    console.log(JSON.stringify({ source: "inmet-estacoes", kind: "estacoes", ...s }));
    if (s.status === "falha") failed++;
  }
  for (const y of years.length ? years : has("stations") ? [] : [new Date().getUTCFullYear()]) {
    const r = await syncInmetYear(y, { force: has("force"), trigger: "cli" });
    console.log(JSON.stringify({ source: "inmet-estacoes", kind: "ano", ...r }));
    if (r.status === "falha") failed++;
  }
  process.exitCode = failed ? 1 : 0;
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool?.end());
