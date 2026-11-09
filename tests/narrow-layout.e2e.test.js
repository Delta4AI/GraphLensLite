import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ==========================================================================
// End to end, in the real app (Electron = full Chromium with WebGL2): the top
// bar fits a 1280px laptop, and at phone width the graph keeps the screen
// while the inspector and the workbench take turns in one bottom sheet.
// Opt-in — it needs a display and the Electron binary:
//
//   GLL_E2E=1 npx vitest run tests/narrow-layout.e2e.test.js
// ==========================================================================

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/benchmark_1000x1500_overlays.json');
const E2E = !!process.env.GLL_E2E;

describe.skipIf(!E2E)('narrow layout, end to end', () => {
  let app;
  let page;

  const resize = async (width, height) => {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height]);
    await page.waitForFunction((w) => window.innerWidth === w, width, { polling: 100 });
  };
  const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  beforeAll(async () => {
    const { _electron } = await import('playwright');
    app = await _electron.launch({
      executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
      args: [path.join(ROOT, 'tests/e2e/electron_main.cjs')],
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15_000);
    await page.waitForFunction(() => !!window.cache?.io, null, { timeout: 30_000, polling: 100 });
    await page.setInputFiles('#fileInput', FIXTURE);
    await page.waitForFunction(() => window.cache?.nodeRef?.size > 0
      && window.cache.EVENT_LOCKS?.ONCE_AFTER_RENDER_RUNNING === false, null, { timeout: 90_000, polling: 250 });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('fits a laptop, then works at phone width through the Panel sheet and ⋯ More', async () => {
    await resize(1280, 800);
    expect(await noSideScroll()).toBe(true);
    await page.click('#selectMenuBtn'); // the selection chip opens the selection menu
    await expect.poll(() => page.locator('#lassoMenuItem').isVisible()).toBe(true);
    await page.keyboard.press('Escape');

    await resize(390, 844);
    expect(await noSideScroll()).toBe(true);
    expect(await page.locator('#inspector').isVisible()).toBe(false);
    expect(await page.evaluate(() => document.getElementById('outerGraphContainer').getBoundingClientRect().width)).toBe(390);

    // Lasso and its touch way out: the stage line's Done, no key needed.
    await page.evaluate(() => window.cache.ui.toggleLassoSelection());
    await page.locator('#modeHint').getByRole('button', { name: 'Done' }).click();
    expect(await page.evaluate(() => window.cache.graph.isInteractionEnabled('lasso'))).toBe(false);

    const panel = page.locator('#panelToggleBtn');
    await panel.click();
    await expect.poll(() => page.locator('#inspector').isVisible()).toBe(true);
    // Half height shares the screen: the graph shrinks into the top part.
    expect(await page.evaluate(() => document.getElementById('outerGraphContainer').getBoundingClientRect().height))
      .toBeLessThan(500);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('#inspector').isVisible()).toBe(false);
    expect(await panel.evaluate((el) => el === document.activeElement)).toBe(true);

    // The Back gesture closes the sheet too, and only the sheet.
    await panel.click();
    await expect.poll(() => page.locator('#inspector').isVisible()).toBe(true);
    await page.evaluate(() => history.back());
    await expect.poll(() => page.locator('#inspector').isVisible()).toBe(false);

    // ⋯ More reaches the hidden workbench tabs; the sheet and the workbench take turns.
    await page.click('#railMoreBtn');
    await page.locator('.rail-menu.open').getByRole('button', { name: 'Data' }).click();
    await expect.poll(() => page.locator('#workbench').isVisible()).toBe(true);
    await panel.click();
    await expect.poll(() => page.locator('#workbench').isVisible()).toBe(false);
    expect(await page.locator('#inspector').isVisible()).toBe(true);
  }, 120_000);
});
