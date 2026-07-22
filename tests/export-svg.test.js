import { describe, it, expect } from "vitest";
import { buildGraphSvg, collectSvgScene, primitivesToSvg } from "../src/graph/export_svg.js";
import { smoothClosedPath } from "../src/graph/bubble_smoothing.js";
import { DEFAULTS } from "../src/config.js";

// ==========================================================================
// Vector (SVG) export. Sigma is faked with the house camera-aware coordinate
// model (bubble-layer-repro.test.js pattern): graph == framed coords,
// y-flipped projection, scaleSize = s / sqrt(ratio). Display data lives in
// plain Maps behind getNode/EdgeDisplayData.
// ==========================================================================

const K = 100; // graph->viewport scale at camera ratio 1
const CHAR_W = 6; // measureText fake: text.length * CHAR_W

const BASE_SETTINGS = {
  renderLabels: true,
  renderEdgeLabels: true,
  minEdgeThickness: 1,
  labelFont: "Arial",
  labelWeight: "normal",
  labelSize: 12,
  labelColor: { color: "#000" },
  edgeLabelFont: "Arial",
  edgeLabelWeight: "normal",
  edgeLabelSize: 12,
  edgeLabelColor: { color: "#000" },
};

function makeScene({
  nodes = [],
  edges = [],
  camera = { x: 0, y: 0, ratio: 1 },
  dims = { width: 800, height: 600 },
  settings = {},
  displayedNodeLabels,
  displayedEdgeLabels,
} = {}) {
  const nodeData = new Map(
    nodes.map((n) => [
      n.id,
      { hidden: false, zIndex: 0, label: null, size: 5, color: "#111111", type: "circle", x: 0, y: 0, ...n },
    ]),
  );
  const edgeData = new Map(
    edges.map((e) => [
      e.id,
      { hidden: false, zIndex: 0, label: null, size: 1, color: "#222222", type: "line", ...e },
    ]),
  );
  const allSettings = { ...BASE_SETTINGS, ...settings };
  const project = (g) => ({
    x: dims.width / 2 + ((g.x - camera.x) / camera.ratio) * K,
    y: dims.height / 2 - ((g.y - camera.y) / camera.ratio) * K,
  });
  const labeledKeys = (map) => new Set([...map.keys()].filter((id) => map.get(id).label));

  const sigma = {
    graphToViewport: project,
    framedGraphToViewport: project, // fake: framed coords == graph coords
    scaleSize: (s) => s / Math.sqrt(camera.ratio),
    getSetting: (name) => allSettings[name],
    getNodeDisplayData: (id) => (nodeData.has(id) ? { ...nodeData.get(id) } : undefined),
    getEdgeDisplayData: (id) => (edgeData.has(id) ? { ...edgeData.get(id) } : undefined),
    getNodeDisplayedLabels: () => displayedNodeLabels ?? labeledKeys(nodeData),
    getEdgeDisplayedLabels: () => displayedEdgeLabels ?? labeledKeys(edgeData),
  };
  const graph = {
    nodes: () => [...nodeData.keys()],
    edges: () => [...edgeData.keys()],
    source: (id) => edgeData.get(id).source,
    target: (id) => edgeData.get(id).target,
  };
  const measureText = (text) => String(text).length * CHAR_W;
  return { sigma, graph, dims, measureText };
}

function build(scene, extra = {}) {
  return buildGraphSvg({
    sigma: scene.sigma,
    graph: scene.graph,
    dims: scene.dims,
    background: "#ffffff",
    bubbleGroups: [],
    measureText: scene.measureText,
    ...extra,
  });
}

