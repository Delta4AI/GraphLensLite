/**
 * Defaults for the graph, layouts and UI
 */
const VERSION = "1.16.1";

const DEFAULTS = {
  NODE: {
    FILL_COLOR: "#C33D35", SIZE: 20, LINE_WIDTH: 1, TYPE: "hexagon", STROKE_COLOR: null, OPACITY: 1,
    BADGE: {
      FONT_SIZE: 8, COLOR: "#C33D35", SCALE_WITH_NODE: false
    },
    // Pie-chart nodes (@sigma/node-piechart). The program is created with a
    // FIXED slice count (slice K reads pieValueK/pieColorK per node), so
    // MAX_SLICES caps how many categories/numeric columns one node can show;
    // overflow is dropped with a UI warning (no silent truncation). Unused
    // slices carry value 0 + a transparent color, collapsing to nothing.
    //
    // HARD CAP 6: the program consumes 4 base + 2 vertex attributes per slice
    // (per-node color + value), and WebGL2 only guarantees MAX_VERTEX_ATTRIBS
    // = 16 (4 + 2·6 = 16). The program is built eagerly for every graph and
    // throws above the limit, so a larger value would break ALL rendering on
    // 16-attribute GPUs — not just pie nodes.
    PIE: {
      MAX_SLICES: 6,
      DEFAULT_COLOR: "#ABACBD", // fallback fill when a slice color is missing
      SLICE_PALETTE: ["#C33D35", "#403C53", "#8CA6D9", "#EFB0AA", "#5B8C5A", "#E0A458"],
    },
    LABEL: {
      FOREGROUND_COLOR: "#000000", BACKGROUND: false, BACKGROUND_COLOR: null, BACKGROUND_RADIUS: 5,
      PADDING: 2, PLACEMENT: "bottom", FONT_SIZE: 12, CURSOR: "default", LINE_SPACING: 0, MAX_LINES: 1,
      MAX_WIDTH: "200%", TEXT_ALIGN: "middle", WORD_WRAP: false, Z_INDEX: 0, OFFSET_X: 0, OFFSET_Y: 0,
    },
  },
  EDGE: {
    COLOR: "#403C5390", LINE_WIDTH: 0.75, LINE_DASH: 0, TYPE: "line", OPACITY: 1,
    ARROWS: {
      START: false, END: false, START_SIZE: 8, START_TYPE: "arrow", END_SIZE: 8, END_TYPE: "arrow",
      // null fill → marker inherits the edge stroke color; null border → no border (transparent).
      START_COLOR: null, START_BORDER_COLOR: null, END_COLOR: null, END_BORDER_COLOR: null,
      // Border band thickness in px; 0 → auto (scales with the marker, ~20%).
      START_BORDER_SIZE: 0, END_BORDER_SIZE: 0,
    },
    LABEL: {
      TEXT: null, FOREGROUND_COLOR: "#000000", BACKGROUND: false, BACKGROUND_COLOR: null,
      BACKGROUND_CURSOR: "default", BACKGROUND_FILL_OPACITY: 1, BACKGROUND_RADIUS: 0, BACKGROUND_STROKE_OPACITY: 1,
      CURSOR: "default", FILL_OPACITY: 1, FONT_WEIGHT: "normal", MAX_LINES: 1, MAX_WIDTH: "80%", PADDING: 0,
      PLACEMENT: "center", FONT_SIZE: 12, AUTO_ROTATE: false, OFFSET_X: 4, OFFSET_Y: 0, TEXT_ALIGN: "left",
      TEXT_BASE_LINE: "middle", TEXT_OVERFLOW: "ellipsis", VISIBILITY: "visible", WORD_WRAP: false, OPACITY: 1,
    },
    HALO: {
      ENABLED: false, COLOR: "#403C53", WIDTH: 3,
    },
    // Animated source→target flow overlay (edge_flow_programs.js). COLOR null
    // → derived from the edge stroke (lightened, see graph_model.edgeMarkerHaloAttributes).
    // OPACITY multiplies into the overlay color's alpha; DENSITY scales the
    // pattern period (higher = sparser dashes/dots).
    FLOW: {
      ENABLED: false, TYPE: "dash", SPEED: 1, COLOR: null, OPACITY: 1, DENSITY: 1,
    }
  },
  // Element interaction-state spec (former G6 node/edge state config in
  // core.js). Single source for the styling UI and the sigma reducers.
  STATE: {
    ACCENT_COLOR: "#C33D35",   // selected/highlight halo + highlight fill
    DIM_COLOR: "#E4E3EA",      // dim fill
    NODE_HALO_WIDTH: 12,       // px, halo ring stroke width on nodes
    EDGE_HALO_WIDTH: 6,        // px, emphasis width budget on selected edges
    HALO_OPACITY: 0.4,
  },
  // Atmospheric canvas layer (heatmap_layer.js): node-density heatmap below
  // the bubble-set canvas. Off by default; toggled from the workspace toolbar.
  // OPACITY/INTENSITY/GAMMA/BANDWIDTH_SCALE/FADE_GRAPH are the runtime knobs
  // exposed in the toolbar settings popover — these are the initial values.
  HEATMAP: {
    ENABLED: false,
    MAX_RESOLUTION: 1024,  // offscreen splat canvas long-side px cap
    BANDWIDTH: 0,          // splat radius in graph units; 0 → auto (heatBandwidth)
    BANDWIDTH_SCALE: 1,    // multiplier on the (auto or explicit) bandwidth
    // Tuned against the airport template with FADE_GRAPH on: the previous
    // 0.55/0.18/0.7 read as a smudge rather than a density gradient once the
    // graph stopped occluding it.
    OPACITY: 0.7,          // layer alpha — keeps the field atmospheric
    INTENSITY: 0.25,       // per-splat center alpha; densities saturate at ~1/INTENSITY overlaps
    GAMMA: 0.85,           // density exponent before the ramp; < 1 boosts low-density haze
    // Density floor: pixels below this density clear entirely, the rest
    // renormalizes over the ramp. A lone node peaks at exactly INTENSITY, so
    // a value just above it shows only overlapping nodes (clusters).
    THRESHOLD: 0,
    RAMP: "default",       // active RAMPS preset (styling-panel dropdown)
    // Density ramp presets, one stop list per theme. First-stop alpha 00 so
    // low densities fade out without graying. viridis/magma are perceptually
    // uniform and read on either background, so both themes share the stops.
    RAMPS: {
      // transparent → cool → warm; dark variant brighter and slightly
      // desaturated so the haze reads on a dark background without neon.
      default: {
        light: [
          { t: 0, color: "#8CA6D900" },
          { t: 0.35, color: "#8CA6D9" },
          { t: 0.7, color: "#EFB0AA" },
          { t: 1, color: "#C33D35" },
        ],
        dark: [
          { t: 0, color: "#7C90C200" },
          { t: 0.35, color: "#7C90C2" },
          { t: 0.7, color: "#D89A90" },
          { t: 1, color: "#F0867B" },
        ],
      },
      viridis: {
        light: [
          { t: 0, color: "#44015400" },
          { t: 0.25, color: "#3B528B" },
          { t: 0.5, color: "#21918C" },
          { t: 0.75, color: "#5EC962" },
          { t: 1, color: "#FDE725" },
        ],
        dark: [
          { t: 0, color: "#44015400" },
          { t: 0.25, color: "#3B528B" },
          { t: 0.5, color: "#21918C" },
          { t: 0.75, color: "#5EC962" },
          { t: 1, color: "#FDE725" },
        ],
      },
      magma: {
        light: [
          { t: 0, color: "#51127C00" },
          { t: 0.35, color: "#B73779" },
          { t: 0.7, color: "#FC8961" },
          { t: 1, color: "#FCFDBF" },
        ],
        dark: [
          { t: 0, color: "#51127C00" },
          { t: 0.35, color: "#B73779" },
          { t: 0.7, color: "#FC8961" },
          { t: 1, color: "#FCFDBF" },
        ],
      },
      // Single hue on the app accent — selection-styling adjacency.
      accent: {
        light: [
          { t: 0, color: "#C33D3500" },
          { t: 0.5, color: "#E0928D" },
          { t: 1, color: "#C33D35" },
        ],
        dark: [
          { t: 0, color: "#F0867B00" },
          { t: 0.5, color: "#D86A60" },
          { t: 1, color: "#F0867B" },
        ],
      },
      // Neutral: darkens toward ink on light, lightens toward paper on dark.
      grayscale: {
        light: [
          { t: 0, color: "#BBBBBB00" },
          { t: 0.5, color: "#999999" },
          { t: 1, color: "#333333" },
        ],
        dark: [
          { t: 0, color: "#77777700" },
          { t: 0.5, color: "#AAAAAA" },
          { t: 1, color: "#EEEEEE" },
        ],
      },
    },
    // Fade every non-emphasized node/edge while the heatmap is on, so the
    // density field reads through the graph (the layer sits below everything).
    // 0 leaves the graph alone, 1 fades it out entirely; labels cut out past
    // 0.4 because they are the largest occluder. Off by default so switching
    // the heatmap on never silently restyles the graph.
    FADE_GRAPH: 0,
  },
  LAYOUT: "force",
  // Keys define the layout template vocabulary (workspace-creation dropdown).
  // Option objects ride into the headless @antv/layout classes for
  // radial/concentric/mds/dagre; force (forceAtlas2.inferSettings), circular,
  // circlepack, grid and random are self-tuning/geometric and take no options.
  LAYOUT_INTERNALS: {
    "force": {},
    "circular": {},
    // Circle packing (d3-hierarchy via graphology). Each node's circle radius
    // is its `size` attribute (sigma radius); O(n), no expense guard.
    "circlepack": {},
    "radial": {direction: "LR", nodeSize: 32, unitRadius: 100, linkDistance: 200},
    "concentric": {nodeSize: 32, maxLevelDiff: 0.5, sortBy: 'degree', preventOverlap: true},
    "grid": {},
    // Uniform random scatter centered on the origin; O(n), no expense guard.
    "random": {},
    "mds": {nodeSize: 32, linkDistance: 100},
    // Layered/hierarchical (Sugiyama). rankdir TB → ranks flow top-to-bottom
    // (y negated into graphology's y-up frame in layout_algorithms.js);
    // nodesep/ranksep are graph-space px between same-rank / adjacent ranks.
    "dagre": {rankdir: "TB", nodesep: 40, ranksep: 90},
  },
  // Layout templates whose headless compute scales super-linearly (dagre's
  // Sugiyama ordering, classical MDS's O(n²) distance matrix). Above
  // LAYOUT_NODE_WARNING_THRESHOLD nodes they can run for minutes even off the
  // main thread, so workspace creation warns before kicking one off. force is
  // excluded (worker-animated with a hard time budget); circular/grid are O(n).
  EXPENSIVE_LAYOUTS: ["dagre", "mds"],
  LAYOUT_NODE_WARNING_THRESHOLD: 2000,
  CUSTOM_LAYOUT_NAME: "custom",
  // Everything a bubble group's style holds that does NOT depend on which group
  // it is. There is no per-group literal any more: a workspace owns its own
  // `bubbleSetStyle` map and may hold any number of groups, so the only thing
  // config can supply is one template plus a colour cycle
  // (see bubbleGroupStyle). Geometry defaults 0.1 / 0.25 / avoidance-on are the
  // values tuned in 1.16.0; changing them here changes only NEW groups, because
  // a saved workspace stores its own resolved values.
  BUBBLE_GROUP_STYLE_TEMPLATE: {
    fillOpacity: 0.25,
    strokeOpacity: 1,
    virtualEdges: true,
    padding: 0.1,
    corridor: 0.25,
    avoidance: 1,
    label: true,
    labelFill: '#fff',
    labelFontSize: 12,
    labelPadding: 2,
    labelBackground: true,
    labelBackgroundRadius: 5,
    labelCloseToPath: true,
    labelAutoRotate: true,
    labelOffsetX: 0,
    labelOffsetY: 0,
    labelPlacement: 'bottom',
  },
  // The brand colours the original four groups used, in their original order,
  // so the first four groups a user creates look exactly as they always have.
  // Past the end, bubbleGroupColor walks the hue circle by the golden angle.
  BUBBLE_GROUP_PALETTE: ['#403C53', '#C33D35', '#EFB0AA', '#8CA6D9'],
  STYLES: {
    NODE_FORM: {"●": "circle", "◆": "diamond", "⬢": "hexagon", "■": "rect", "▲": "triangle", "★": "star"},
    NODE_COLORS: {red: "#C33D35", purple: "#403C53", blue: "#8CA6D9", pink: "#EFB0AA", grey: "#ABACBD"},
    NODE_SIZES: {s: 15, m: 25, l: 35, xl: 50},
    NODE_BORDER_COLORS: {
      red: "#C33D35",
      purple: "#403C53",
      blue: "#8CA6D9",
      pink: "#EFB0AA",
      grey: "#ABACBD",
      none: "#00000000"
    },
    NODE_BORDER_SIZES: {sm: 0.5, md: 1, lg: 2, xlg: 4},
    NODE_LABEL_FONT_SIZES: {sm: 10, md: 12, lg: 14, xlg: 20},
    NODE_LABEL_COLORS: {black: "#000000", red: "#C33D35", purple: "#403C53", grey: "#ABACBD"},
    NODE_LABEL_PLACEMENTS: ["left", "right", "top", "bottom", "left-top", "left-bottom", "right-top", "right-bottom", "top-left", "top-right", "bottom-left", "bottom-right", "center"],
    NODE_LABEL_BACKGROUND_COLORS: {
      red: "#C33D35",
      purple: "#403C53",
      blue: "#8CA6D9",
      pink: "#EFB0AA",
      grey: "#ABACBD",
      none: "#00000000"
    },
    NODE_BADGE_PLACEMENTS: ["left", "right", "top", "bottom", "left-top", "left-bottom", "right-top", "right-bottom", "top-left", "top-right", "bottom-left", "bottom-right"],
    EDGE_TYPES: ["line", "cubic", "quadratic", "polyline"],
    EDGE_COLORS: {red: "#C33D35", purple: "#403C53", blue: "#8CA6D9", pink: "#EFB0AA", grey: "#ABACBD"},
    // EDGE_WIDTHS: {sm: 0.5, md: 0.75, lg: 1, xlg: 3},
    EDGE_DASHS: {none: 0, dashed: 10},
    EDGE_LABEL_FONT_SIZES: {sm: 8, md: 12, lg: 16},
    EDGE_LABEL_PLACEMENTS: ["start", "center", "end"],
    EDGE_LABEL_COLORS: {red: "#C33D35", purple: "#403C53", blue: "#8CA6D9", pink: "#EFB0AA", grey: "#ABACBD"},
    EDGE_LABEL_BACKGROUND_COLORS: {
      red: "#C33D35",
      purple: "#403C53",
      blue: "#8CA6D9",
      pink: "#EFB0AA",
      grey: "#ABACBD"
    },
    EDGE_LABEL_OFFSET_X: {"-25": -25, "0": 0, "25": 25},
    EDGE_LABEL_OFFSET_Y: {"-25": -25, "0": 0, "25": 25},
    // EDGE_LABEL_AUTOROTATE: {enable: true, disable: false},
    // EDGE_ARROW_SIZES: {sm: 8, md: 10, lg: 14},
    // End-marker vocabulary (graph_model.EDGE_MARKERS): direction shapes +
    // "tee" (⊣ inhibition bar). Legacy G6 names (triangle/vee/...) still load
    // via aliases but are no longer offered in the UI.
    EDGE_ARROW_TYPES: ["arrow", "rect", "diamond", "circle", "tee"],
    // Flow overlay vocabulary (graph_model.FLOW_MODES): marching dashes,
    // travelling dots, fading comet tails and travelling chevron arrows, all
    // moving source → target.
    EDGE_FLOW_TYPES: ["dash", "pulse", "comet", "chevron"],
    EDGE_ARROW_COLORS: {red: "#C33D35", purple: "#403C53", blue: "#8CA6D9", pink: "#EFB0AA", grey: "#ABACBD"},
    EDGE_ARROW_BORDER_COLORS: {
      red: "#C33D35", purple: "#403C53", blue: "#8CA6D9", pink: "#EFB0AA", grey: "#ABACBD", none: "#00000000"
    },
    EDGE_HALO: {enable: true, disable: false},
    EDGE_HALO_STROKE: {red: "#C33D35", purple: "#403C53", blue: "#8CA6D9"},
    EDGE_HALO_WIDTH: {sm: 2, md: 3, lg: 5},
  }
}

