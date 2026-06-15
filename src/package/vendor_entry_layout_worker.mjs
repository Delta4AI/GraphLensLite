// Entry for the off-main-thread layout worker (src/lib/layout_worker_source.js).
// Bundled to a self-contained IIFE by src/package/vendor_libs.js and embedded
// as a string so layout_algorithms.js can spin up a Blob worker at runtime —
// this survives the single-file inline-html dist (no separate worker chunk to
// fetch). Runs the heavy headless @antv/layout v2 classes (dagre/mds/radial/
// concentric) in a worker thread so a large graph never freezes the main
// thread. Mirrors how graphology's FA2 worker keeps force layouts smooth.
import {
  RadialLayout,
  ConcentricLayout,
  MDSLayout,
  DagreLayout,
} from "@antv/layout";

const LAYOUTS = {
  radial: RadialLayout,
  concentric: ConcentricLayout,
  mds: MDSLayout,
  dagre: DagreLayout,
};

// Receives {type, options, nodes:[{id}], edges:[{id,source,target}]} — the same
// flat data shape executeAntvLayout builds on the main thread — runs the layout
// headlessly and posts back [{id, x, y}]. y-up negation stays on the main
// thread (the worker is layout-frame agnostic). Errors are posted, not thrown,
// so the awaiting side can reject cleanly and fall through to its finally.
self.onmessage = async (event) => {
  const { type, options, nodes, edges } = event.data;
  const LayoutClass = LAYOUTS[type];
  if (!LayoutClass) {
    self.postMessage({ error: `Unknown layout type: ${type}` });
    return;
  }
  const inst = new LayoutClass(options);
  try {
    await inst.execute({ nodes, edges });
    const positions = [];
    inst.forEachNode(({ id, x, y }) => positions.push({ id, x, y }));
    self.postMessage({ positions });
  } catch (err) {
    self.postMessage({ error: err && err.message ? err.message : String(err) });
  } finally {
    inst.destroy();
  }
};
