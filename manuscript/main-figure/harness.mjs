// Drives the real app (Electron, offscreen) for the manuscript figure captures.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const DATASET = path.join(ROOT, 'manuscript/2026-06-26_ADPKD_model_GLL-input_GLL-paper-version.xlsx');
export const WIDTH = 1600;
export const HEIGHT = 920;
export const SCALE = 3;

export async function launch() {
  const app = await _electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
    args: [path.join(HERE, 'electron_main.cjs')],
    env: { ...process.env, GLL_FIG_W: String(WIDTH), GLL_FIG_H: String(HEIGHT) },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForFunction(() => !!window.cache?.io, null, { timeout: 30_000, polling: 100 });
  const cdp = await page.context().newCDPSession(page);
  const viewport = (width = WIDTH, height = HEIGHT) =>
    cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: SCALE, mobile: false });
  await viewport();

  const settle = () => page.waitForFunction(() => {
    const c = window.cache;
    const overlay = document.getElementById('loadingOverlay');
    return c.EVENT_LOCKS.ONCE_AFTER_RENDER_RUNNING === false && (!overlay || getComputedStyle(overlay).display === 'none');
  }, null, { timeout: 90_000, polling: 250 });

  return {
    app, page, cdp, errors, settle, viewport,
    // Seed localStorage (the profile is fresh each run), then reload so the app boots with it.
    async seedStorage(entries) {
      await page.evaluate((e) => { for (const [k, v] of Object.entries(e)) localStorage.setItem(k, JSON.stringify(v)); }, entries);
      await page.reload();
      await page.waitForFunction(() => !!window.cache?.io, null, { timeout: 30_000, polling: 100 });
      await viewport();
    },
    async load(file = DATASET) {
      await page.setInputFiles('#fileInput', file);
      await page.waitForFunction(() => window.cache.nodeRef?.size > 0 && !!window.cache.history?.baseline, null, { timeout: 90_000, polling: 250 });
      await settle();
    },
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    // clip in CSS px; output is SCALE x larger.
    async shot(file, clip) {
      const opts = { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) };
      const { data } = await cdp.send('Page.captureScreenshot', opts);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
    },
    rect: (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) throw new Error(`no element ${s}`);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, sel),
  };
}

// Offscreen CDP captures drop every <canvas> (WebGL and 2D alike). Before a
// capture, cover the sigma stage with the app's own export (rendered at the
// live devicePixelRatio, so it matches the stage pixel for pixel) and swap each
// other visible canvas for an <img> snapshot; thaw() undoes both.
export async function freeze(page) {
  await page.evaluate(async () => {
    const adapter = window.cache.graph;
    const stage = adapter.sigma.getContainer();
    const { url } = await adapter.toDataURL({ scale: 1 });
    const img = new Image();
    img.src = url;
    await img.decode();
    img.className = 'fig-freeze';
    Object.assign(img.style, { position: 'absolute', left: '0', top: '0', width: `${stage.clientWidth}px`, height: `${stage.clientHeight}px`, pointerEvents: 'none' });
    // Right above sigma's own layers, so the minimap and other stage overlays stay on top.
    [...stage.querySelectorAll(':scope > canvas[class^="sigma-"]')].pop().after(img);
    // The minimap paints a fixed 200x120 bitmap; give it device pixels first.
    const mini = adapter.minimap?.canvas;
    if (mini && mini.width === mini.clientWidth) {
      const dpr = window.devicePixelRatio;
      Object.assign(mini.style, { width: `${mini.width}px`, height: `${mini.height}px` });
      mini.width *= dpr;
      mini.height *= dpr;
      adapter.minimap.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      adapter.minimap.scheduleRedraw();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    for (const c of document.querySelectorAll('canvas')) {
      if (c.className.startsWith('sigma-') || !c.offsetParent || !c.width) continue;
      const snap = new Image();
      snap.src = c.toDataURL();
      await snap.decode();
      // Same classes, so the canvas's own frame, background and shadow apply.
      snap.className = `${c.className} fig-freeze`;
      const cs = getComputedStyle(c);
      Object.assign(snap.style, { position: cs.position === 'static' ? 'relative' : cs.position, left: cs.left, top: cs.top, right: cs.right, bottom: cs.bottom, width: `${c.clientWidth}px`, height: `${c.clientHeight}px`, pointerEvents: 'none' });
      c.after(snap);
      c.dataset.figHidden = '1';
      c.style.visibility = 'hidden';
    }
  });
}

export async function thaw(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.fig-freeze').forEach((e) => e.remove());
    document.querySelectorAll('[data-fig-hidden]').forEach((c) => { c.style.visibility = ''; delete c.dataset.figHidden; });
  });
}
