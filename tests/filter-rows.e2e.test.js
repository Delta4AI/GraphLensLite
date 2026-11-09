import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ==========================================================================
// End to end, in the real app (Electron = full Chromium with WebGL2), by
// keyboard: open a category filter's list, untick one value, close it, then
// put what the filter still matches into the selection from the row's "…"
// menu. Opt-in — it needs a display and the Electron binary:
//
//   GLL_E2E=1 npx vitest run tests/filter-rows.e2e.test.js
// ==========================================================================

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/benchmark_1000x1500_overlays.json');
const E2E = !!process.env.GLL_E2E;
const CLUSTER = 'Node filters::Topology::Cluster';

describe.skipIf(!E2E)('filter rows, end to end', () => {
  let app;
  let page;

  const settled = () =>
    page.waitForFunction(() => {
      const overlay = document.getElementById('loadingOverlay');
      return !overlay || getComputedStyle(overlay).display === 'none';
    }, null, { timeout: 60_000, polling: 250 }); // rAF polling stalls in a hidden window
  const matched = () =>
    page.evaluate((prop) => window.cache.propIDsToNodeIDsToBeShown.get(prop)?.size ?? 0, CLUSTER);

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

  it('narrows a category by keyboard and selects what the filter still matches', async () => {
    await page.click('#inspectorPillFilters');
    const row = page.locator(`.filter-row[data-prop-id="${CLUSTER}"]`);
    const trigger = row.getByRole('button', { name: /^Cluster: / });
    const all = await matched();
    expect(all).toBe(1000);

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = page.locator('.filter-cat-menu');
    const firstValue = menu.locator('.filter-cat-item[data-value]').first();
    const valueName = (await firstValue.locator('.filter-cat-name').textContent()).trim();
    const valueCount = Number(await firstValue.locator('.filter-cat-count').textContent());

    // Focus lands on All; one ↓ reaches the first value; Space unticks it.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    await settled();
    await expect.poll(matched).toBe(all - valueCount);
    expect(await trigger.textContent()).toContain(`${7} of 8`);
    expect(await menu.getByRole('checkbox', { name: /^All/ }).evaluate((b) => b.indeterminate)).toBe(true);
    expect(await page.evaluate((prop) =>
      window.cache.propIDToDropdownChecklists.get(prop).selectedCategories.size, CLUSTER)).toBe(7);

    await page.keyboard.press('Escape');
    await expect.poll(() => trigger.getAttribute('aria-expanded')).toBe('false');
    expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);

    // The row's "…" menu: put the remaining matches into the selection.
    await row.getByRole('button', { name: 'Cluster actions' }).click();
    await page.getByRole('button', { name: 'Add matches to selection' }).click();
    await settled();
    await expect.poll(() => page.evaluate(() => window.cache.selectedNodes?.length ?? 0)).toBe(all - valueCount);
    // None of them carries the value that was unticked.
    expect(await page.evaluate(([prop, name]) => window.cache.selectedNodes.some(
      (n) => String(window.cache.nodeRef.get(n.id ?? n).featureValues.get(prop)) === name), [CLUSTER, valueName]))
      .toBe(false);
  });
});
