/**
 * ARTEMIS AI — automated security checks against a RUNNING instance (use a
 * production build: `npm run build && NODE_ENV=production node dist/index.cjs`).
 * Creates two throw-away accounts. Never point it at a database with real users.
 *
 *   SEC_BASE_URL=http://localhost:5057 node tests/security/security-check.cjs [report.json]
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const BASE = process.env.SEC_BASE_URL ?? 'http://localhost:5057';
const results = [];
const check = (area, name, ok, detail = '') => { results.push({ area, name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} [${area}] ${name}${detail ? ` — ${detail}` : ''}`); };

class C {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { 'X-Forwarded-Proto': 'https', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) { this.cookie = sc.split(';')[0]; this.lastSetCookie = sc; }
    const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = t; }
    return { status: r.status, body: j, text: t, headers: r.headers };
  }
}

(async () => {
  const stamp = Date.now();
  const A = new C(), B = new C(), anon = new C();

  // 1. Headers
  const home = await anon.req('GET', '/', undefined, { 'X-Forwarded-Proto': 'https' });
  const h = (k) => home.headers.get(k) ?? '';
  check('cabeçalhos', 'Content-Security-Policy presente', /default-src/.test(h('content-security-policy')), h('content-security-policy').slice(0, 80));
  check('cabeçalhos', "CSP sem 'unsafe-eval'", !/unsafe-eval/.test(h('content-security-policy')));
  check('cabeçalhos', 'X-Content-Type-Options: nosniff', h('x-content-type-options') === 'nosniff');
  check('cabeçalhos', 'X-Frame-Options: DENY (anti-clickjacking)', h('x-frame-options') === 'DENY');
  check('cabeçalhos', 'Referrer-Policy definido', !!h('referrer-policy'));
  check('cabeçalhos', 'HSTS em produção', /max-age=\d{7,}/.test(h('strict-transport-security')), h('strict-transport-security'));
  check('cabeçalhos', 'X-Powered-By ausente', !home.headers.get('x-powered-by'));

  // 2. Accounts and session cookie
  const weak = await A.req('POST', '/api/auth/signup', { name: 'Fraca', email: `fraca${stamp}@sec.test`, password: '123', organizationName: 'X', organizationType: 'produtor', acceptPrivacy: true });
  check('autenticação', 'senha fraca recusada', weak.status === 400, weak.body?.message);
  const sa = await A.req('POST', '/api/auth/signup', { name: 'Sec A', email: `seca${stamp}@sec.test`, password: 'Senha.Forte.2026', organizationName: 'Org Sec A', organizationType: 'produtor', acceptPrivacy: true }, { 'X-Forwarded-Proto': 'https' });
  const ck = A.lastSetCookie ?? '';
  check('sessão', 'cookie HttpOnly', /HttpOnly/i.test(ck));
  check('sessão', 'cookie SameSite=Lax', /SameSite=Lax/i.test(ck));
  check('sessão', 'cookie Secure atrás de HTTPS', /Secure/i.test(ck), ck.replace(/=.*?;/, '=…;').slice(0, 90));
  await B.req('POST', '/api/auth/signup', { name: 'Sec B', email: `secb${stamp}@sec.test`, password: 'Senha.Forte.2026', organizationName: 'Org Sec B', organizationType: 'produtor', acceptPrivacy: true });
  check('autenticação', 'cadastro A ok', sa.status === 201);

  const l1 = await anon.req('POST', '/api/auth/login', { email: `seca${stamp}@sec.test`, password: 'errada-123' });
  const l2 = await anon.req('POST', '/api/auth/login', { email: `ninguem${stamp}@sec.test`, password: 'errada-123' });
  check('autenticação', 'mensagem de login não revela se o e-mail existe', l1.status === 401 && l2.status === 401 && l1.body?.message === l2.body?.message);
  const rr1 = await anon.req('POST', '/api/auth/password-reset/request', { email: `seca${stamp}@sec.test` });
  const rr2 = await anon.req('POST', '/api/auth/password-reset/request', { email: `ninguem${stamp}@sec.test` });
  check('autenticação', 'recuperação de senha não revela se o e-mail existe', rr1.body?.message === rr2.body?.message);

  // 3. Unauthenticated access
  const protectedGets = ['/api/areas', '/api/alerts', '/api/dashboard/summary', '/api/fire-occurrences', '/api/insights', '/api/organization/members', '/api/audit-logs', '/api/admin/overview', '/api/admin/users', '/api/admin/operations', '/api/admin/feedback', '/api/connectors/sisfogo/status', '/api/import-batches'];
  const unauth = [];
  for (const p of protectedGets) { const r = await anon.req('GET', p); if (![401, 403].includes(r.status)) unauth.push(`${p}→${r.status}`); }
  check('autorização', `${protectedGets.length} rotas protegidas exigem login`, unauth.length === 0, unauth.join(', '));

  // 4. Isolation between organisations (IDOR)
  const d = 0.009;
  const area = await A.req('POST', '/api/areas', { name: 'Área privada A', operationType: 'propriedade_rural', municipality: 'Alto Paraíso de Goiás', state: 'GO', boundary: { type: 'Polygon', coordinates: [[[-47.51, -14.13], [-47.51 + d, -14.13], [-47.51 + d, -14.13 + d], [-47.51, -14.13 + d], [-47.51, -14.13]]] } });
  const id = area.body?.id;
  const idor = [];
  for (const [m, p, b] of [['GET', `/api/areas/${id}`], ['GET', `/api/areas/${id}/surroundings`], ['GET', `/api/reports/areas/${id}`], ['GET', `/api/reports/areas/${id}/analyses.csv`], ['PATCH', `/api/areas/${id}`, { name: 'invadido' }], ['DELETE', `/api/areas/${id}`], ['POST', `/api/areas/${id}/analyses`, { inputs: { vegetationCondition: 'dry', temperature: 30, humidity: 30, windSpeed: 10, recentRainfall: 0, nearbyHotspot: false } }]]) {
    const r = await B.req(m, p, b); if (![403, 404].includes(r.status)) idor.push(`${m} ${p}→${r.status}`);
  }
  const still = await A.req('GET', `/api/areas/${id}`);
  check('isolamento', 'outra organização não lê, altera, analisa nem apaga a área', idor.length === 0 && still.body?.name === 'Área privada A', idor.join(', '));
  const listB = await B.req('GET', '/api/areas');
  check('isolamento', 'lista de áreas da outra organização não contém a área', Array.isArray(listB.body) && !listB.body.some((a) => a.id === id));
  const adminAsOwner = await A.req('GET', '/api/admin/overview');
  check('autorização', 'proprietário de organização não acessa o painel da plataforma', adminAsOwner.status === 403);
  const sync = await A.req('POST', '/api/admin/connectors/sisfogo/sync', { mode: 'incremental' });
  check('autorização', 'sincronização manual restrita ao administrador da plataforma', sync.status === 403);

  // 5. CSRF (cross-site POST with the victim's cookie)
  const csrf = await A.req('POST', '/api/areas', { name: 'csrf', operationType: 'outro', municipality: 'X', state: 'GO', latitude: -14, longitude: -47 }, { Origin: 'https://site-malicioso.example' });
  check('csrf', 'POST com Origin de outro site é recusado', csrf.status === 403, String(csrf.status));

  // 6. Injection probes (parameterised queries; validation)
  const probes = [
    ['/api/public/sisfogo/summary?state=' + encodeURIComponent("' OR 1=1--"), 400],
    ['/api/public/sisfogo/points?bbox=' + encodeURIComponent('1,2,3,4); DROP TABLE users;--'), 400],
    ['/api/public/sisfogo/summary?municipality=' + encodeURIComponent("x' OR '1'='1"), 200],
    ['/api/public/hotspots?state=GO&municipality=' + encodeURIComponent("'; SELECT pg_sleep(5);--"), 200],
  ];
  const inj = [];
  for (const [p, want] of probes) { const t = Date.now(); const r = await anon.req('GET', p); if (r.status !== want || Date.now() - t > 3000 || /syntax error|pg_|stack/i.test(r.text)) inj.push(`${p.slice(0, 50)}→${r.status}`); }
  const injTotal = await anon.req('GET', '/api/public/sisfogo/summary?municipality=' + encodeURIComponent("x' OR '1'='1"));
  check('injeção', 'sondagens de SQL injection tratadas (400 ou resultado vazio, sem erro do banco, sem atraso)', inj.length === 0 && injTotal.body?.total === 0, inj.join(', '));
  const usersAlive = await A.req('GET', '/api/auth/status');
  check('injeção', 'tabelas intactas após as sondagens', usersAlive.status === 200 && !!usersAlive.body?.email);

  // 7. Body size, traversal, errors
  const big = await A.req('POST', '/api/feedback', JSON.stringify({ page: '/x', category: 'problema', message: 'x'.repeat(16 * 1024 * 1024) }));
  check('robustez', 'corpo acima de 15 MB recusado (413)', big.status === 413, String(big.status));
  const trav = await anon.req('GET', '/..%2f..%2f..%2fetc%2fpasswd');
  check('robustez', 'travessia de diretório não expõe arquivos', !/root:x:0:0/.test(trav.text));
  const bad = await A.req('POST', '/api/areas', '{"name": ');
  check('robustez', 'JSON malformado → 400 sem pilha de erro', bad.status === 400 && !/at .*\.(js|ts):\d+/.test(bad.text), String(bad.status));

  // 8. Stored XSS: the name is stored as text and rendered escaped
  const xssName = '<img src=x onerror="window.__xss=1">';
  const xa = await A.req('POST', '/api/areas', { name: xssName, operationType: 'outro', municipality: 'Alto Paraíso de Goiás', state: 'GO', latitude: -14.1, longitude: -47.5 });
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: A.cookie.split('=')[0], value: A.cookie.split('=').slice(1).join('='), url: BASE }]);
  const page = await ctx.newPage();
  await page.setExtraHTTPHeaders({ 'X-Forwarded-Proto': 'https' });
  await page.goto(`${BASE}/areas/${xa.body?.id}`);
  await page.waitForTimeout(2500);
  const fired = await page.evaluate(() => window.__xss === 1);
  const shown = await page.getByText(xssName).count().catch(() => 0);
  check('xss', 'área com HTML no nome foi criada (pré-condição)', xa.status === 201, String(xa.status));
  check('xss', 'HTML no nome da área é exibido como texto, sem executar', !fired && shown > 0, `executou=${fired} exibido=${shown}`);
  await browser.close();

  // 9. Brute force: login rate limit
  let limited = false;
  for (let i = 0; i < 15; i++) { const r = await anon.req('POST', '/api/auth/login', { email: `seca${stamp}@sec.test`, password: `errada-${i}` }); if (r.status === 429) { limited = true; break; } }
  check('força bruta', 'tentativas repetidas de login são limitadas (429)', limited);

  const failed = results.filter((r) => !r.ok);
  const report = { base: BASE, ranAt: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.length, results };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  console.log(`\nRESULTADO: ${report.passed}/${report.total} verificações passaram`);
  process.exitCode = failed.length ? 1 : 0;
})();
