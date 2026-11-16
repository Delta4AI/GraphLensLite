// Stages the ADPKD case study in the real app and captures every panel the
// manuscript figure shows, at SCALE x device pixels, into ./out/, plus
// out/rects.json (where the numbered elements sit in main.png, in CSS px).
//   node manuscript/main-figure/capture.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch, freeze, thaw, WIDTH, HEIGHT } from './harness.mjs';
import { stubOllama } from './assistant_stub.mjs';
import { declutter, screenOverlaps } from './declutter.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const WNT = 'Node filters::Mechanisms::Wnt signaling';
// Wnt pathway members plus context: strongly ADPKD-linked proteins and the
// tolvaptan signature (drawn grey, as in Fig. 2A).
const QUERY = `(${WNT} IN [involved in,modulates positive,modulates negative,modulates]) OR ` +
  '(Node filters::Literature evidence::ADPKD literature evidence BETWEEN 10 AND 911) OR ' +
  '(Node filters::Drug interference::tolvaptan IS TRUE)';
const CONTEXT_COLOR = '#A3A6B4';
// Okabe-Ito: colour-blind safe, one hue per Wnt role.
const WNT_COLORS = {
  'modulates positive': '#009E73',
  'modulates negative': '#D55E00',
  modulates: '#0072B2',
  'involved in': '#56B4E9',
};
// Larger nodes and labels than the defaults so they survive print scaling.
const NODE_SIZE = 28;
const LABEL_SIZE = 15;
const GROUP_LABEL_SHIFT_PX = [45, -6];
// Each workbench tab is captured at the size of its tile in the figure.
// Metrics' summary column clips below ~920 px and the data toolbar wraps below ~944 px.
const WORKBENCH_WIDTHS = { metrics: 920, query: 664, data: 1600, assistant: 480 };
const WORKBENCH_HEIGHTS = { metrics: 260, query: 260, data: 230, assistant: 720 };
const DECLUTTER_PASSES = 3;
// Inspector width for the window capture: wider than the default so filter labels
// are not truncated (the graph has room to spare). Tiles use the default width.
const INSPECTOR_MAIN_W = 440;
// The Appearance heading sits this far above the mount the app reports for it.
const APPEARANCE_HEADING_PX = 40;
// Print legibility, as figure-only CSS zoom: the query wraps to fill its tile and
// the ranked metrics list fills its box instead of half of it.
const FIGURE_ZOOM = { query: { sel: '#queryEditor', zoom: 1.4 }, metrics: { sel: '.nw-node-multiselect', zoom: 1.3 } };
// Clear space between node+label boxes, in screen px; more reads less crowded.
const LABEL_GAP_PX = 22;
// Tooltips are captured on a taller stage so the expanded node card is not cut at 90vh.
const TOOLTIP_VIEWPORT_H = 1400;
// Filter groups folded in the panel so sliders (with histograms), categorical
// dropdowns and boolean toggles all fit in one view.
const FOLDED_FILTER_GROUPS = ['Biomarker annotation', 'Expression in healthy', 'scRNAseq data', 'Mechanisms'];

fs.mkdirSync(OUT, { recursive: true });
const h = await launch();
const { page } = h;
const shotOf = async (name, sel, pad = 0) => {
  const r = await h.rect(sel);
  await h.shot(path.join(OUT, name), { x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });
};
// No toasts, hover tooltips or focus rings in a figure.
const quiet = async () => {
  await page.mouse.move(WIDTH - 2, 600);
  await page.evaluate(() => {
    document.querySelectorAll('#toasts > *').forEach((t) => t.remove());
    document.activeElement?.blur();
  });
  await h.wait(300);
};
const capture = async (fn) => { await quiet(); await freeze(page); try { await fn(); } finally { await thaw(page); } };
const rects = {};
const recordRects = async (key, selectors) => {
  rects[key] = {};
  for (const [name, sel] of Object.entries(selectors)) rects[key][name] = await h.rect(sel);
};

await h.seedStorage({
  'gll.workbench.heights': WORKBENCH_HEIGHTS,
  'gll.assistant.settings': { endpoint: 'http://localhost:11434', model: 'qwen3.5:9b', numCtx: 16384 },
});
await h.load();

