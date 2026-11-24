const { chromium, devices } = require('playwright');
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5000';
const shot = (p, n) => p.screenshot({ path: `${process.env.E2E_OUT ?? '/tmp'}/${n}.png`, fullPage: false });
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.setDefaultTimeout(12000);
  const dismiss = async () => { const b = page.getByText('Não mostrar novamente'); if (await b.isVisible().catch(()=>false)) await b.click(); };
  const step = async (name, fn) => { await dismiss(); try { await fn(); console.log('PASS', name); } catch (e) { console.log('FAIL', name, e.message.split('\n')[0]); await shot(page, 'fail-' + name.replace(/\W+/g,'_')); } };

  const email = `e2e${Date.now()}@test.dev`;
  await step('signup', async () => {
    await page.goto(BASE + '/signup');
    await page.fill('#name', 'Usuária E2E');
    await page.fill('#email', email);
    await page.fill('#org', 'Fazenda E2E');
    await page.fill('#password', 'senhaForte1');
    await page.fill('#confirm', 'senhaForte1');
    await page.check('[data-testid=checkbox-privacy]');
    await page.click('[data-testid=button-submit-signup]');
    await page.waitForURL('**/dashboard', { timeout: 10000 });
    await page.waitForTimeout(600); await dismiss();
    await page.getByText('Comece cadastrando uma área').waitFor();
  });
  await step('localStorage holds no credentials', async () => {
    const ls = await page.evaluate(() => JSON.stringify(localStorage));
    if (/senhaForte1|password/i.test(ls)) throw new Error('credential in localStorage: ' + ls);
  });
  await step('create area', async () => {
    await page.goto(BASE + '/areas'); await page.waitForTimeout(500); await dismiss();
    await page.click('[data-testid=button-new-area]');
    await page.fill('#a-name', 'Talhão Norte');
    await page.fill('#a-mun', 'Alto Paraíso de Goiás');
    await page.fill('#a-lat', '-14.13');
    await page.fill('#a-lng', '-47.51');
    await page.fill('#a-ha', '850');
    await page.getByRole('button', { name: 'Salvar' }).click();
    // saving a new area opens its property page
    await page.waitForURL(/\/areas\/\d+$/);
    await page.getByRole('heading', { name: /Talhão Norte/ }).waitFor();
    await page.getByText('Nenhuma análise ainda.', { exact: false }).waitFor();
    await page.goto(BASE + '/areas');
    await page.locator('[data-testid^=card-area-]', { hasText: 'Sem análise' }).waitFor();
  });
  await step('analyze area (manual, critical scenario)', async () => {
    await page.getByRole('button', { name: /Analisar risco/ }).click();
    await page.waitForURL('**/risk-analysis?area=*');
    await page.getByRole('button', { name: 'Cenário Crítico' }).click().catch(async () => {
      const btns = await page.locator('button', { hasText: /Crític/ }).all(); await btns[0].click();
    });
    await page.click('[data-testid=button-analyze]');
    await page.getByText('Limitações e incertezas').waitFor({ timeout: 10000 });
    await page.getByRole('link', { name: /Alerta emitido/ }).waitFor();
    await page.getByText('Motor de regras transparente', { exact: true }).waitFor();
    await shot(page, '1-analysis-desktop');
  });
  await step('alert lifecycle in UI', async () => {
    await page.goto(BASE + '/alerts');
    await page.locator('[data-testid^=card-alert-]').first().click();
    await page.getByRole('button', { name: /Reconhecido/ }).click();
    await page.getByText('Novo → Reconhecido').waitFor();
    await shot(page, '2-alert-drawer');
  });
  await step('dashboard reflects data', async () => {
    await page.goto(BASE + '/dashboard');
    await page.getByText('Áreas por nível de risco').waitFor();
    await page.getByText('1/1').waitFor();
    await shot(page, '3-dashboard');
  });
  await step('map renders area', async () => {
    await page.goto(BASE + '/maps');
    await page.locator('.leaflet-container').waitFor();
    await page.waitForTimeout(1500);
    await shot(page, '4-map');
  });
  await step('report shows stored analyses', async () => {
    await page.goto(BASE + '/reports');
    await page.getByRole('heading', { name: 'Histórico das análises' }).waitFor();
    await page.getByRole('heading', { name: 'Limitações metodológicas' }).waitFor();
    await shot(page, '6-report');
  });
  await step('insights charts render from data', async () => {
    await page.goto(BASE + '/insights');
    await page.getByText('Análises por semana e nível de risco').waitFor();
    await page.locator('.recharts-rectangle').first().waitFor();
    await shot(page, '7-insights');
  });
  await step('publish batch and see it on the public lookup', async () => {
    const MUN = `Cavalcante E2E ${Date.now()}`;
    const r = await page.evaluate(async (MUN) => (await fetch('/api/import-batches', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'brigada.csv', sourceName: 'Brigada E2E', records: [
        { occurrenceDate: '2026-08-10', occurrenceTime: '15:20', municipality: MUN, state: 'GO', latitude: -13.7971, longitude: -47.4567, occurrenceType: 'Queimada', notes: 'SEGREDO-INTERNO', validationStatus: 'válido' },
        { occurrenceDate: '2026-09-02', occurrenceTime: '10:05', municipality: MUN, state: 'GO', latitude: -13.81, longitude: -47.47, validationStatus: 'válido' },
      ] }) })).status, MUN);
    if (r !== 201) throw new Error('import status ' + r);
    page.once('dialog', d => d.accept());
    await page.goto(BASE + '/data-sources');
    await page.getByRole('row', { name: /brigada\.csv/ }).getByRole('button', { name: 'Publicar' }).click();
    await page.getByRole('row', { name: /brigada\.csv/ }).getByText('Público').waitFor();
    const anonCtx = await browser.newContext();
    const ap = await anonCtx.newPage();
    await ap.goto(BASE + '/florestai');  // old link must redirect
    await ap.waitForURL('**/consulta-publica**');
    await ap.fill('#f-mun', MUN);
    await ap.check('text=Comparar com período anterior');
    await ap.getByRole('button', { name: 'Consultar' }).click();
    await ap.getByText('Quem publicou estes dados').waitFor();
    const total = await ap.locator('text=Ocorrências no filtro').locator('..').locator('p').nth(1).textContent();
    if (total.trim() !== '2') throw new Error('public total ' + total);
    if ((await ap.content()).includes('SEGREDO-INTERNO')) throw new Error('private note leaked');
    if (!ap.url().includes('/consulta-publica?') || !ap.url().includes('municipality=Cavalcante')) throw new Error('filters not in URL: ' + ap.url());
    await ap.waitForTimeout(800);
    await ap.screenshot({ path: `${process.env.E2E_OUT ?? '/tmp'}/8-consulta-publica.png` });
    const m = await browser.newContext({ ...devices['iPhone 13'] });
    const mp = await m.newPage();
    await mp.goto(ap.url()); await mp.waitForTimeout(1200);
    const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 2) throw new Error('public lookup overflows on mobile by ' + over);
    await mp.screenshot({ path: `${process.env.E2E_OUT ?? '/tmp'}/9-consulta-publica-mobile.png` });
    await m.close(); await anonCtx.close();
  });
  await step('mobile layout (no horizontal scroll)', async () => {
    const m = await browser.newContext({ ...devices['iPhone 13'] });
    await m.addCookies(await ctx.cookies());
    const mp = await m.newPage();
    for (const path of ['/dashboard', '/areas', '/risk-analysis', '/alerts', '/reports', '/insights']) {
      await mp.goto(BASE + path); await mp.waitForTimeout(800);
      const over = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 2) throw new Error(`${path} overflows by ${over}px`);
    }
    await mp.goto(BASE + '/risk-analysis'); await mp.waitForTimeout(800);
    await mp.screenshot({ path: '' + (process.env.E2E_OUT ?? '/tmp') + '/5-mobile-analysis.png' });
    await m.close();
  });
  await step('logout', async () => {
    await page.goto(BASE + '/dashboard');
    const r = await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }).then(r => r.status));
    await page.goto(BASE + '/dashboard');
    await page.waitForURL('**/login', { timeout: 8000 });
  });
  console.log('JS errors:', errors.filter(e => !/401|Failed to load resource/.test(e)).slice(0, 10));
  await browser.close();
})();
