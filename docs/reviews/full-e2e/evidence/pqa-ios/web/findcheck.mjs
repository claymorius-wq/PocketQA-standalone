import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const require = createRequire(process.env.PW_FROM + '/package.json');
const { chromium, devices } = require('@playwright/test');
const BASE = 'https://pocketqa.vercel.app'; const OUT = process.argv[2];
const c = Object.fromEntries(readFileSync(join(homedir(), '.config/pocketqa/qa-synthetic-tester.env'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '')]));
const browser = await chromium.launch();
for (const [vp, opts] of [['mobile', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 900 } }]]) {
  const ctx = await browser.newContext({ ...opts, colorScheme: 'dark' }); await ctx.addInitScript(() => { try { localStorage.setItem('pocketqa.introSeen', '1'); } catch {} });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`); await page.getByTestId('sign-in-email').fill(c.QA_TESTER_EMAIL); await page.getByTestId('sign-in-password').fill(c.QA_TESTER_PASSWORD); await page.getByTestId('sign-in-submit').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="sign-in-screen"]'), null, { timeout: 30000 });
  for (const part of ['125d94e6-4af5-449a-8a49-5ec90039f80a', 'fa5abae9-1da5-4a3d-8972-a103edf46ac5']) {
    await page.goto(`${BASE}/participation/${part}`); await page.getByTestId('approved-notice').first().waitFor({ timeout: 25000 }); await page.waitForTimeout(1500);
    const loc = page.getByText('QA synthetic finding: main button label');
    const n = await loc.count(); const info = [];
    for (let i = 0; i < n; i++) { const el = loc.nth(i); info.push({ visible: await el.isVisible(), box: await el.boundingBox() }); }
    const heading = await page.getByText(/finding/i).allInnerTexts();
    console.log(vp, part.slice(0, 8), 'matches', n, JSON.stringify(info), '| texts with "finding":', JSON.stringify(heading.slice(0, 5).map((t) => t.slice(0, 60))));
    await page.screenshot({ path: join(OUT, `findcheck-${vp}-${part.slice(0, 8)}.png`), fullPage: true });
  }
  await page.goto(`${BASE}/settings`); await page.getByTestId('sign-out').first().click(); await page.getByTestId('sign-in-screen').first().waitFor({ timeout: 25000 });
  await ctx.close();
}
await browser.close();