// Resize the inspector the way a user does: drag its left edge.
const resizeInspector = async (width) => {
  const r = await h.rect('.inspector-resize-handle');
  const y = r.y + r.height / 2;
  await page.mouse.move(r.x + r.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(WIDTH - width, y, { steps: 5 });
  await page.mouse.up();
  await h.wait(500);
};
const defaultInspectorW = (await h.rect('#inspector')).width;
await resizeInspector(INSPECTOR_MAIN_W);

// Filter to the Wnt pathway through the query editor, then hand control back to
// the filter panel so both show the same, unlocked state.
await page.evaluate(() => window.cache.workbench.show('query'));
await page.evaluate((q) => {
  const t = document.getElementById('queryTextArea');
  t.textContent = q;
  t.dispatchEvent(new Event('input', { bubbles: true }));
}, QUERY);
await h.wait(800);
await page.click('#queryUpdateBtn');
await h.settle();
await page.click('#queryResetBtn');
await h.settle();
await page.evaluate(() => window.cache.workbench.close());

// Isolated pathway members carry no edges; drop them so the network reads.
await page.click('#relayoutBtn');
await page.evaluate(() => document.getElementById('hideDisconnectedBtn').click());
await h.settle();
await page.keyboard.press('Escape');
await h.settle();
await page.evaluate(() => window.cache.lm.relayoutWorkspace('force'));
await h.settle();
await h.wait(2500);

await page.evaluate(({ size, font }) => window.cache.gcm.updateNodes(
  { style: { size, labelFontSize: font } }, [], { ids: [...window.cache.nodeIDsToBeShown] },
), { size: NODE_SIZE, font: LABEL_SIZE });
await h.settle();
// Pull the tolvaptan signature together (Arrange selection › Force), so its
// bubble group is one compact region instead of a band across the graph.
await page.evaluate(async () => {
  const c = window.cache;
  const ids = [...c.nodeRef].filter(([id, n]) => c.graphData.hasNode(id) && !c.graphData.getNodeAttribute(id, 'hidden')
    && n.D4Data?.['Node filters']?.['Drug interference']?.tolvaptan === 1).map(([id]) => id);
  window.__tolvaptan = ids;
  await c.sm.selectNodes(ids);
  await c.lm.layoutSelectedNodes('force');
  await c.sm.clearSelection();
});
await h.settle();
// Fit, then separate labels at that zoom; moving nodes changes the fit, so repeat.
const fit = async () => { await page.evaluate(() => window.cache.gcm.fitViewToVisibleNodes()); await h.wait(1000); };
for (let pass = 0; pass < DECLUTTER_PASSES; pass++) {
  await fit();
  await declutter(page, { labelFont: LABEL_SIZE, nodeSize: NODE_SIZE, gapPx: LABEL_GAP_PX, stretch: pass === 0 });
  await h.settle();
}
await fit();
const overlaps = await screenOverlaps(page, { labelFont: LABEL_SIZE, nodeSize: NODE_SIZE });
if (overlaps.length) throw new Error(`node labels overlap on screen: ${overlaps.join(', ')}`);

// Colour by Wnt role, through the same style path the appearance editor uses.
await page.evaluate(async (colors) => {
  const c = window.cache;
  const byRole = {};
  for (const [id, n] of c.nodeRef) {
    const role = n.D4Data?.['Node filters']?.Mechanisms?.['Wnt signaling'];
    if (role) (byRole[role] ??= []).push(id);
  }
  const context = [...c.nodeIDsToBeShown].filter((id) => !c.nodeRef.get(id).D4Data?.['Node filters']?.Mechanisms?.['Wnt signaling']);
  await c.gcm.updateNodes({ style: { fill: colors.context } }, [], { ids: context });
  for (const [role, ids] of Object.entries(byRole)) await c.gcm.updateNodes({ style: { fill: colors[role] } }, [], { ids });
}, { ...WNT_COLORS, context: CONTEXT_COLOR });
await h.settle();

// Bubble group: the tolvaptan interference signature.
await page.evaluate(async () => {
  const c = window.cache;
  await c.sm.selectNodes(window.__tolvaptan);
  window.__figGroup = await c.bs.createGroupFromSelection('Tolvaptan signature');
  await c.sm.clearSelection();
});
await h.settle();
await page.evaluate(() => window.cache.sm.addNodeOrEdgeLabelsToSelectionWrapper('PKD1,PKD2', true, true));
await h.settle();
await page.evaluate(() => window.cache.gcm.fitViewToVisibleNodes());
await h.wait(1500);
// Drag the group label off the node labels it lands on (the shift is in graph units).
await page.evaluate(async ([dx, dy]) => {
  const { sigma } = window.cache.graph;
  const a = sigma.viewportToGraph({ x: 0, y: 0 });
  const b = sigma.viewportToGraph({ x: dx, y: dy });
  await window.cache.bs.setLabelShift(window.__figGroup, b.x - a.x, b.y - a.y);
}, GROUP_LABEL_SHIFT_PX);
await h.wait(800);

// Filter panel: fold the long groups, then scroll to the first property group.
await page.evaluate((folded) => {
  const subgroups = [...document.querySelectorAll('#filterContainer .filter-subgroup')];
  const header = (name) => subgroups.map((s) => s.firstElementChild)
    .find((hd) => hd.textContent.trim().toLowerCase().includes(name.toLowerCase()));
  for (const name of folded) {
    const chevron = header(name)?.querySelector('.filter-group-chevron');
    if (!chevron) throw new Error(`filter group "${name}" not found`);
    if (chevron.getAttribute('aria-expanded') === 'true') chevron.click();
  }
  const scroller = document.getElementById('inspectorBody');
  scroller.scrollTop += subgroups[0].getBoundingClientRect().top - scroller.getBoundingClientRect().top - 8;
}, FOLDED_FILTER_GROUPS);
await h.wait(500);

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
await resizeInspector(defaultInspectorW);

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
