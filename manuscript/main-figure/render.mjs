// Lays the captures out (compose.html) and renders the figure PNG.
//   node manuscript/main-figure/render.mjs   (after capture.mjs)
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { ROOT, SCALE } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(ROOT, 'manuscript/Fig/main-figure.png');
// The page is 1600 app px wide; this many output px across (the 1.17 figure was 3741 at 600 dpi).
const OUTPUT_WIDTH = 3750;
const PAGE_WIDTH = 1600;

const rects = JSON.parse(fs.readFileSync(path.join(HERE, 'out/rects.json'), 'utf8'));
const app = await _electron.launch({
  executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
  args: [path.join(HERE, 'electron_main.cjs')],
  env: { ...process.env, GLL_FIG_PAGE: path.join(HERE, 'compose.html'), GLL_FIG_W: String(PAGE_WIDTH), GLL_FIG_H: '900' },
});
const page = await app.firstWindow();
await page.waitForFunction(() => typeof window.compose === 'function');
const height = await page.evaluate(([r, s]) => window.compose(r, s), [rects, SCALE]);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setDeviceMetricsOverride', { width: PAGE_WIDTH, height, deviceScaleFactor: OUTPUT_WIDTH / PAGE_WIDTH, mobile: false });
await new Promise((r) => setTimeout(r, 500));
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: PAGE_WIDTH, height, scale: 1 } });
fs.writeFileSync(TARGET, Buffer.from(data, 'base64'));
console.log(`wrote ${path.relative(ROOT, TARGET)} (${OUTPUT_WIDTH} px wide, page ${PAGE_WIDTH}x${height})`);
await app.close();