describe("buildGraphSvg — document shell & happy path", () => {
  it("renders a standalone SVG with background, edge line, node circles and labels", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0, label: "AlphaLabel" },
        { id: "b", x: 1, y: 0, label: "BetaLabel" },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    });

    const svg = build(scene);

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('<rect x="0" y="0" width="800" height="600" fill="#ffffff"/>');
    expect(svg).toContain('<line x1="400" y1="300" x2="500" y2="300" stroke="#222222" stroke-width="1"/>');
    expect(svg).toContain('<circle cx="400" cy="300" r="5" fill="#111111"/>');
    expect(svg).toContain('<circle cx="500" cy="300" r="5" fill="#111111"/>');
    expect(svg).toContain(">AlphaLabel</text>");
    expect(svg).toContain(">BetaLabel</text>");
  });

  it("exposes the scene/serializer split (collectSvgScene feeds primitivesToSvg)", () => {
    const scene = makeScene({ nodes: [{ id: "a", x: 0, y: 0 }] });

    const primitives = collectSvgScene({
      sigma: scene.sigma,
      graph: scene.graph,
      bubbleGroups: [],
      measureText: scene.measureText,
    });
    const svg = primitivesToSvg(primitives, scene.dims, "#ffffff");

    expect(primitives).toEqual([{ kind: "circle", cx: 400, cy: 300, r: 5, fill: "#111111" }]);
    expect(svg).toContain('<circle cx="400" cy="300" r="5" fill="#111111"/>');
  });

  it("rejects invalid dims and a missing measureText", () => {
    const scene = makeScene();

    expect(() => build(scene, { dims: { width: 0, height: 600 } })).toThrow(/dims/);
    expect(() => build(scene, { dims: { width: NaN, height: 600 } })).toThrow(/dims/);
    expect(() => build(scene, { measureText: null })).toThrow(/measureText/);
    expect(() => buildGraphSvg(null)).toThrow(/args/);
  });
});

describe("visibility & ordering", () => {
  it("skips hidden nodes", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "ghost", x: 1, y: 0, hidden: true, label: "GhostLabel" },
      ],
    });

    const svg = build(scene);

    expect(svg).toContain('cx="400"');
    expect(svg).not.toContain('cx="500"');
    expect(svg).not.toContain("GhostLabel");
  });

  it("skips an edge whose endpoint is hidden", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 1, y: 0, hidden: true },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    });

    expect(build(scene)).not.toContain("<line");
  });

  it("skips a hidden edge", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 1, y: 0 },
      ],
      edges: [{ id: "e1", source: "a", target: "b", hidden: true }],
    });

    expect(build(scene)).not.toContain("<line");
  });

  it("draws nodes in ascending zIndex order", () => {
    const scene = makeScene({
      nodes: [
        { id: "raised", x: 0, y: 0, zIndex: 1, color: "#aaaaaa" },
        { id: "base", x: 1, y: 0, zIndex: 0, color: "#bbbbbb" },
      ],
    });

    const svg = build(scene);

    expect(svg.indexOf("#bbbbbb")).toBeLessThan(svg.indexOf("#aaaaaa"));
  });
});

