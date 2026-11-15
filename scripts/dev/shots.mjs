import { chromium } from '@playwright/test';
const out = process.argv[2];
const url = process.argv[3];
const times = process.argv.slice(4).map(Number);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 1) });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(url);
  if (process.env.CLICK) {
    await page.waitForTimeout(Number(process.env.CLICK_AT ?? 6000));
    const btn = page.getByRole('button', { name: process.env.CLICK, exact: true });
    if (process.env.DBL) await btn.dblclick();
    else await btn.click();
  }
  if (process.env.EVAL) {
    await page.waitForTimeout(Number(process.env.EVAL_AT ?? 6000));
    console.log('eval:', await page.evaluate(process.env.EVAL));
  }
  let last = 0;
  for (const t of times) {
    await page.waitForTimeout(t - last);
    last = t;
    await page.screenshot({ path: `${out}-${t}.png` });
  }
  console.log('errors:', [...new Set(errs)].slice(0, 8));
} finally {
  await browser.close();
}
