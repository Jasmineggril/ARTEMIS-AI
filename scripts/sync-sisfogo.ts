/**
 * Sisfogo ROI sync (read-only on the Sisfogo side; idempotent on ours).
 *   npm run sync:sisfogo                         -> incremental: newest first, stops after 2 pages with nothing new
 *   npm run sync:sisfogo -- --mode completa      -> reads every page; also flags ROIs no longer published
 *   npm run sync:sisfogo -- --resume             -> continues after the last page stored by a failed run
 *   npm run sync:sisfogo -- --max-pages 1        -> quick check against the live API
 *   options: --page-size N (1..50, default 20)  --max-records N
 * Exit codes: 0 success, 1 failure (recorded in source_sync_runs), 75 another sync is running.
 * Suggested cron: incremental daily, complete weekly (docs/artemis/11_SISFOGO.md).
 */
import { syncSisfogo, SisfogoBusyError, type SyncMode } from "../server/services/sisfogo-sync";
import { pool } from "../server/db";

const KNOWN = new Set(["--mode", "--resume", "--max-pages", "--max-records", "--page-size", "--trigger"]);
function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const intArg = (name: string) => {
  const v = arg(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} deve ser inteiro >= 1.`);
  return n;
};

async function main() {
  const unknown = process.argv.slice(2).filter((a) => a.startsWith("--") && !KNOWN.has(a));
  if (unknown.length) throw new Error(`Opção desconhecida: ${unknown.join(" ")}`);
  const mode = (arg("mode") ?? "incremental") as SyncMode;
  if (!["incremental", "completa"].includes(mode)) throw new Error("--mode deve ser incremental ou completa.");
  const trigger = arg("trigger") === "agendado" ? "agendado" : "cli";
  const r = await syncSisfogo({
    mode, resume: process.argv.includes("--resume"), maxPages: intArg("max-pages"),
    maxRecords: intArg("max-records"), pageSize: intArg("page-size"), trigger,
  });
  console.log(JSON.stringify({ result: r }));
  process.exitCode = r.status === "falha" ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = e instanceof SisfogoBusyError ? 75 : 1;
  })
  .finally(() => pool?.end());