describe("node types", () => {
  it("renders borderCircle as outer border ring + inner fill disc per borderRatio", () => {
    const scene = makeScene({
      nodes: [
        {
          id: "a", x: 0, y: 0, type: "borderCircle", size: 10,
          borderRatio: 0.25, borderColor: "#ff0000", color: "#00ff00",
        },
      ],
    });

    const svg = build(scene);

    expect(svg).toContain('<circle cx="400" cy="300" r="10" fill="#ff0000"/>');
    expect(svg).toContain('<circle cx="400" cy="300" r="7.5" fill="#00ff00"/>');
  });

  it("renders square as an axis-aligned rect with half-side R", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, type: "square", size: 8, color: "#336699" }],
    });

    expect(build(scene)).toContain('<rect x="392" y="292" width="16" height="16" fill="#336699"/>');
  });

  it("passes the shape image href through (escaped) without an underlay when transparent", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0, type: "shape", color: "#00000000", image: "data:image/svg+xml,%3Csvg%3E&x" },
      ],
    });

    const svg = build(scene);

    expect(svg).toContain('<image href="data:image/svg+xml,%3Csvg%3E&amp;x" x="395" y="295" width="10" height="10"/>');
    expect(svg).not.toContain("<circle");
  });

  it("draws a background disc under the shape image when the color has alpha", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0, type: "shape", color: "#C33D3580", image: "data:image/svg+xml,x" },
      ],
    });

    const svg = build(scene);

    expect(svg).toContain('<circle cx="400" cy="300" r="5" fill="rgba(195,61,53,0.502)"/>');
    expect(svg.indexOf("<circle")).toBeLessThan(svg.indexOf("<image"));
  });

  it("renders pie wedges with correct arc flags (CCW from +x, y-negated)", () => {
    const scene = makeScene({
      nodes: [
        {
          id: "a", x: 0, y: 0, type: "pie", size: 5,
          pieValue0: 1, pieColor0: "#ff0000",
          pieValue1: 3, pieColor1: "#00ff00",
        },
      ],
    });

    const svg = build(scene);

    // Quarter slice [0, π/2): small arc from (405,300) to (400,295).
    expect(svg).toContain('<path d="M 400 300 L 405 300 A 5 5 0 0 0 400 295 Z" fill="#ff0000"/>');
    // Three-quarter slice [π/2, 2π): large-arc flag set.
    expect(svg).toContain('<path d="M 400 300 L 400 295 A 5 5 0 1 0 405 300 Z" fill="#00ff00"/>');
  });

  it("falls back to a full default-color disc when the pie total is 0", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, type: "pie", size: 5, pieValue0: 0, pieColor0: "#ff0000" }],
    });

    const svg = build(scene);

    expect(svg).toContain(`<circle cx="400" cy="300" r="5" fill="${DEFAULTS.NODE.PIE.DEFAULT_COLOR}"/>`);
    expect(svg).not.toContain("<path");
  });

  it("renders a single full slice as a circle, not a degenerate wedge", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, type: "pie", size: 5, pieValue0: 2, pieColor0: "#ff0000" }],
    });

    const svg = build(scene);

    expect(svg).toContain('<circle cx="400" cy="300" r="5" fill="#ff0000"/>');
    expect(svg).not.toContain("<path");
  });

  it("skips zero-value pie slices", () => {
    const scene = makeScene({
      nodes: [
        {
          id: "a", x: 0, y: 0, type: "pie", size: 5,
          pieValue0: 1, pieColor0: "#ff0000",
          pieValue1: 0, pieColor1: "#0000ff",
          pieValue2: 1, pieColor2: "#00ff00",
        },
      ],
    });

    const svg = build(scene);

    expect(svg.match(/<path /g)).toHaveLength(2);
    expect(svg).not.toContain("#0000ff");
  });
});

