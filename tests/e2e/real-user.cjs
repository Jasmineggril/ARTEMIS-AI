/**
 * ARTEMIS AI — a real person using the platform, end to end, with REAL data
 * already synced in the target database (INPE hotspots, Sisfogo ROIs) and the
 * live Open-Meteo API. Nothing is mocked.
 *
 *   E2E_BASE_URL=http://localhost:5055 E2E_DB_URL=postgresql://… node tests/e2e/real-user.cjs
 *
 * E2E_DB_URL is used ONLY to (a) choose a place where INPE detected hotspots in
 * the last 6 h and (b) run the same INPE→alerts step the hourly scheduler runs.
 * Screenshots go to E2E_OUT (evidence).
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const pg = require('pg');
const path = require('node:path');

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5000';
const OUT = process.env.E2E_OUT ?? '/tmp';
const DB = process.env.E2E_DB_URL;
if (!DB) { console.error('defina E2E_DB_URL'); process.exit(2); }

(async () => {
  const db = new pg.Client({ connectionString: DB });
  await db.connect();
  const { rows: [spot] } = await db.query(`
    SELECT latitude::float8 AS lat, longitude::float8 AS lng, state, municipality,
      (SELECT count(*)::int FROM satellite_hotspots h2 WHERE h2.detected_at > now() - interval '6 hours'
        AND abs(h2.latitude - h.latitude) < 0.02 AND abs(h2.longitude - h.longitude) < 0.02) AS n
    FROM satellite_hotspots h WHERE detected_at > now() - interval '6 hours' ORDER BY n DESC LIMIT 1`);
  if (!spot) { console.error('Nenhum foco do INPE nas últimas 6 h no banco — sincronize o INPE antes.'); process.exit(2); }
  console.log(`local escolhido: ${spot.municipality}/${spot.state} (${spot.lat}, ${spot.lng}) — ${spot.n} foco(s) reais em 6 h`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/TUNNEL|tile\.openstreetmap/.test(m.text())) errors.push('console: ' + m.text()); });
  page.setDefaultTimeout(20000);
  let failed = 0;
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: false });
  const dismiss = async () => { const b = page.getByText('Não mostrar novamente'); if (await b.isVisible().catch(() => false)) await b.click(); };
  const step = async (name, fn) => {
    await dismiss();
    const t = Date.now();
    try { await fn(); console.log(`PASS ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`); }
    catch (e) { failed++; console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`); await shot('FAIL-' + name.replace(/\W+/g, '_')).catch(() => {}); }
  };
  const email = `produtora.${Date.now()}@exemplo.test`;
  const password = 'Senha.Forte.2026';
  let areaId = null;

  await step('1. criar conta (cria a organização)', async () => {
    await page.goto(BASE + '/signup');
    await page.fill('#name', 'Maria Produtora');
    await page.fill('#email', email);
    await page.fill('#org', 'Fazenda Boa Esperança');
    await page.fill('#password', password);
    await page.fill('#confirm', password);
    await page.check('[data-testid=checkbox-privacy]');
    await page.click('[data-testid=button-submit-signup]');
    await page.waitForURL('**/dashboard');
    await page.waitForTimeout(600); await dismiss();
  });

  await step('2. sair e entrar de novo', async () => {
    await page.goto(BASE + '/settings');
    await page.getByRole('button', { name: /Logout|Sair/ }).first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/settings'));
    await page.goto(BASE + '/login');
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('[data-testid=button-submit-login]');
    await page.waitForURL('**/dashboard');
  });

  await step('3. organização cadastrada e papel de proprietária', async () => {
    await page.goto(BASE + '/organization');
    await page.getByText('Fazenda Boa Esperança').first().waitFor();
    await page.getByText('Proprietário').first().waitFor();
  });

  await step('4. cadastrar propriedade desenhando o limite no mapa', async () => {
    await page.goto(BASE + '/areas'); await page.waitForTimeout(400); await dismiss();
    await page.click('[data-testid=button-new-area]');
    await page.fill('#a-name', 'Fazenda Boa Esperança — sede');
    await page.fill('#a-mun', spot.municipality ?? 'Município');
    await page.selectOption('#a-uf', spot.state);
    // coordinates only to center the map; cleared afterwards so the point is calculated from the polygon
    await page.fill('#a-lat', String(spot.lat));
    await page.fill('#a-lng', String(spot.lng));
    await page.waitForTimeout(800);
    await page.click('[data-testid=button-draw-boundary]');
    const map = page.getByRole('application', { name: /limite da propriedade/ });
    const b = await map.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, r = 70;
    for (const [dx, dy] of [[-r, -r], [r, -r], [r, r], [-r, r]]) { await page.mouse.click(cx + dx, cy + dy); await page.waitForTimeout(150); }
    await page.getByText(/4 vértice\(s\) · .* ha/).waitFor();
    await page.click('[data-testid=button-finish-boundary]');
    await page.getByText(/Área calculada do polígono:/).waitFor();
    await page.fill('#a-lat', ''); await page.fill('#a-lng', '');
    await shot('rw-04-desenho');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await page.waitForURL(/\/areas\/\d+$/);
    areaId = Number(new URL(page.url()).pathname.split('/').pop());
  });

  await step('5. ver dados reais do INPE e Sisfogo no entorno', async () => {
    await page.getByTestId('section-hotspots').waitFor();
    await page.getByText(/calculada do polígono/).first().waitFor();
    const txt = await page.getByTestId('section-hotspots').innerText();
    const inside = Number((txt.match(/Dentro da propriedade\s*(\d+)/) || [])[1]);
    const radius = Number((txt.match(/Até 10 km\s*(\d+)/) || [])[1]);
    if (!(radius > 0)) throw new Error(`nenhum foco real no raio de 10 km (texto: ${txt.slice(0, 200)})`);
    console.log(`     focos INPE reais: ${inside} dentro, ${radius} até 10 km`);
    await page.getByTestId('section-official').waitFor();
    await shot('rw-05-propriedade');
  });

  await step('6. executar análise de risco (clima ao vivo + INPE automático)', async () => {
    await page.click('[data-testid=button-analyze-area]');
    await page.waitForURL('**/risk-analysis?area=*');
    await page.selectOption('#veg', 'dry');
    await page.click('[data-testid=button-analyze]');
    await page.getByText('Limitações e incertezas').waitFor({ timeout: 30000 });
  });

  await step('7. interpretar o resultado (natureza de cada dado)', async () => {
    const t = page.getByTestId('table-provenance');
    await t.waitFor();
    const txt = await t.innerText();
    for (const want of ['Estimativa', 'Observado', 'Calculado']) if (!txt.includes(want)) throw new Error(`falta "${want}" na procedência: ${txt}`);
    if (!/Open-Meteo/.test(txt) || !/INPE/.test(txt)) throw new Error('procedência não cita Open-Meteo e INPE');
    await shot('rw-07-resultado');
  });

  await step('8. gerar relatório rastreável (e PDF)', async () => {
    await page.goto(BASE + `/reports?area=${areaId}`);
    await page.getByTestId('section-trace').waitFor();
    const txt = await page.getByTestId('section-trace').innerText();
    if (!/Temperatura/.test(txt) || !/Estimativa/.test(txt)) throw new Error('rastreabilidade incompleta');
    await shot('rw-08-relatorio');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, 'rw-08-relatorio.pdf'), format: 'A4', printBackground: true });
    await page.emulateMedia({ media: 'screen' });
  });

  await step('9a. alerta automático a partir do foco detectado (rotina horária do INPE)', async () => {
    // same code path the scheduler runs every hour: INPE sync for today/yesterday, then hotspot alerts
    const outp = execFileSync('npx', ['tsx', 'scripts/sync-inpe.ts', '--days', '1'], { env: { ...process.env, DATABASE_URL: DB, NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 300000 });
    const alertsLine = outp.split('\n').find((l) => l.includes('hotspot-alerts')) ?? '';
    console.log('     ' + alertsLine.trim());
    await page.goto(BASE + '/alerts');
    await page.locator('[data-testid^=card-alert-]', { hasText: /Foco de calor/ }).first().click();
    await page.getByText('Detecções que motivaram o alerta (observadas)').waitFor();
    await shot('rw-09-alerta');
  });

  await step('9b. acompanhar o alerta (registrar ação)', async () => {
    await page.fill('#note', 'Equipe acionada para verificar no local.');
    await page.getByRole('button', { name: /Em acompanhamento/ }).click();
    await page.getByText(/→ Em acompanhamento/).waitFor();
  });

  await step('10. sair, entrar e conferir que tudo continua salvo', async () => {
    await page.goto(BASE + '/settings');
    await page.getByRole('button', { name: /Logout|Sair/ }).first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/settings'));
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE + '/login');
    await p2.fill('#email', email);
    await p2.fill('#password', password);
    await p2.click('[data-testid=button-submit-login]');
    await p2.waitForURL('**/dashboard');
    await p2.goto(BASE + `/areas/${areaId}`);
    await p2.getByTestId('section-hotspots').waitFor();
    await p2.getByText(/em acompanhamento|em_acompanhamento/i).first().waitFor();
    const over = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (over) throw new Error('rolagem horizontal no celular');
    await p2.screenshot({ path: path.join(OUT, 'rw-10-celular.png'), fullPage: true });
    const { rows: [chk] } = await db.query(`
      SELECT (SELECT count(*)::int FROM risk_analyses WHERE area_id = $1) AS analyses,
             (SELECT count(*)::int FROM alerts WHERE area_id = $1 AND kind = 'foco_proximo' AND status = 'em_acompanhamento') AS alerts,
             (SELECT boundary_source FROM monitored_areas WHERE id = $1) AS src,
             (SELECT area_hectares_source FROM monitored_areas WHERE id = $1) AS hasrc`, [areaId]);
    console.log(`     no banco: ${chk.analyses} análise(s), ${chk.alerts} alerta(s) em acompanhamento, limite=${chk.src}, área=${chk.hasrc}`);
    if (chk.analyses < 1 || chk.alerts < 1 || chk.src !== 'desenho' || chk.hasrc !== 'calculada') throw new Error('dados não persistidos como esperado');
    await ctx2.close();
  });

  console.log('JS errors:', JSON.stringify(errors));
  console.log(failed ? `RESULTADO: ${failed} etapa(s) falharam` : 'RESULTADO: todas as etapas passaram');
  await browser.close();
  await db.end();
  process.exitCode = failed || errors.length ? 1 : 0;
})();