/**
 *  GLL configuration parameters
 */
const CFG = {

// Determines if filter sliders should be hidden when the minimum and maximum values are identical
  HIDE_SLIDERS_WITH_SAME_MIN_MAX_VALUES: true,

// Specifies the slider step size for integer-based properties.
// Float-based properties use a continuous slider (step="any"), so they have no
// configurable step — see InvertibleRangeSlider.
  FILTER_STEP_SIZE_INTEGER: 1,

// Specifies the slider thumb- and tooltip-values (only visually); internally, the full float precision is used
  FILTER_VISUAL_FLOAT_PRECISION: 3,

// If true, filters in the side-panel are sorted alphabetically
  SORT_FILTERS: false,

// If true, filters in the tooltips are sorted alphabetically
  SORT_TOOLTIPS: true,

// Maximum tooltip columns
  TOOLTIP_MAX_COLUMNS: 1,

// If true, properties with null (empty) values are not displayed in tooltips
  TOOLTIP_HIDE_NULL_VALUES: false,

// if network is greater than defined threshold, no labels are shown until explicity set via UI
  MAX_NODES_BEFORE_HIDING_LABELS: 1000,
  HIDE_LABELS: false,

// Hover highlight effect. Controlled only by the manual toggle button (sigma
// renders hover fast enough that no automatic node/edge-count cutoff is needed).
  DISABLE_HOVER_EFFECT: false,

// if network is greater than defined threshold, bubble groups may span across non-bubble group members.
// Measured with the sigma renderer (bubblesets-js createOutline, virtualEdges on, viewport-scale
// coordinates, 2026-06-10): 60 members + 1000 avoid rects ≈ 69 ms, +2000 ≈ 194 ms, 300 members +
// 5700 avoid ≈ 12 s — virtual-edge routing around obstacles is O(members × avoid). 1000 keeps a
// full per-group outline recompute under the ~100 ms interactivity budget; camera pan/zoom reuses
// cached outlines and is unaffected (src/graph/bubble_layer.js).
  MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS: 1000,
  AVOID_MEMBERS_IN_BUBBLE_GROUPS: false,

// Maximum capacity of selection memory
  MAX_SELECTION_MEMORY: 25,

// Header automatically assigned to properties without a group definition
  EXCEL_UNCATEGORIZED_SUBHEADER: "Uncategorized Properties",

// Node filter header
  EXCEL_NODE_HEADER: "Node filters",

// Edge filter header
  EXCEL_EDGE_HEADER: "Edge filters",

// Set to true to use current filter configuration for pushing property to query editor, e.g. if slider is inverted
// false uses defaults (non-inverted) and min/max
  QUERY_BTN_USE_CURRENT_FILTER: true,

  INVISIBLE_CHAR: "\u200B",

  // AI Assistant configuration lives entirely in localStorage (key
  // `gll.assistant.settings`). Defaults live in
  // src/managers/assistant/settings.js and are surfaced through the
  // setup/settings modal — nothing to keep in sync here.
}