describe("edges", () => {
  const TWO_NODES = [
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 1, y: 0 },
  ];

  it("renders a curved edge as a Q path with the framed-space control point", () => {
    // Framed cp = (mid - d.y*c, mid + d.x*c) = (0.5, 0.25) -> screen (450, 275):
    // building the cp from screen deltas would flip it to (450, 325).
    const scene = makeScene({
      nodes: TWO_NODES,
      edges: [{ id: "e1", source: "a", target: "b", type: "curve" }],
    });

    expect(build(scene)).toContain('<path d="M 400 300 Q 450 275 500 300" fill="none" stroke="#222222" stroke-width="1"/>');
  });

  it("draws the halo under the body, wider and in haloColor", () => {
    const scene = makeScene({
      nodes: TWO_NODES,
      edges: [
        { id: "e1", source: "a", target: "b", type: "styledLine", size: 2, haloWidth: 3, haloColor: "#0000ff" },
      ],
    });

    const svg = build(scene);

    const halo = '<line x1="400" y1="300" x2="500" y2="300" stroke="#0000ff" stroke-width="8"/>';
    const body = '<line x1="400" y1="300" x2="500" y2="300" stroke="#222222" stroke-width="2"/>';
    expect(svg).toContain(halo);
    expect(svg).toContain(body);
    expect(svg.indexOf(halo)).toBeLessThan(svg.indexOf(body));
  });

  it("anchors and orients the arrow marker at the target node border", () => {
    const scene = makeScene({
      nodes: TWO_NODES,
      edges: [
        {
          id: "e1", source: "a", target: "b", type: "styledLine", size: 2,
          endMarker: 1, endMarkerSize: 10, endMarkerColor: "#123456",
        },
      ],
    });

    // away = unit(source - target) = (-1, 0); A = (500,300) + away*5 = (495,300);
    // len = halfW*2 = 10 -> tip at the border, base 10px back along the edge.
    expect(build(scene)).toContain('<polygon points="495,300 485,305 485,295" fill="#123456"/>');
  });

  it("renders the tee marker as an inhibition bar hugging the node border", () => {
    const scene = makeScene({
      nodes: TWO_NODES,
      edges: [{ id: "e1", source: "a", target: "b", type: "styledLine", size: 2, endMarker: 5 }],
    });

    // markerSize 0 -> len = 2.5*thickness = 5, halfW = thickness = 2,
    // bar = max(5*0.3, 1.5) = 1.5. Fill inherits the edge color.
    expect(build(scene)).toContain('<polygon points="495,302 495,298 493.5,298 493.5,302" fill="#222222"/>');
  });

  it("draws no marker for code 0 on a styled edge", () => {
    const scene = makeScene({
      nodes: TWO_NODES,
      edges: [{ id: "e1", source: "a", target: "b", type: "styledLine", startMarker: 0, endMarker: 0 }],
    });

    expect(build(scene)).not.toContain("<polygon");
  });

  it("strokes the marker border with the auto width when no border size is set", () => {
    const scene = makeScene({
      nodes: TWO_NODES,
      edges: [
        {
          id: "e1", source: "a", target: "b", type: "styledLine", size: 2,
          endMarker: 1, endMarkerSize: 10, endMarkerBorderColor: "#000000", endMarkerBorderSize: 0,
        },
      ],
    });

    // auto border = 0.2 * min(2*halfW, len) = 0.2 * 10 = 2
    expect(build(scene)).toContain('stroke="#000000" stroke-width="2"/>');
  });
});

describe("labels", () => {
  it("places the node label below the node by default (G6 default placement)", () => {
    const scene = makeScene({ nodes: [{ id: "a", x: 0, y: 0, label: "ab" }] });

    // boxH = 12 + 2*2 = 16; center y = 300 + (5 + 2 + 8) = 315; baseline +12*0.35.
    expect(build(scene)).toContain('<text x="400" y="319.2"');
  });

  it("draws the label background rect when enabled with a color", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0, label: "ab", labelBackground: true, labelBackgroundColor: "#AABBCC" },
      ],
    });

    expect(build(scene)).toContain('<rect x="392" y="307" width="16" height="16" rx="4" fill="#AABBCC"/>');
  });

  it("treats the baked #000000 label color as themeable but honours explicit colors", () => {
    const themed = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, label: "ab", labelColor: "#000000" }],
      settings: { labelColor: { color: "#E7E6EE" } },
    });
    const explicit = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, label: "ab", labelColor: "#112233" }],
      settings: { labelColor: { color: "#E7E6EE" } },
    });

    expect(build(themed)).toContain('fill="#E7E6EE"');
    expect(build(explicit)).toContain('fill="#112233"');
  });

  it("normalizes rotated edge labels upright for both vertical directions", () => {
    const scene = (source, target) =>
      makeScene({
        nodes: [
          { id: "a", x: 0, y: 0 },
          { id: "c", x: 0, y: 1 },
        ],
        edges: [{ id: "e1", source, target, label: "v", labelAutoRotate: true }],
      });

    const up = build(scene("a", "c"));
    const down = build(scene("c", "a"));

    expect(up).toContain("rotate(90)");
    expect(down).toContain("rotate(90)");
    expect(up).not.toContain("rotate(-90)");
  });

  it("renders badges as colored pills with white text on the node perimeter", () => {
    const scene = makeScene({
      nodes: [
        {
          id: "a", x: 0, y: 0, label: "A",
          badge: true, badges: [{ text: "B", placement: "right" }],
          badgePalette: ["#112233"], badgeFontSize: 8,
        },
      ],
    });

    const svg = build(scene);

    // Pill: 1-char text (6px) + 2px padding -> 10x12 box at (405,300), rx = h/2.
    expect(svg).toContain('<rect x="400" y="294" width="10" height="12" rx="6" fill="#112233"/>');
    expect(svg).toContain('<text x="405" y="302.8" fill="#FFFFFF"');
  });

  it("respects the displayedNodeLabels Set", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0, label: "AlphaLabel" },
        { id: "b", x: 1, y: 0, label: "BetaLabel" },
      ],
      displayedNodeLabels: new Set(["a"]),
    });

    const svg = build(scene);

    expect(svg).toContain("AlphaLabel");
    expect(svg).not.toContain("BetaLabel");
  });

  it("drops all node labels when renderLabels is false", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, label: "AlphaLabel" }],
      settings: { renderLabels: false },
    });

    const svg = build(scene);

    expect(svg).not.toContain("<text");
    expect(svg).toContain("<circle"); // the node body still renders
  });

  it("falls back to all visible labels when no displayed-label API exists", () => {
    const scene = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0, label: "AlphaLabel" },
        { id: "b", x: 1, y: 0, label: "BetaLabel" },
      ],
    });
    delete scene.sigma.getNodeDisplayedLabels;
    delete scene.sigma.getEdgeDisplayedLabels;

    const svg = build(scene);

    expect(svg).toContain("AlphaLabel");
    expect(svg).toContain("BetaLabel");
  });
});

