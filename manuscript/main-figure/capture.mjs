// Stages the ADPKD case study in the real app and captures every panel the
// manuscript figure shows, at SCALE x device pixels, into ./out/, plus
// out/rects.json (where the numbered elements sit in main.png, in CSS px).
//   node manuscript/main-figure/capture.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, snapshot, WIDTH, HEIGHT } from './harness.mjs';
import { stubOllama } from './assistant_stub.mjs';
import { stageCaseStudy, resizeInspector } from './stage.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
// Each workbench tab is captured at the size of its tile in the figure.
// Metrics' summary column clips below ~920 px and the data toolbar wraps below ~944 px.
const WORKBENCH_WIDTHS = { metrics: 920, query: 664, data: 1600, assistant: 480 };
const WORKBENCH_HEIGHTS = { metrics: 260, query: 260, data: 230, assistant: 720 };
// Inspector width for the window capture: wider than the default so filter labels
// are not truncated (the graph has room to spare). Tiles use the default width.
const INSPECTOR_MAIN_W = 440;
// The Appearance heading sits this far above the mount the app reports for it.
const APPEARANCE_HEADING_PX = 40;
// Print legibility, as figure-only CSS zoom: the query wraps to fill its tile and
// the ranked metrics list fills its box instead of half of it.
const FIGURE_ZOOM = { query: { sel: '#queryEditor', zoom: 1.4 }, metrics: { sel: '.nw-node-multiselect', zoom: 1.3 } };
// Tooltips are captured on a taller stage so the expanded node card is not cut at 90vh.
const TOOLTIP_VIEWPORT_H = 1400;

fs.mkdirSync(OUT, { recursive: true });
const h = await launch();
const { page } = h;
const shotOf = async (name, sel, pad = 0) => {
  const r = await h.rect(sel);
  await h.shot(path.join(OUT, name), { x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });
};
const capture = (fn) => snapshot(page, fn);
const rects = {};
const recordRects = async (key, selectors) => {
  rects[key] = {};
  for (const [name, sel] of Object.entries(selectors)) rects[key][name] = await h.rect(sel);
};

const { defaultInspectorW } = await stageCaseStudy(h, {
  storage: {
    'gll.workbench.heights': WORKBENCH_HEIGHTS,
    'gll.assistant.settings': { endpoint: 'http://localhost:11434', model: 'qwen3.5:9b', numCtx: 16384 },
  },
  inspectorWidth: INSPECTOR_MAIN_W,
});

await capture(() => h.shot(path.join(OUT, 'main.png')));
// FIG_MAIN_ONLY=1: stop after the window capture (quick layout iterations).
if (process.env.FIG_MAIN_ONLY) { await h.app.close(); process.exit(0); }
rects.window = { width: WIDTH, height: HEIGHT };
await recordRects('main', {
  stage: '#innerGraphContainer',
  file: '#appMenuBtn',
  workspace: '#workspaceChip',
  data: '#dataToggleBtn',
  query: '#queryToggleBtn',
  metrics: '#metricsToggleBtn',
  assistant: '#assistantToggleBtn',
  export: '#exportMenuBtn',
  filters: '#inspectorPillFilters',
  overlays: '#inspectorPillOverlays',
  selection: '#inspectorPillSelection',
  inspector: '#inspector',
});
await resizeInspector(h, defaultInspectorW);

for (const tab of ['selection', 'overlays']) {
  await page.evaluate((t) => window.cache.inspector.setContext(t), tab);
  // The inspector body keeps its scroll across tabs; the filter panel left it scrolled.
  await page.evaluate(() => { document.getElementById('inspectorBody').scrollTop = 0; });
  // Overlays: open the Groups pane, so the tile shows the group and its settings.
  if (tab === 'overlays') await page.click('#inspector button[aria-label="Groups settings"]');
  // Appearance: open Badges, so the tile has no empty tail.
  if (tab === 'selection') {
    const fold = await page.evaluateHandle(() => [...document.querySelectorAll('#inspectorAppearanceMount .prop-fold-head')]
      .find((b) => b.textContent.includes('Badges')));
    if (!fold.asElement()) throw new Error('Badges fold not found');
    await fold.asElement().click();
  }
  await h.wait(600);
  await capture(() => shotOf(`inspector_${tab}.png`, '#inspector'));
  if (tab === 'selection') {
    await recordRects('inspector', { inspector: '#inspector', appearance: '#inspectorAppearanceMount' });
    // Appearance gets its own capture, scrolled to its heading, so the tile
    // continues into the folds below the inspector's first screen.
    await page.evaluate((headingPx) => {
      const body = document.getElementById('inspectorBody');
      const mount = document.getElementById('inspectorAppearanceMount');
      body.scrollTop += mount.getBoundingClientRect().top - body.getBoundingClientRect().top - headingPx;
    }, APPEARANCE_HEADING_PX);
    await h.wait(400);
    await capture(() => shotOf('inspector_appearance.png', '#inspectorBody'));
    // The body may not scroll that far; record where the heading actually is.
    rects.appearanceTop = await page.evaluate((headingPx) => {
      const body = document.getElementById('inspectorBody').getBoundingClientRect();
      return document.getElementById('inspectorAppearanceMount').getBoundingClientRect().top - body.top - headingPx;
    }, APPEARANCE_HEADING_PX);
  }
}
await page.evaluate(() => window.cache.inspector.setContext('filters'));

