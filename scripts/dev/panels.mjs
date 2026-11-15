// README panel shots: the landing-date scan, the direct-to-Earth link panel and a finished downlink.
//   node scripts/dev/panels.mjs http://127.0.0.1:5175/
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:5175/';
const dir = fileURLToPath(new URL('../../docs/', import.meta.url));
fs.mkdirSync(dir, { recursive: true });
const q = 'a=connecting-ridge~2026-11-20T12:00Z~30';

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const open = async () => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  await page.addInitScript(() => {
    localStorage.setItem('eclipse:quality:v1', JSON.stringify({ mode: 2, learned: {} }));
    localStorage.setItem('hint:orbit', '1');
    localStorage.setItem('hint:surface', '1');
  });
  await page.goto(`${base}?${q}`);
  await page.waitForTimeout(9000);
  return page;
};
try {
  let page = await open();
  await page.getByRole('button', { name: 'Best landing dates' }).click();
  await page.waitForTimeout(1500);
  await page.locator('.sheet').screenshot({ path: `${dir}landing-dates.png` });
  await page.close();

  page = await open();
  await page.locator('.ground-link').screenshot({ path: `${dir}ground-link.png` });
  await page.close();

  page = await open();
  await page.getByRole('button', { name: /Send/ }).first().click();
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Transmit/ }).click();
  await page.waitForTimeout(6000);
  await page.locator('.downlink').screenshot({ path: `${dir}downlink.png` });
  await page.close();
  console.log('ok');
} finally {
  await browser.close();
}
