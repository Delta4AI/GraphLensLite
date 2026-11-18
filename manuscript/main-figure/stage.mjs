// Stages the ADPKD case study in the real app: the Wnt pathway plus context,
// coloured by Wnt role, the tolvaptan signature as a bubble group, PKD1 and PKD2
// selected, labels decluttered, long filter groups folded. Shared by the
// manuscript figure (capture.mjs) and the README screenshots
// (scripts/readme_screenshots.mjs).
import { WIDTH } from './harness.mjs';
import { declutter, screenOverlaps } from './declutter.mjs';

const WNT = 'Node filters::Mechanisms::Wnt signaling';
// Wnt pathway members plus context: strongly ADPKD-linked proteins and the
// tolvaptan signature (drawn grey, as in Fig. 2A).
export const QUERY = `(${WNT} IN [involved in,modulates positive,modulates negative,modulates]) OR ` +
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
const DECLUTTER_PASSES = 3;
// Clear space between node+label boxes, in screen px; more reads less crowded.
const LABEL_GAP_PX = 22;
// Filter groups folded in the panel so sliders (with histograms), categorical
// dropdowns and boolean toggles all fit in one view.
const FOLDED_FILTER_GROUPS = ['Biomarker annotation', 'Expression in healthy', 'scRNAseq data', 'Mechanisms'];

// Resize the inspector the way a user does: drag its left edge.
export async function resizeInspector(h, width) {
  const r = await h.rect('.inspector-resize-handle');
  const y = r.y + r.height / 2;
  await h.page.mouse.move(r.x + r.width / 2, y);
  await h.page.mouse.down();
  await h.page.mouse.move(WIDTH - width, y, { steps: 5 });
  await h.page.mouse.up();
  await h.wait(500);
}

// storage: localStorage entries the app boots with. inspectorWidth: the width
// the scene is laid out at. Returns the app's default inspector width.
export async function stageCaseStudy(h, { storage = {}, inspectorWidth } = {}) {
  const { page } = h;
  await h.seedStorage(storage);
  await h.load();

  const defaultInspectorW = (await h.rect('#inspector')).width;
  if (inspectorWidth) await resizeInspector(h, inspectorWidth);

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
  return { defaultInspectorW };
}
