/**
 * ARTEMIS AI — resilience checks against a RUNNING local stack. It stops and
 * starts real services, so run it ONLY on a test machine (never production).
 *
 *   RES_BASE_URL=http://localhost:5057 \
 *   RES_ENGINE_STOP="pkill -f '[u]vicorn app:app'" RES_ENGINE_START="bash -c 'cd python_service && nohup python -m uvicorn app:app --port 8000 >/dev/null 2>&1 &'" \
 *   RES_DB_STOP="service postgresql stop" RES_DB_START="service postgresql start" \
 *   RES_APP_STOP="pkill -f '[n]ode dist/index.cjs'" RES_APP_START="bash -c 'nohup /path/start.sh >/dev/null 2>&1 &'" \
 *   node tests/resilience/resilience-check.cjs report.json
 *
 * Scenarios:
 *  1. risk engine (Python) down → analysis still produced by the TypeScript
 *     fallback, recorded as such; back to Python after restart;
 *  2. database down → /api/health reports it (503) without crashing; the API
 *     recovers by itself when the database returns (no app restart);
 *  3. application restart → all data still there (same counts), health OK.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const BASE = process.env.RES_BASE_URL ?? 'http://localhost:5057';
const sh = (c) => execSync(c, { stdio: 'ignore', shell: '/bin/bash' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (scenario, name, ok, detail = '') => { results.push({ scenario, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${scenario}] ${name}${detail ? ` — ${detail}` : ''}`); };
let cookie = '';
async function req(method, path, body) {
  try {
    const r = await fetch(BASE + path, { method, signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch (e) { return { status: 0, error: e.message }; }
}
async function until(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return Date.now() - t; await wait(1000); } return null; }

(async () => {
  const stamp = Date.now();
  const s = await req('POST', '/api/auth/signup', { name: 'Resiliência', email: `res${stamp}@res.test`, password: 'Senha.Forte.2026', organizationName: `Res ${stamp}`, organizationType: 'produtor', acceptPrivacy: true });
  if (s.status !== 201) throw new Error(`cadastro ${s.status}`);
  const area = await req('POST', '/api/areas', { name: 'Área resiliência', operationType: 'propriedade_rural', municipality: 'Alto Paraíso de Goiás', state: 'GO', latitude: -14.13, longitude: -47.51 });
  const id = area.body.id;
  const inputs = { inputs: { vegetationCondition: 'dry', temperature: 34, humidity: 25, windSpeed: 18, recentRainfall: 0, nearbyHotspot: false } };

  // 1. Risk engine down
  const a0 = await req('POST', `/api/areas/${id}/analyses`, inputs);
  check('motor', 'análise com o motor Python no ar', a0.status === 201, a0.body?.engineType);
  sh(process.env.RES_ENGINE_STOP); await wait(2000);
  const a1 = await req('POST', `/api/areas/${id}/analyses`, inputs);
  check('motor', 'motor fora do ar → análise feita pelo fallback TypeScript e registrada como tal', a1.status === 201 && /typescript|ts/i.test(`${a1.body?.engineType} ${a1.body?.modelVersion}`), `${a1.body?.engineType} ${a1.body?.modelVersion ?? ''}`);
  check('motor', 'mesma entrada → mesma pontuação nos dois motores', a0.body?.score === a1.body?.score, `${a0.body?.score} × ${a1.body?.score}`);
  sh(process.env.RES_ENGINE_START);
  const back = await until(async () => (await req('POST', `/api/areas/${id}/analyses`, inputs)).body?.engineType === a0.body?.engineType, 60000);
  check('motor', 'motor Python volta a ser usado após reiniciar', back !== null, back !== null ? `${Math.round(back / 1000)} s` : 'não voltou');

  // 2. Database down
  const before = await req('GET', `/api/areas/${id}/analyses`);
  const nBefore = Array.isArray(before.body) ? before.body.length : before.body?.items?.length;
  sh(process.env.RES_DB_STOP); await wait(3000);
  const h = await req('GET', '/api/health');
  check('banco', 'banco fora do ar → /api/health responde 503 indicando o banco', h.status === 503 && h.body?.database === 'down', `HTTP ${h.status} ${JSON.stringify(h.body)?.slice(0, 120)}`);
  const l = await req('GET', '/api/areas');
  check('banco', 'requisição de dados falha com erro controlado (sem queda do processo)', l.status >= 500 && l.status < 600, `HTTP ${l.status}`);
  sh(process.env.RES_DB_START);
  const rec = await until(async () => (await req('GET', '/api/health')).status === 200, 90000);
  check('banco', 'API se recupera sozinha quando o banco volta', rec !== null, rec !== null ? `${Math.round(rec / 1000)} s` : 'não recuperou');
  const after = await req('GET', `/api/areas/${id}/analyses`);
  check('banco', 'sessão e dados preservados após a queda do banco', after.status === 200, `HTTP ${after.status}`);

  // 3. Application restart
  sh(process.env.RES_APP_STOP); await wait(2000);
  check('reinício', 'aplicação parada', (await req('GET', '/api/health')).status === 0);
  sh(process.env.RES_APP_START);
  const up = await until(async () => (await req('GET', '/api/health')).status === 200, 90000);
  check('reinício', 'aplicação volta a responder', up !== null, up !== null ? `${Math.round(up / 1000)} s` : 'não voltou');
  const after2 = await req('GET', `/api/areas/${id}/analyses`);
  const nAfter = Array.isArray(after2.body) ? after2.body.length : after2.body?.items?.length;
  check('reinício', 'sessão persistida (login continua válido) e análises preservadas', after2.status === 200 && nAfter >= nBefore, `antes ${nBefore}, depois ${nAfter}`);

  const failed = results.filter((r) => !r.ok).length;
  const report = { base: BASE, ranAt: new Date().toISOString(), total: results.length, passed: results.length - failed, failed, results };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  console.log(`\nRESULTADO: ${report.passed}/${report.total}`);
  process.exitCode = failed ? 1 : 0;
})();
