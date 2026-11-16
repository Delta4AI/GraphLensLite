// Print-oriented tidy-up of the visible layout, run in the page. Sigma draws
// nodes and labels at a fixed screen size, so noverlap (graph units, node discs
// only) leaves labels colliding once the view is fitted. This (1) optionally
// stretches the layout to the stage's aspect ratio and (2) pushes apart
// node+label boxes, measured in screen px at the CURRENT camera, so call it
// right after fitting the view (and again after re-fitting: moving nodes changes
// the fit). Positions go through the same persist + redraw path as the app's
// own "Remove overlaps".

export async function declutter(page, { labelFont, nodeSize, stretch = false, gapPx = 10, iterations = 300 }) {
  await page.evaluate(async ({ labelFont, nodeSize, stretch, gapPx, iterations }) => {
    const c = window.cache;
    const g = c.graphData;
    const sigma = c.graph.sigma;
    const ids = g.nodes().filter((id) => !g.getNodeAttribute(id, 'hidden'));
    if (ids.length < 2) return;
    const pos = new Map(ids.map((id) => [id, { x: g.getNodeAttribute(id, 'x'), y: g.getNodeAttribute(id, 'y') }]));
    const bbox = () => {
      const xs = [...pos.values()].map((p) => p.x);
      const ys = [...pos.values()].map((p) => p.y);
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    };

    // (1) Match the stage's aspect ratio (fit is otherwise height-bound).
    const { width: W, height: H } = sigma.getDimensions();
    const b = bbox();
    const aspect = (b.x1 - b.x0) / (b.y1 - b.y0);
    const target = W / H;
    if (stretch && aspect < target) {
      const cx = (b.x0 + b.x1) / 2;
      for (const p of pos.values()) p.x = cx + (p.x - cx) * (target / aspect);
    }

    // (2) Separate boxes in screen px at the current camera.
    const o = sigma.graphToViewport({ x: 0, y: 0 });
    const u = sigma.graphToViewport({ x: 1, y: 0 });
    const pxPerUnit = Math.hypot(u.x - o.x, u.y - o.y);
    // +y in graph space points up or down on screen? Labels sit below the node on screen.
    const down = Math.sign(sigma.graphToViewport({ x: 0, y: 1 }).y - sigma.graphToViewport({ x: 0, y: 0 }).y) || 1;
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${labelFont}px sans-serif`;
    const LABEL_LINE = labelFont * 1.3;
    const box = new Map(ids.map((id) => {
      const w = Math.max(nodeSize, ctx.measureText(g.getNodeAttribute(id, 'label') ?? '').width) + gapPx;
      const h = nodeSize + LABEL_LINE + gapPx;
      return [id, { w: w / pxPerUnit, h: h / pxPerUnit, dy: (down * (LABEL_LINE / 2)) / pxPerUnit }];
    }));
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const [a, bb] = [pos.get(ids[i]), pos.get(ids[j])];
          const [ba, bbx] = [box.get(ids[i]), box.get(ids[j])];
          const dx = bb.x - a.x;
          const dy = (bb.y + bbx.dy) - (a.y + ba.dy);
          const ox = (ba.w + bbx.w) / 2 - Math.abs(dx);
          const oy = (ba.h + bbx.h) / 2 - Math.abs(dy);
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          // Resolve along the axis of least overlap, half each.
          if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; a.x -= s; bb.x += s; }
          else { const s = (dy >= 0 ? 1 : -1) * oy / 2; a.y -= s; bb.y += s; }
        }
      }
      if (!moved) break;
    }
    // Self-check: a layout this pass could not untangle should fail the run, not ship.
    const stuck = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [a, bb] = [pos.get(ids[i]), pos.get(ids[j])];
        const [ba, bbx] = [box.get(ids[i]), box.get(ids[j])];
        const EPS = 1e-6;
        if ((ba.w + bbx.w) / 2 - Math.abs(bb.x - a.x) > EPS && (ba.h + bbx.h) / 2 - Math.abs(bb.y + bbx.dy - a.y - ba.dy) > EPS) {
          stuck.push(`${g.getNodeAttribute(ids[i], 'label')}/${g.getNodeAttribute(ids[j], 'label')}`);
        }
      }
    }
    if (stuck.length) throw new Error(`declutter: labels still overlap: ${stuck.join(', ')}`);

    for (const [id, p] of pos) g.mergeNodeAttributes(id, p);
    await c.lm.persistNodePositions();
    await c.lm.handleLayoutChangeLoadingEvent('Tidy layout', 'Separating labels');
  }, { labelFont, nodeSize, stretch, gapPx, iterations });
}

// Node-label pairs whose boxes overlap on screen at the current camera, using the
// rendered positions (sigma's own graph-to-viewport mapping), not declutter's model.
export async function screenOverlaps(page, { labelFont, nodeSize }) {
  return page.evaluate(({ labelFont, nodeSize }) => {
    const g = window.cache.graphData;
    const sigma = window.cache.graph.sigma;
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${labelFont}px sans-serif`;
    const LABEL_LINE = labelFont * 1.3;
    const boxes = g.nodes().filter((id) => !g.getNodeAttribute(id, 'hidden')).map((id) => {
      const p = sigma.graphToViewport({ x: g.getNodeAttribute(id, 'x'), y: g.getNodeAttribute(id, 'y') });
      const label = g.getNodeAttribute(id, 'label') ?? '';
      return { label, x: p.x, y: p.y + LABEL_LINE / 2, w: Math.max(nodeSize, ctx.measureText(label).width), h: nodeSize + LABEL_LINE };
    });
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2) hits.push(`${a.label}/${b.label}`);
      }
    }
    return hits;
  }, { labelFont, nodeSize });
}
