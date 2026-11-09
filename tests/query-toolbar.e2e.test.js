import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ==========================================================================
// End to end, in the real app (Electron = full Chromium with WebGL2): write a
// query the filter panel cannot express, run it with Ctrl+Enter, read the
// toolbar's status, then hand the graph back with "Reset to filters" and check
// the graph really follows the panel again. Opt-in — it needs a display and
// the Electron binary:
//
//   GLL_E2E=1 npx vitest run tests/query-toolbar.e2e.test.js
// ==========================================================================

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/benchmark_1000x1500_overlays.json');
const E2E = !!process.env.GLL_E2E;
const QUERY = '(Node filters::Biology::Score BETWEEN 0.1 AND 30) NOT (Node filters::Topology::Cluster IN [Cluster 0])';

describe.skipIf(!E2E)('query toolbar, end to end', () => {
  let app;
  let page;

  const settled = () =>
    page.waitForFunction(() => {
      const overlay = document.getElementById('loadingOverlay');
      return !overlay || getComputedStyle(overlay).display === 'none';
    }, null, { timeout: 60_000, polling: 250 }); // rAF polling stalls in a hidden window
  const shown = () => page.evaluate(() => window.cache.nodeIDsToBeShown.size);

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
    await settled();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('runs a query by keyboard, says it is applied, and Reset hands the graph back to the panel', async () => {
    await page.click('#queryToggleBtn');
    const pane = page.locator('#queryPane');
    const status = pane.getByRole('status');
    await expect.poll(() => status.textContent()).toContain('Synced');

    await page.locator('#queryTextArea').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type(QUERY);
    await expect.poll(() => status.textContent()).toContain('Not applied');

    await page.keyboard.press('Control+Enter');
    await settled();
    await expect.poll(() => status.textContent()).toContain('Applied');
    const byQuery = await shown();
    expect(byQuery).toBeLessThan(1000);

    await pane.getByRole('button', { name: 'Reset to filters' }).click();
    await settled();
    await expect.poll(() => status.textContent()).toContain('Synced');
    expect(await page.evaluate(() => window.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY)).toBe(false);
    // The panel cannot express NOT, so its query matches a different set; the
    // graph must now show that set, not keep the query's result.
    await expect.poll(shown).not.toBe(byQuery);

    // A broken query names its problem and Filter graph stays blocked.
    await page.locator('#queryTextArea').click();
    await page.keyboard.press('End');
    await page.keyboard.type(' AND bogus');
    await expect.poll(() => status.textContent()).toContain('Not recognised');
    expect(await pane.getByRole('button', { name: 'Filter graph' }).getAttribute('aria-disabled')).toBe('true');
  }, 120_000);
});
