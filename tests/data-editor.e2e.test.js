import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ==========================================================================
// End to end, in the real app (Electron = full Chromium with WebGL2), by
// keyboard: open the data editor, list every node, edit a value in the grid,
// see it marked and counted, review it, apply it and find it on the graph's
// node. Opt-in — it needs a display and the Electron binary:
//
//   GLL_E2E=1 npx vitest run tests/data-editor.e2e.test.js
// ==========================================================================

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/benchmark_1000x1500_overlays.json');
const E2E = !!process.env.GLL_E2E;
const SCORE = 'Node filters::Biology::Score';

describe.skipIf(!E2E)('data editor, end to end', () => {
  let app;
  let page;

  const settled = () =>
    page.waitForFunction(() => {
      const overlay = document.getElementById('loadingOverlay');
      return !overlay || getComputedStyle(overlay).display === 'none';
    }, null, { timeout: 60_000, polling: 250 }); // rAF polling stalls in a hidden window
  const loaded = () =>
    page.waitForFunction(() => window.cache?.nodeRef?.size > 0
      && window.cache.EVENT_LOCKS?.ONCE_AFTER_RENDER_RUNNING === false, null, { timeout: 90_000, polling: 250 });

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
    await loaded();
    await settled();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('edits a value by keyboard, shows it staged, and applies it to the graph', async () => {
    await page.click('#dataToggleBtn');
    const pane = page.locator('#dataEditor');
    await pane.getByRole('button', { name: /^Show all 1000 nodes$/ }).click();
    await expect.poll(() => pane.locator('.data-count').textContent()).toBe('1000 nodes');

    // One Tab stop: focus lands on the first data cell; move to n0's Score.
    const grid = pane.getByRole('grid');
    await grid.locator('[tabindex="0"]').focus();
    const scoreCol = await page.evaluate((h) => window.cache.dataTable.headers.indexOf(h), SCORE);
    const target = grid.locator(`tr[data-key="Node::n0"] td[data-col="${scoreCol}"]`);
    const before = (await target.textContent()).trim();
    for (let i = 0; i < 20; i++) {
      if (await target.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press('ArrowRight');
    }
    expect(await target.evaluate((el) => el === document.activeElement)).toBe(true);

    // Escape cancels; typing then Enter stages.
    await page.keyboard.type('5');
    await page.keyboard.press('Escape');
    expect((await target.textContent()).trim()).toBe(before);
    await page.keyboard.press('F2');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('12.5');
    await page.keyboard.press('Enter');
    expect(await target.evaluate((el) => el.classList.contains('data-cell-edited'))).toBe(true);
    const bar = pane.locator('.data-changes');
    await expect.poll(() => bar.locator('.data-changes-count').textContent()).toBe('1 unsaved change');

    await bar.getByRole('button', { name: 'Review' }).click();
    const review = page.locator('.data-review');
    expect(await review.textContent()).toContain('n0 · Score');
    expect(await review.textContent()).toContain('12.5');
    await page.keyboard.press('Escape');

    await bar.getByRole('button', { name: 'Apply 1 change' }).click();
    await loaded();
    await settled();
    await expect.poll(() => page.evaluate((h) =>
      String(window.cache.nodeRef.get('n0').featureValues.get(h)), SCORE)).toBe('12.5');
    expect(await bar.isHidden()).toBe(true);
    // The rebuild builds a fresh editor; it keeps the view the user was in.
    expect(await pane.locator('.data-count').textContent()).toBe('1000 nodes');
    // Apply's rebuild redraws the table; focus stays in it rather than dropping to <body>.
    expect(await grid.evaluate((g) => g.contains(document.activeElement))).toBe(true);
  }, 120_000); // Apply rebuilds the graph
});