describe("bubble groups", () => {
  const SQUARE = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
    { x: 100, y: 200 },
  ];

  // Expected `d` built from the SAME control points the live canvas painter
  // consumes (smoothClosedPath) — this IS the canvas/SVG parity assertion.
  const fmt2 = (v) => String(Math.round(v * 100) / 100);
  const smoothD = (ring) => {
    const segments = smoothClosedPath(ring);
    return (
      `M ${fmt2(segments[0].x0)} ${fmt2(segments[0].y0)} ` +
      segments
        .map((s) => `C ${fmt2(s.c1x)} ${fmt2(s.c1y)} ${fmt2(s.c2x)} ${fmt2(s.c2y)} ${fmt2(s.x)} ${fmt2(s.y)}`)
        .join(" ") +
      " Z"
    );
  };

  it("renders the body as a smoothed closed path with fill/stroke opacities and 2px outline", () => {
    const scene = makeScene();

    const svg = build(scene, {
      bubbleGroups: [
        {
          group: "groupOne",
          points: SQUARE,
          opts: { fill: "#e74c3c", fillOpacity: 0.3, stroke: "#111111", strokeOpacity: 0.8 },
          defaults: {},
        },
      ],
    });

    expect(svg).toContain(
      `<path d="${smoothD(SQUARE)}" fill="#e74c3c" fill-opacity="0.3" fill-rule="evenodd" stroke="#111111" stroke-width="2" stroke-opacity="0.8"/>`,
    );
  });

  it("renders avoid holes as extra even-odd subpaths (same smoothed control points)", () => {
    const scene = makeScene();
    const HOLE = [{ x: 140, y: 140 }, { x: 160, y: 140 }, { x: 160, y: 160 }, { x: 140, y: 160 }];

    const svg = build(scene, {
      bubbleGroups: [
        {
          group: "groupOne",
          points: SQUARE,
          holes: [HOLE],
          opts: { fill: "#e74c3c", fillOpacity: 0.3, stroke: "#111111", strokeOpacity: 0.8 },
          defaults: {},
        },
      ],
    });

    expect(svg).toContain(`d="${smoothD(SQUARE)} ${smoothD(HOLE)}"`);
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it("pushes an off-path label along the outward normal by the standoff", () => {
    const scene = makeScene();

    const svg = build(scene, {
      bubbleGroups: [
        {
          group: "groupOne",
          points: SQUARE,
          opts: {
            label: true, labelText: "grp", labelPlacement: "bottom",
            labelCloseToPath: false, labelAutoRotate: false, labelFontSize: 12, labelPadding: 2,
          },
          defaults: {},
        },
      ],
    });

    // anchor (200,200), normal (0.71, 0.71), standoff = 6+2+8 = 16 -> (211.31, 211.31);
    // baseline +12*0.35. autoRotate off -> absolute text, no group transform.
    expect(svg).toContain('<text x="211.31" y="215.51"');
    expect(svg).not.toContain("<g transform");
  });

  it("rotates on-path labels by the outline tangent angle", () => {
    const scene = makeScene();

    const svg = build(scene, {
      bubbleGroups: [
        {
          group: "groupOne",
          points: SQUARE,
          opts: { label: true, labelText: "grp", labelPlacement: "bottom", labelCloseToPath: true, labelAutoRotate: true },
          defaults: {},
        },
      ],
    });

    expect(svg).toContain('<g transform="translate(200 200) rotate(-45)">');
    expect(svg).toContain('<text x="0"');
  });

  it("layers the body above nodes/edges and below labels (matches live afterLayer:nodes)", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 1, y: 1, label: "NodeLbl" }],
      edges: [],
    });

    const svg = build(scene, {
      bubbleGroups: [
        { group: "g", points: SQUARE, opts: { fill: "#e74c3c", stroke: "#111111" }, defaults: {} },
      ],
    });

    const nodeAt = svg.indexOf("<circle");
    const bodyAt = svg.indexOf("<path");
    const labelAt = svg.indexOf(">NodeLbl</text>");
    expect(nodeAt).toBeGreaterThanOrEqual(0);
    expect(nodeAt).toBeLessThan(bodyAt);
    expect(bodyAt).toBeLessThan(labelAt);
  });

  it("skips groups with fewer than 2 outline points", () => {
    const scene = makeScene();

    const svg = build(scene, {
      bubbleGroups: [
        { group: "tiny", points: [{ x: 1, y: 1 }], opts: { label: true, labelText: "tiny" }, defaults: {} },
      ],
    });

    expect(svg).not.toContain("<path");
    expect(svg).not.toContain("tiny");
  });
});

