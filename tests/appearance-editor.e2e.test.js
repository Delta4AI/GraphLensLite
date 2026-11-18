import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ==========================================================================
// End to end, in the real app (Electron = full Chromium with WebGL2): select
// a mixed graph, read "Mixed", restyle every node, recolour one colour from
// the "In selection" row, then undo. Opt-in — it needs a display and the
// Electron binary — so the default `npm test` skips it:
//
//   GLL_E2E=1 npx vitest run tests/appearance-editor.e2e.test.js
// ==========================================================================

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/benchmark_1000x1500_overlays.json');
const E2E = !!process.env.GLL_E2E;

describe.skipIf(!E2E)('appearance editor, end to end', () => {
  let app;
  let page;

  const settled = () =>
    page.waitForFunction(() => {
      const overlay = document.getElementById('loadingOverlay');
      return !overlay || getComputedStyle(overlay).display === 'none';
    }, null, { timeout: 60_000, polling: 250 }); // rAF polling stalls in a hidden window
  const node = (id) => page.evaluate((nid) => {
    const n = window.cache.nodeRef.get(nid);
    return { size: n.style.size, fill: n.style.fill, type: n.type };
  }, id);
  const sizeField = () => page.locator('[data-property="Node Size"] .style-input-sm');
  // An edit is done once its undo step exists: the loading overlay hides before
  // updateNodes reaches history.commit, which under software WebGL is seconds later.
  const recorded = (n) => page.waitForFunction((count) => window.cache.history.past.length >= count, n,
    { timeout: 30_000, polling: 100 });

  beforeAll(async () => {
    const { _electron } = await import('playwright');
    app = await _electron.launch({
      executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
      args: [path.join(ROOT, 'tests/e2e/electron_main.cjs')],
    });
    page = await app.firstWindow();
    page.setDefaultTimeout(15_000);
    // firstWindow() can return before gll.js has wired the file input.
    await page.waitForFunction(() => !!window.cache?.io, null, { timeout: 30_000, polling: 100 });
    await page.setInputFiles('#fileInput', FIXTURE);
    // Ready = the graph is built AND its post-render work is done: the overlay
    // hides before that work ends, and undo's baseline is only recorded at its
    // end (core.js ONCE_AFTER_RENDER).
    await page.waitForFunction(() => window.cache?.nodeRef?.size > 0
      && window.cache.EVENT_LOCKS?.ONCE_AFTER_RENDER_RUNNING === false
      && !!window.cache.history?.baseline, null, { timeout: 90_000, polling: 250 });
    await settled();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('shows Mixed, applies to all, recolours one colour, and undoes', async () => {
    // Select every node through the rail's Select menu, as a user would.
    await page.click('#selectMenuBtn');
    await page.getByRole('button', { name: 'All (nodes)' }).click();
    await settled();
    await page.click('#inspectorPillSelection');

    // The fixture's nodes differ in fill: the editor says so instead of a default.
    await expect.poll(() => page.locator('.color-hex[data-property="Node Fill Color"]').getAttribute('placeholder'))
      .toBe('Mixed');
    const before = await node('n0');

    // Restyle all of them: a size typed and committed with Enter, a shape segment.
    await sizeField().fill('33');
    await sizeField().press('Enter');
    await settled();
    await recorded(1);
    expect((await node('n0')).size).toBe(33);
    expect((await node('n999')).size).toBe(33);
    await page.getByRole('button', { name: 'Star' }).click();
    await settled();
    await recorded(2);
    expect((await node('n0')).type).toBe('star');
    expect(await page.getByRole('button', { name: 'Star' }).getAttribute('aria-pressed')).toBe('true');

    // "In selection": recolour only the nodes that share n0's fill.
    const chip = page.locator('.prop-row-selection-colors .prop-chip').first();
    expect(await page.locator('.prop-row-selection-colors .prop-chip').count()).toBeGreaterThan(1);
    const targetFill = await page.evaluate(() => window.cache.nodeRef.get('n0').style.fill);
    const sameFill = await page.evaluate((fill) =>
      [...window.cache.nodeRef.values()].filter((n) => n.style.fill?.toLowerCase() === fill.toLowerCase()).length,
    targetFill);
    expect(Number(await chip.textContent())).toBeGreaterThan(0);
    // Drive the chip whose colour is n0's, then answer its picker.
    await page.evaluate((fill) => {
      const chips = [...document.querySelectorAll('.prop-row-selection-colors .prop-chip')];
      const mine = chips.find((c) => c.title.toLowerCase().startsWith(fill.toLowerCase()));
      const picker = document.querySelector('.prop-row-selection-colors .prop-chip-picker');
      picker.showPicker = () => {}; // the native dialog cannot be driven; its result can
      mine.click();
      picker.value = '#123456';
      picker.dispatchEvent(new Event('change'));
    }, targetFill);
    await settled();
    await expect.poll(async () => (await node('n0')).fill).toBe('#123456');
    await recorded(3);
    const recoloured = await page.evaluate(() =>
      [...window.cache.nodeRef.values()].filter((n) => n.style.fill === '#123456').length);
    expect(recoloured).toBe(sameFill);

    // One undo step per edit: three undos restore the original node.
    for (let i = 0; i < 3; i++) {
      const depth = await page.evaluate(() => window.cache.history.past.length);
      await page.click('#historyUndoBtn');
      // The overlay may not be up yet when the click returns: wait for the
      // restore itself, or the next click lands mid-restore and is ignored.
      await page.waitForFunction((d) => window.cache.history.past.length === d - 1
        && !window.cache.history.restoring, depth, { timeout: 30_000, polling: 100 });
      await settled();
    }
    const after = await node('n0');
    expect(after).toEqual(before);
  }, 120_000);
});
