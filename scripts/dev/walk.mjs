import { chromium } from '@playwright/test';
const out = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(process.argv[3]);
  await page.waitForTimeout(18000);
  await page.screenshot({ path: `${out}-0-spawn.png` });
  await page.mouse.click(700, 300);
  await page.keyboard.down('w');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}-1-fp.png` });
  // look down to see the suit
  await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(700, 600, { steps: 10 }); await page.mouse.up();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}-2-down.png` });
  await page.keyboard.up('w');
  await page.waitForTimeout(3600);
  await page.screenshot({ path: `${out}-3-out.png` });
  console.log('inspector:', (await page.locator('.panel-right .subtitle').first().textContent()));
  console.log('errors:', [...new Set(errs)].slice(0, 6));
} finally {
  await browser.close();
}