describe("escaping & color safety", () => {
  it("XML-escapes labels containing markup metacharacters", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, label: `<script>&"'` }],
    });

    const svg = build(scene);

    expect(svg).toContain(">&lt;script&gt;&amp;&quot;&apos;</text>");
    expect(svg).not.toContain("<script>");
  });

  it("rejects malicious paint values and falls back to #999999", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, color: 'url("javascript:alert(1)")' }],
    });

    const svg = build(scene);

    expect(svg).toContain('fill="#999999"');
    expect(svg).not.toContain("javascript:");
  });

  it("converts 8-digit hex colors to rgba() for viewer compatibility", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, color: "#ff000080" }],
    });

    expect(build(scene)).toContain('fill="rgba(255,0,0,0.502)"');
  });

  it("drops image hrefs that are not the app's own SVG data URIs", () => {
    const evil = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0, type: "shape", color: "#00000000", image: "javascript:alert(1)" },
        { id: "b", x: 1, y: 0, type: "shape", color: "#00000000", image: "https://evil.example/t.svg" },
      ],
    });
    const ok = makeScene({
      nodes: [
        { id: "a", x: 0, y: 0, type: "shape", color: "#00000000", image: "data:image/svg+xml,%3Csvg%2F%3E" },
      ],
    });

    expect(build(evil)).not.toContain("<image");
    expect(build(ok)).toContain('<image href="data:image/svg+xml,%3Csvg%2F%3E"');
  });

  it("emits 0 instead of NaN/Infinity for non-finite numeric attributes", () => {
    const scene = makeScene({
      nodes: [{ id: "a", x: 0, y: 0, size: NaN }],
    });

    const svg = build(scene);

    expect(svg).toContain('r="0"');
    expect(svg).not.toContain("NaN");
  });
});
