import { expect, test, type Page } from '@playwright/test';

const ignorable = (t: string) => /GPU stall|WebGL: too many|Download the React DevTools|THREE\.WebGLRenderer: Context Lost/i.test(t);

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !ignorable(m.text())) errors.push(m.text());
  });
  return errors;
}

test('default scenario shows real DE440 + LOLA values and updates with time and site', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?a=connecting-ridge~2026-11-14T12:00Z~30');
  const inspector = page.locator('.panel-right');
  await expect(inspector.getByText('Connecting Ridge')).toBeVisible();
  // SPICE azlcpo gives 1.4451° for this site and epoch
  await expect(inspector.locator('.hero-card.sun .v .blur-text')).toHaveAttribute('aria-label', '1.45°', { timeout: 15_000 });
  await expect(inspector.getByText('LOLA terrain')).toBeVisible({ timeout: 15_000 });

  // Time: step the playhead one day with the keyboard
  const slider = page.getByRole('slider', { name: 'Mission time' });
  await slider.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('.tl-date')).toContainText('15 Nov 2026');
  await expect(inspector.locator('.hero-card.sun .v .blur-text')).not.toHaveAttribute('aria-label', '1.45°');

  // Site: pick Malapert Massif
  await page.locator('.panel-left').getByRole('button', { name: /Malapert Massif/ }).click();
  // The panel morphs between sites, so briefly both titles exist; wait for the new one.
  await expect(inspector.locator('.title', { hasText: 'Malapert Massif' }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('compare mode uses independent scenarios', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?a=connecting-ridge~2026-11-14T12:00Z~30&b=shackleton-rim~2026-11-14T12:00Z~30&cmp=1');
  const table = page.locator('.cmp-table');
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.verdict')).toContainText('Connecting Ridge', { timeout: 15_000 });
  const cells = table.locator('.c .blur-text');
  // Sunlight row (3rd metric): A and B differ: 89% vs 29% with LOLA terrain
  await expect(cells.nth(4)).toHaveAttribute('aria-label', '89%', { timeout: 15_000 });
  await expect(cells.nth(5)).toHaveAttribute('aria-label', '29%');
  expect(errors).toEqual([]);
});

test('surface view renders terrain, lander and the horizon panorama', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/?a=connecting-ridge~2026-11-14T12:00Z~30');
  await page.getByRole('button', { name: 'Surface' }).click();
  await expect(page.locator('.panorama')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Face Sun' })).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'test-results/surface.png' });
  expect(errors).toEqual([]);
});

test('methodology lists sources and limitations', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Methodology and sources' }).click();
  const dialog = page.getByRole('dialog', { name: /Methodology/ });
  await expect(dialog).toContainText('DE440');
  await expect(dialog).toContainText('LDEM_875S_20M');
  await expect(dialog).toContainText('Not modelled');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('remains usable on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.panel-right .title')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