/** HSL (h 0-360, s/l 0-1) to `#rrggbb`. */
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * Fill colour for the group at `index`. The palette covers the first four, then
 * the hue circle is walked by the golden angle so any number of groups stays
 * visually separable without a hand-authored list.
 *
 * Always `#rrggbb`: `<input type="color">` (the group row's swatch) accepts
 * nothing else, so an `hsl()` string here silently collapsed every group past
 * the fourth onto the swatch's fallback colour.
 *
 * @param {number} index zero-based creation order
 * @returns {string} hex colour
 */
function bubbleGroupColor(index) {
  const palette = DEFAULTS.BUBBLE_GROUP_PALETTE;
  if (index < palette.length) return palette[index];
  return hslToHex((index * 137.508) % 360, 0.55, 0.55);
}

/**
 * A complete style object for a new bubble group: the shared template plus the
 * three values that identify one group from another. The stroke is the NEXT
 * palette entry, which is what the original four did (contrast, not a tint of
 * the fill).
 * @param {number} index zero-based creation order
 * @param {string} [name] label text; defaults to "Group <n>"
 */
function bubbleGroupStyle(index, name) {
  const fill = bubbleGroupColor(index);
  return {
    ...DEFAULTS.BUBBLE_GROUP_STYLE_TEMPLATE,
    fill,
    stroke: bubbleGroupColor(index + 1),
    labelText: name ?? `Group ${index + 1}`,
    labelBackgroundFill: fill,
  };
}

export {VERSION, DEFAULTS, CFG, bubbleGroupColor, bubbleGroupStyle}