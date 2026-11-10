import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ==========================================================================
// End to end, in the real app (Electron = full Chromium with WebGL2): the
// data-ink inspector. Select every node, act on the selection from its one
// card, fold a sub-group and read its summary, narrow a numeric filter and see
// its histogram follow, and read the Overlays counts. Opt-in — it needs a
// display and the Electron binary — so the default `npm test` skips it:
//
//   GLL_E2E=1 npx vitest run tests/inspector-data-ink.e2e.test.js
// ==========================================================================

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/benchmark_1000x1500_overlays.json');
const E2E = !!process.env.GLL_E2E;

describe.skipIf(!E2E)('data-ink inspector, end to end', () => {
  let app;
  let page;

  const settled = () =>
    page.waitForFunction(() => {
      const overlay = document.getElementById('loadingOverlay');
      return !overlay || getComputedStyle(overlay).display === 'none';
    }, null, { timeout: 60_000, polling: 250 }); // rAF polling stalls in a hidden window

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
      && window.cache.EVENT_LOCKS?.ONCE_AFTER_RENDER_RUNNING === false
      && !!window.cache.history?.baseline, null, { timeout: 90_000, polling: 250 });
    await settled();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('acts, folds and reads the data across the three tabs', async () => {
    // --- Selection: one card for every verb, with what it holds in its header.
    await page.click('#selectMenuBtn');
    await page.getByRole('button', { name: 'All (nodes)' }).click();
    await settled();
    await page.click('#inspectorPillSelection');
    await expect.poll(() => page.textContent('#actSelectionCount')).toBe('1000 nodes · 0 edges');
    expect(await page.getAttribute('#Shortest\\ Path', 'aria-disabled')).toBe('true');
    expect(await page.isVisible('#Shortest\\ Path + .prop-hint')).toBe(true);
    await page.getByRole('button', { name: 'Edges ＋: expand edges' }).click();
    await settled();
    await expect.poll(() => page.evaluate(() => window.cache.selectedEdges.length)).toBeGreaterThan(0);
    expect(await page.textContent('#actSelectionCount')).toMatch(/^1000 nodes · [1-9]\d* edges$/);

    // Reset style sits in the Appearance heading and is live with a selection.
    expect(await page.getAttribute('#resetSelectedElementsStyleBtn', 'aria-disabled')).toBe('false');

    // The fill colours as one strip: a segment per colour, wider for more nodes.
    const segments = page.locator('.prop-row-selection-colors .prop-chip');
    expect(await segments.count()).toBeGreaterThan(1);
    const widths = await segments.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(24);

    // Map by data is a column: one header, a button per mappable row.
    expect(await page.locator('[data-label="Node Configuration"] .prop-map-head').textContent()).toBe('Map');
    expect(await page.locator('[data-label="Node Configuration"] .prop-row > .prop-map-btn').count()).toBeGreaterThan(4);

    // Label folds to one line that still says what it holds.
    const label = page.locator('[data-label="Node Configuration"] .prop-fold').first();
    const head = label.locator('.prop-fold-head');
    expect(await head.getAttribute('aria-expanded')).toBe('true');
    await head.click();
    expect(await head.getAttribute('aria-expanded')).toBe('false');
    expect(await label.locator('.prop-row[data-name="Label size"]').isVisible()).toBe(false);
    expect(await label.locator('.prop-fold-summary').textContent()).toMatch(/^· .+, .+, \d+$/);
    await head.click(); // leave it as it was for the next run's viewer state

    // --- Filters: the census rides with the Node/Edge switch; a numeric
    // filter's histogram tints only what it keeps.
    await page.click('#inspectorPillFilters');
    expect(await page.evaluate(() =>
      document.getElementById('filterConstraintCount').previousElementSibling?.classList.contains('filter-scope')))
      .toBe(true);
    const hist = page.locator('.filter-hist').first();
    await hist.waitFor({ state: 'attached' });
    const kept = () => hist.locator('i.kept').count();
    const bins = await hist.locator('i').count();
    expect(await kept()).toBe(bins);
    const box = page.locator('.filter-range-row.has-hist input[id$="-start-input"]').first();
    const upper = await page.locator('.filter-range-row.has-hist input[id$="-end-input"]').first().inputValue();
    await box.fill(String(Number(upper) / 2));
    await box.press('Enter');
    await settled();
    await expect.poll(kept).toBeLessThan(bins);
    expect(await kept()).toBeGreaterThan(0);

    // --- Overlays: light layer rows, each with its glyph; the Groups layer
    // counts groups and the nodes they cover.
    await page.click('#inspectorPillOverlays');
    expect(await page.locator('#inspectorOverlays .layer-glyph').count()).toBe(5);
    expect(await page.textContent('#overlayCountGroups')).toMatch(/^\d+ groups? · \d+ nodes?$/);
    expect(await page.getAttribute('#inspectorPillOverlays', 'aria-selected')).toBe('true');
  }, 120_000);
});
