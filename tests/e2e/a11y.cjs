const { chromium } = require('playwright');
const axe = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5000';
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage();
  await p.goto(BASE + '/login');
  await p.fill('#email', process.env.E2E_DEMO_EMAIL ?? 'demo@artemis.local'); await p.fill('#password', process.env.E2E_DEMO_PASSWORD ?? '');
  await p.click('[data-testid=button-submit-login]'); await p.waitForURL('**/dashboard');
  await p.evaluate(() => localStorage.setItem('platform_onboarding_status', JSON.stringify({ neverShow: true, started: true, completed: true })));
  const pages = ['/login', '/signup', '/privacidade', '/dashboard', '/areas', '/risk-analysis', '/alerts', '/maps', '/organization', '/reports', '/insights'];
  for (const path of pages) {
    const pg = path === '/login' || path === '/signup' ? await (await b.newContext()).newPage() : p;
    await pg.goto(BASE + path); await pg.waitForTimeout(1200);
    await pg.addScriptTag({ content: axe });
    const r = await pg.evaluate(async () => (await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] } })).violations.map(v => `${v.impact} ${v.id} (${v.nodes.length}): ${v.nodes[0].target.join(' ')}`));
    console.log(path, r.length ? '\n  ' + r.join('\n  ') : 'OK');
  }
  await b.close();
})();