// Workbench tabs, each on a stage as wide as its tile in the figure (the
// workbench spans the stage, which is the viewport minus the inspector).
const stageWidth = (width) => width + defaultInspectorW;
rects.workbench = {};
for (const tab of ['metrics', 'data', 'query']) {
  await h.viewport(stageWidth(WORKBENCH_WIDTHS[tab]));
  await page.evaluate((t) => window.cache.workbench.show(t), tab);
  await h.settle();
  // The data editor opens on the selection (2 rows); show the whole node table.
  if (tab === 'data') { await page.click('#dataEditor [data-scope="all"]'); await h.settle(); }
  const zoom = FIGURE_ZOOM[tab];
  if (zoom) await page.evaluate(({ sel, zoom: z }) => { document.querySelector(sel).style.zoom = z; }, zoom);
  await h.wait(800);
  await capture(() => shotOf(`workbench_${tab}.png`, '#workbench'));
  if (zoom) await page.evaluate(({ sel }) => { document.querySelector(sel).style.zoom = ''; }, zoom);
  rects.workbench[tab] = await h.rect('#workbench');
}

await h.viewport(stageWidth(WORKBENCH_WIDTHS.assistant));
await h.wait(800);
await stubOllama(page);
await page.evaluate(() => window.cache.workbench.show('assistant'));
await h.wait(800);
for (const q of [
  'Which Wnt pathway members does tolvaptan interfere with?',
  'What can you tell me about the selected nodes?',
]) {
  await page.evaluate((text) => window.cache.assistant.send(text), q);
  await page.waitForFunction(() => !window.cache.assistant._streaming, null, { polling: 100 });
  await h.wait(1500);
}
await page.evaluate(() => { document.getElementById('assistantMessages').scrollTop = 0; });
await capture(() => shotOf('workbench_assistant.png', '#workbench'));
rects.workbench.assistant = await h.rect('#workbench');
await page.evaluate(() => window.cache.workbench.close());

// Tooltips last, so the node tooltip carries the computed metric line.
await h.viewport(undefined, TOOLTIP_VIEWPORT_H);
await h.wait(800);
const ids = await page.evaluate(() => {
  const c = window.cache;
  const id = (label) => [...c.nodeRef].find(([, n]) => n.label === label)[0];
  const [a, b] = [id('PKD1'), id('PKD2')];
  const edge = [...c.edgeRef.keys()].find((k) => k.includes(a) && k.includes(b));
  if (!edge) throw new Error('no PKD1–PKD2 edge');
  return { node: a, edge };
});
await page.evaluate(({ node }) => window.cache.graph.interactions.showTooltip(node, false), ids);
await h.wait(500);
// Expanded ("fit content") so the card shows more than its default 400 px, but
// held at its default width so it fits the figure's tooltip column.
await page.click('.tooltip .tooltip-expand-btn');
await page.evaluate(() => document.querySelector('.tooltip').style.setProperty('width', '360px', 'important'));
await h.wait(500);
await capture(() => shotOf('tooltip_node.png', '.tooltip'));
rects.tooltips = { node: await h.rect('.tooltip') };
await page.click('.tooltip .tooltip-expand-btn');
await page.evaluate(({ edge }) => window.cache.graph.interactions.showTooltip(edge, true), ids);
await h.wait(500);
await capture(() => shotOf('tooltip_edge.png', '.tooltip'));
rects.tooltips.edge = await h.rect('.tooltip');

fs.writeFileSync(path.join(OUT, 'rects.json'), JSON.stringify(rects, null, 2));
if (h.errors.length) console.error('page errors:\n' + h.errors.join('\n'));
await h.app.close();
