/**
 * ARTEMIS AI — HTTP load test against a RUNNING instance (production build
 * recommended; rate limiter disabled ON THAT TEST INSTANCE only).
 * Creates one throw-away account and one property at the place with most INPE
 * detections in the last 7 days, then measures the main read paths and the
 * analysis endpoint. Never point it at a database with real users.
 *
 *   AUTOCANNON=/path/to/autocannon LOAD_BASE_URL=http://localhost:5057 node tests/load/load-test.cjs out.json
 */
const fs = require('node:fs');
const autocannon = require(process.env.AUTOCANNON || 'autocannon');
const BASE = process.env.LOAD_BASE_URL ?? 'http://localhost:5057';
const DUR = Number(process.env.LOAD_SECONDS ?? 20);

async function req(method, path, body, cookie) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get('set-cookie');
  return { status: r.status, cookie: set ? set.split(';')[0] : cookie, body: await r.json().catch(() => null) };
}
const run = (title, opts) => new Promise((resolve, reject) => {
  autocannon({ url: BASE + opts.path, method: opts.method ?? 'GET', connections: opts.connections ?? 10, duration: DUR, headers: { 'X-Forwarded-Proto': 'https', 'Content-Type': 'application/json', ...(opts.cookie ? { Cookie: opts.cookie } : {}) }, body: opts.body }, (err, r) => {
    if (err) return reject(err);
    resolve({ title, url: opts.path, conexoes: opts.connections ?? 10, duracao_s: DUR, req_por_s: Math.round(r.requests.average * 10) / 10, total: r.requests.total,
      '2xx': r['2xx'], nao_2xx: r.non2xx, erros: r.errors, timeouts: r.timeouts, latencia_ms: { p50: r.latency.p50, p97_5: r.latency.p97_5, p99: r.latency.p99, max: r.latency.max } });
  });
});

(async () => {
  const stamp = Date.now();
  const s = await req('POST', '/api/auth/signup', { name: 'Carga', email: `carga${stamp}@load.test`, password: 'Senha.Forte.2026', organizationName: `Carga ${stamp}`, organizationType: 'produtor', acceptPrivacy: true });
  if (s.status !== 201) throw new Error(`cadastro: ${s.status}`);
  const cookie = s.cookie;
  const grid = await req('GET', '/api/public/hotspots/grid?days=7', null, cookie);
  const cell = (grid.body?.cells ?? []).sort((a, b) => b.n - a.n)[0] ?? { lat: -10, lng: -50 };
  const lat = cell.lat ?? cell.latitude, lng = cell.lng ?? cell.longitude;
  const d = 0.02;
  const area = await req('POST', '/api/areas', { name: 'Área de carga', operationType: 'propriedade_rural', municipality: 'Teste', state: 'GO',
    boundary: { type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] } }, cookie);
  if (area.status !== 201) throw new Error(`área: ${area.status} ${JSON.stringify(area.body)}`);
  const id = area.body.id;
  const results = {};
  for (const [k, o] of Object.entries({
    health: { path: '/api/health' },
    'area-surroundings-7d': { path: `/api/areas/${id}/surroundings?days=7`, cookie },
    'area-surroundings-30d': { path: `/api/areas/${id}/surroundings?days=30`, cookie },
    'area-detail': { path: `/api/areas/${id}`, cookie },
    'areas-list': { path: '/api/areas', cookie },
    'hotspots-grid-7d': { path: '/api/public/hotspots/grid?days=7' },
    'sisfogo-summary': { path: '/api/public/sisfogo/summary' },
    analysis: { path: `/api/areas/${id}/analyses`, method: 'POST', cookie, connections: 5,
      body: JSON.stringify({ inputs: { vegetationCondition: 'dry', temperature: 33, humidity: 30, windSpeed: 12, recentRainfall: 0 } }) },
  })) { results[k] = await run(k, o); console.log(k, JSON.stringify(results[k])); }
  const out = { base: BASE, data: new Date().toISOString(), areaId: id, centro: { lat, lng }, resultados: results };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
})().catch((e) => { console.error(e); process.exitCode = 1; });
