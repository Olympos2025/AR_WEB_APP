import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright-core';

const SCRATCH = process.env.SCRATCH;
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  permissions: ['geolocation'],
  geolocation: { latitude: 39.7126, longitude: 21.6262, accuracy: 8 },
  locale: 'el-GR',
});
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

let tilesServed = 0;
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith('http://localhost')) return route.continue();
  const m = /elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/.exec(url);
  if (m) {
    const file = `${SCRATCH}/tiles/${m[1]}-${m[2]}-${m[3]}.png`;
    if (existsSync(file)) {
      tilesServed++;
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: readFileSync(file),
      });
    }
    return route.fulfill({ status: 404, body: 'nope' });
  }
  return route.abort(); // silence map tiles / fonts etc.
});

await page.goto('http://localhost:4173/AR_WEB_APP/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);

const input = page.locator('input[type=file]');
await input.setInputFiles(`${SCRATCH}/meteora-polygon.geojson`);
await page.waitForTimeout(1200);
console.log('layer listed:', (await page.locator('body').textContent()).includes('meteora-polygon'));

await page.getByRole('button', { name: 'Έναρξη AR' }).first().click();
await page.waitForTimeout(9000);

const debug = await page.evaluate(() => window.__fieldarDebug ?? null);
console.log('debug:', JSON.stringify(debug));
console.log('terrain tiles served:', tilesServed);
const hud = await page.locator('body').textContent();
const idx = hud.indexOf('Ανάγλυφο');
console.log('HUD terrain line:', JSON.stringify(hud.slice(idx, idx + 60)));
await browser.close();
