// README gallery: full-quality renders with the interface hidden (H), plus one with it on.
//   node scripts/dev/gallery.mjs http://127.0.0.1:5175/
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5175/';
const out = new URL('../../docs/', import.meta.url);
fs.mkdirSync(out, { recursive: true });

const shots = [
  // name, query, wait ms, actions
  { name: 'hero-south-pole', q: 'a=connecting-ridge~2026-11-20T12:00Z~30', wait: 9000, hide: true, keys: [] },
  { name: 'surface-connecting-ridge', q: 'a=connecting-ridge~2026-11-20T12:00Z~30&view=surface', wait: 22000, hide: true },
  { name: 'surface-earthrise', q: 'a=connecting-ridge~2026-11-20T12:00Z~30&view=surface', wait: 22000, hide: true, click: 'Face Earth' },
  { name: 'surface-lander', q: 'a=malapert-massif~2027-02-10T12:00Z~30&view=surface', wait: 22000, hide: true },
  { name: 'globe-full', q: 'a=apollo-17~2027-03-15T00:00Z~30', wait: 9000, hide: true, click: 'Reset', after: 3500 },
  { name: 'interface', q: 'a=connecting-ridge~2026-11-20T12:00Z~30&b=shackleton-rim~2026-11-20T12:00Z~30&cmp=1', wait: 9000, hide: false },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  for (const s of shots) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
    await page.addInitScript(() => {
      localStorage.setItem('eclipse:quality:v1', JSON.stringify({ mode: 3, learned: {} }));
      localStorage.setItem('hint:orbit', '1');
      localStorage.setItem('hint:surface', '1');
    });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`${base}?${s.q}`);
    await page.waitForTimeout(s.wait);
    if (s.click) {
      await page.getByRole('button', { name: s.click }).first().click();
      await page.waitForTimeout(s.after ?? 3000);
    }
    if (s.hide) {
      await page.keyboard.press('h');
      await page.mouse.move(800, 450);
      await page.waitForTimeout(3200); // the "show interface" pill fades out
    }
    await page.screenshot({ path: new URL(`${s.name}.png`, out).pathname.replace(/^\/([A-Z]:)/, '$1') });
    console.log(s.name, errs.length ? errs.slice(0, 3) : 'ok');
    await page.close();
  }
} finally {
  await browser.close();
}
