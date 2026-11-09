import { describe, it, expect, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ==========================================================================
// End to end: the loading overlay is the app's "ready" signal, so when it
// clears after a load, everything the load does must be done — above all the
// undo baseline. An edit made the moment the overlay clears must be undoable.
// Opt-in (needs a display and the Electron binary):
//
//   GLL_E2E=1 npx vitest run --dir tests load-ready
// ==========================================================================

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(ROOT, 'scripts/fixtures/benchmark_1000x1500_overlays.json');
const E2E = !!process.env.GLL_E2E;

describe.skipIf(!E2E)('graph load, end to end', () => {
  let app;

  afterAll(async () => {
    await app?.close();
  });

  it('clears the loading overlay only once the load is finished and undo has its baseline', async () => {
    const { _electron } = await import('playwright');
    app = await _electron.launch({
      executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
      args: [path.join(ROOT, 'tests/e2e/electron_main.cjs')],
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15_000);
    await page.waitForFunction(() => !!window.cache?.io, null, { timeout: 30_000, polling: 100 });

    // Note what the app looks like at the instant the overlay first clears after the load started.
    await page.evaluate(() => {
      const overlay = document.getElementById('loadingOverlay');
      let loading = false;
      new MutationObserver(() => {
        const up = getComputedStyle(overlay).display !== 'none';
        if (up) loading = true;
        else if (loading && !window.__readyAt) {
          window.__readyAt = {
            baseline: !!window.cache.history?.baseline,
            running: window.cache.EVENT_LOCKS.ONCE_AFTER_RENDER_RUNNING,
          };
        }
      }).observe(overlay, { attributes: true, attributeFilter: ['style', 'class'] });
    });
    await page.setInputFiles('#fileInput', FIXTURE);
    await page.waitForFunction(() => !!window.__readyAt, null, { timeout: 90_000, polling: 100 });

    expect(await page.evaluate(() => window.__readyAt)).toEqual({ baseline: true, running: false });
  }, 120_000);
});
