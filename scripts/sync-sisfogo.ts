/**
 * Sync Sisfogo public ROI records (idempotent upsert by ROI id).
 *   npm run sync:sisfogo                    -> up to 2000 pages of 500
 *   npm run sync:sisfogo -- --max-pages 2   -> quick check against the live API
 * Exit code 1 on failure (recorded in source_sync_runs). Pages already stored
 * before a failure are kept; re-running is safe.
 */
import { syncSisfogo } from "../server/connectors/sisfogo";
import { pool } from "../server/db";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const maxPages = arg("max-pages") ? Number(arg("max-pages")) : undefined;
  if (maxPages !== undefined && !(Number.isInteger(maxPages) && maxPages >= 1)) throw new Error("--max-pages deve ser inteiro >= 1.");
  const r = await syncSisfogo({ maxPages });
  console.log(JSON.stringify({ source: "sisfogo-roi", ...r }));
  process.exitCode = r.status === "falha" ? 1 : 0;
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool?.end());
