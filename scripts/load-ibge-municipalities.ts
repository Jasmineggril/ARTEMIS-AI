/**
 * Load the official municipality list (IBGE — API de Localidades) into the
 * `municipalities` table. Idempotent upsert by IBGE code.
 *   npm run db:load-municipalities
 *   npm run db:load-municipalities -- --file municipios.json   (offline: same JSON format)
 * Source: https://servicodados.ibge.gov.br/api/v1/localidades/municipios
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";
import { municipalities } from "../shared/schema";
import { normalizeMunicipalityName } from "../server/routes";

const URL_IBGE = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios";

interface IbgeMunicipio {
  id: number;
  nome: string;
  microrregiao?: { mesorregiao?: { UF?: { sigla?: string } } } | null;
  "regiao-imediata"?: { "regiao-intermediaria"?: { UF?: { sigla?: string } } } | null;
}

async function fetchWithRetry(url: string, tries = 4): Promise<unknown> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 60_000);
      const r = await fetch(url, { signal: c.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`IBGE HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
      const wait = 2000 * 2 ** i;
      console.warn(`[ibge] tentativa ${i + 1} falhou (${e instanceof Error ? e.message : e}); nova tentativa em ${wait / 1000}s`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw last;
}

export function toRows(list: IbgeMunicipio[]) {
  const rows = [];
  const rejected: string[] = [];
  for (const m of list) {
    const uf = m.microrregiao?.mesorregiao?.UF?.sigla ?? m["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla;
    const code = String(m.id);
    if (!/^\d{7}$/.test(code) || !uf || !m.nome) { rejected.push(code); continue; }
    rows.push({ ibgeCode: code, name: m.nome, state: uf, nameNormalized: normalizeMunicipalityName(m.nome) });
  }
  return { rows, rejected };
}

async function main() {
  const i = process.argv.indexOf("--file");
  const data = (i >= 0 ? JSON.parse(readFileSync(process.argv[i + 1], "utf8")) : await fetchWithRetry(URL_IBGE)) as IbgeMunicipio[];
  if (!Array.isArray(data) || data.length < 5000) throw new Error(`Resposta inesperada do IBGE (${Array.isArray(data) ? data.length : typeof data} itens).`);
  const { rows, rejected } = toRows(data);
  await db.transaction(async (tx) => {
    for (let k = 0; k < rows.length; k += 1000) {
      await tx.insert(municipalities).values(rows.slice(k, k + 1000)).onConflictDoUpdate({
        target: municipalities.ibgeCode,
        set: { name: sql`excluded.name`, state: sql`excluded.state`, nameNormalized: sql`excluded.name_normalized`, loadedAt: sql`now()` },
      });
    }
  });
  console.log(JSON.stringify({ source: "ibge-localidades", loaded: rows.length, rejected: rejected.length }));
}

main().catch((e) => { console.error("[ibge] falhou:", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => pool?.end());
