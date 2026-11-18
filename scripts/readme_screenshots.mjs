/* global window, document */ // browser globals run inside page.evaluate() callbacks
// Recaptures the README screenshots (static/screenshots/) from the running app,
// on the ADPKD case study the manuscript figure uses.
//   node scripts/readme_screenshots.mjs
// Needs a display and a dbus session (Electron offscreen with WebGL2) and
// pngquant on PATH. Takes about 3 minutes.
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, snapshot, ROOT } from '../manuscript/main-figure/harness.mjs';
import { stageCaseStudy } from '../manuscript/main-figure/stage.mjs';
import { stubOllama } from '../manuscript/main-figure/assistant_stub.mjs';

const OUT = path.join(ROOT, 'static/screenshots');
// 1600x920 CSS px at 1.5x gives 2400 px wide images: sharp on a high-DPI
// screen, still small after quantisation.
const SCALE = 1.5;
// Wide enough that filter names are not truncated.
const INSPECTOR_W = 440;
const WORKBENCH_HEIGHTS = { metrics: 320, query: 220, data: 330, assistant: 440 };
// The node tooltip sits at the stage's left edge; the graph is framed to its right.
const TOOLTIP_W = 340;
const TOOLTIP_MARGIN = 16;
// Room around the outermost nodes for their size and labels, in CSS px.
const FRAME_PAD_PX = 48;
const ASSISTANT_QUESTIONS = [
  'Which Wnt pathway members does tolvaptan interfere with?',
  'What can you tell me about the selected nodes?',
];

fs.mkdirSync(OUT, { recursive: true });
const h = await launch({ scale: SCALE });
const { page } = h;
const written = [];
// Frame the shown nodes into the part of the stage left uncovered: a workbench
// pane lies over the stage's bottom rather than shrinking it, so the app's own
// fit would leave nodes under it. Insets are CSS px from the stage edges.
const frame = async ({ left = 0, bottom = 0 } = {}) => {
  await page.evaluate(({ left: l, bottom: b, pad }) => {
    const c = window.cache;
    const { sigma } = c.graph;
    const graph = sigma.getGraph();
    const pts = [...c.nodeIDsToBeShown].filter((id) => !c.hiddenDanglingNodeIDs.has(id) && graph.hasNode(id))
      .map((id) => sigma.graphToViewport(graph.getNodeAttributes(id)));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const box = { x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad };
    const { width, height } = sigma.getDimensions();
    const target = { x0: l, x1: width, y0: 0, y1: height - b };
    const camera = sigma.getCamera();
    const anchor = sigma.viewportToFramedGraph({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 });
    const scale = Math.max((box.x1 - box.x0) / (target.x1 - target.x0), (box.y1 - box.y0) / (target.y1 - target.y0));
    camera.setState({ ratio: camera.getState().ratio * scale });
    // Then move the box's centre onto the target's centre.
    const at = sigma.framedGraphToViewport(anchor);
    const dx = (target.x0 + target.x1) / 2 - at.x;
    const dy = (target.y0 + target.y1) / 2 - at.y;
    const centre = sigma.viewportToFramedGraph({ x: width / 2 - dx, y: height / 2 - dy });
    camera.setState({ x: centre.x, y: centre.y });
  }, { left, bottom, pad: FRAME_PAD_PX });
  await h.wait(1200);
};
const workbenchInset = () => page.evaluate(() => {
  const stage = document.getElementById('innerGraphContainer').getBoundingClientRect();
  return { bottom: stage.bottom - document.getElementById('workbench').getBoundingClientRect().top };
});
// The filter panel from the top, so the Build up / Narrow down switch shows.
const filtersFromTop = () => page.evaluate(() => {
  window.cache.inspector.setContext('filters');
  document.getElementById('inspectorBody').scrollTop = 0;
});
const shot = async (name) => {
  const file = path.join(OUT, name);
  await h.shot(file);
  written.push(file);
};

// The launch screen comes before any graph exists, so there is no canvas to freeze.
await h.wait(1000);
await shot('launch_screen.png');

await stageCaseStudy(h, {
  storage: {
    'gll.workbench.heights': WORKBENCH_HEIGHTS,
    'gll.assistant.settings': { endpoint: 'http://localhost:11434', model: 'qwen3.5:9b', numCtx: 16384 },
  },
  inspectorWidth: INSPECTOR_W,
});
await filtersFromTop();
await h.wait(500);
await snapshot(page, () => shot('overview.png'));

// Selection tab with the PKD1 tooltip open over the graph.
await page.evaluate(() => {
  window.cache.inspector.setContext('selection');
  document.getElementById('inspectorBody').scrollTop = 0;
});
// Frame first: any camera move closes the tooltip.
await frame({ left: TOOLTIP_W + 2 * TOOLTIP_MARGIN });
const pkd1 = await page.evaluate(() => [...window.cache.nodeRef].find(([, n]) => n.label === 'PKD1')[0]);
await page.evaluate(({ id, width, margin }) => {
  window.cache.graph.interactions.showTooltip(id, false);
  const stage = document.getElementById('innerGraphContainer').getBoundingClientRect();
  const tip = document.querySelector('.tooltip');
  Object.assign(tip.style, { left: `${stage.left + margin}px`, width: `${width}px` });
  tip.style.top = `${stage.top + (stage.height - tip.offsetHeight) / 2}px`;
}, { id: pkd1, width: TOOLTIP_W, margin: TOOLTIP_MARGIN });
await h.wait(800);
await snapshot(page, () => shot('selection_and_tooltip.png'));
await page.evaluate(() => window.cache.graph.interactions.hideTooltip());
await filtersFromTop();

for (const [tab, name] of [['query', 'query_editor.png'], ['metrics', 'network_metrics.png'], ['data', 'data_editor.png']]) {
  await page.evaluate((t) => window.cache.workbench.show(t), tab);
  await h.settle();
  // The data editor opens on the selection (2 rows); show the whole node table.
  if (tab === 'data') { await page.click('#dataEditor [data-scope="all"]'); await h.settle(); }
  await frame(await workbenchInset());
  await snapshot(page, () => shot(name));
}

await stubOllama(page);
await page.evaluate(() => window.cache.workbench.show('assistant'));
await frame(await workbenchInset());
for (const q of ASSISTANT_QUESTIONS) {
  await page.evaluate((text) => window.cache.assistant.send(text), q);
  await page.waitForFunction(() => !window.cache.assistant._streaming, null, { polling: 100 });
  await h.wait(1500);
}
await page.evaluate(() => { document.getElementById('assistantMessages').scrollTop = 0; });
await snapshot(page, () => shot('graph_assistant.png'));

await h.app.close();
if (h.errors.length) throw new Error(`page errors:\n${h.errors.join('\n')}`);
execFileSync('pngquant', ['--force', '--skip-if-larger', '--quality=80-95', '--ext', '.png', ...written], { stdio: 'inherit' });
console.log(written.map((f) => path.relative(ROOT, f)).join('\n'));
