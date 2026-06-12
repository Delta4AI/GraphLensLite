/**
 * Defaults for the graph, layouts and UI
 */
const VERSION = "1.15.0";

const DEFAULTS = {
  NODE: {
    FILL_COLOR: "#C33D35", SIZE: 20, LINE_WIDTH: 1, TYPE: "hexagon", STROKE_COLOR: null,
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
    COLOR: "#403C5390", LINE_WIDTH: 0.75, LINE_DASH: 0, TYPE: "line",
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
  // OPACITY/INTENSITY/GAMMA/BANDWIDTH_SCALE/DIM_GRAPH are the runtime knobs
  // exposed in the toolbar settings popover — these are the initial values.
  HEATMAP: {
    ENABLED: false,
    MAX_RESOLUTION: 1024,  // offscreen splat canvas long-side px cap
    BANDWIDTH: 0,          // splat radius in graph units; 0 → auto (heatBandwidth)
    BANDWIDTH_SCALE: 1,    // multiplier on the (auto or explicit) bandwidth
    OPACITY: 0.55,         // layer alpha — keeps the field atmospheric
    INTENSITY: 0.18,       // per-splat center alpha; densities saturate at ~1/INTENSITY overlaps
    GAMMA: 0.7,            // density exponent before the ramp; < 1 boosts low-density haze
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
    // Dim every non-emphasized node/edge while the heatmap is on, so the
    // density field reads through the graph (the layer sits below everything).
    DIM_GRAPH: false,
  },
  LAYOUT: "force",
  // Keys define the layout template vocabulary (workspace-creation dropdown).
  // Option objects ride into the headless @antv/layout classes for
  // radial/concentric/mds/dagre; force (forceAtlas2.inferSettings), circular
  // and grid are self-tuning/geometric and take no options.
  LAYOUT_INTERNALS: {
    "force": {},
    "circular": {},
    "radial": {direction: "LR", nodeSize: 32, unitRadius: 100, linkDistance: 200},
    "concentric": {nodeSize: 32, maxLevelDiff: 0.5, sortBy: 'degree', preventOverlap: true},
    "grid": {},
    "mds": {nodeSize: 32, linkDistance: 100},
    // Layered/hierarchical (Sugiyama). rankdir TB → ranks flow top-to-bottom
    // (y negated into graphology's y-up frame in layout_algorithms.js);
    // nodesep/ranksep are graph-space px between same-rank / adjacent ranks.
    "dagre": {rankdir: "TB", nodesep: 40, ranksep: 90},
  },
  CUSTOM_LAYOUT_NAME: "custom",
  BUBBLE_GROUP_STYLE: {
    "groupOne": {
      fill: '#403C53',
      fillOpacity: 0.25,
      stroke: '#C33D35',
      strokeOpacity: 1,
      virtualEdges: true,
      label: true,
      labelText: 'group one',
      labelFill: '#fff',
      labelFontSize: 12,
      labelPadding: 2,
      labelBackground: true,
      labelBackgroundFill: '#403C53',
      labelBackgroundRadius: 5,
      labelCloseToPath: true,
      labelAutoRotate: true,
      labelOffsetX: 0,
      labelOffsetY: 0,
      labelPlacement: 'bottom',
    },
    "groupTwo": {
      fill: '#c33d35',
      fillOpacity: 0.25,
      stroke: '#403c53',
      strokeOpacity: 1,
      virtualEdges: true,
      label: true,
      labelText: 'group two',
      labelFill: '#fff',
      labelFontSize: 12,
      labelPadding: 2,
      labelBackground: true,
      labelBackgroundFill: '#c33d35',
      labelBackgroundRadius: 5,
      labelCloseToPath: true,
      labelAutoRotate: true,
      labelOffsetX: 0,
      labelOffsetY: 0,
      labelPlacement: 'bottom',
    },
    "groupThree": {
      fill: '#EFB0AA',
      fillOpacity: 0.4,
      stroke: '#8CA6D9',
      strokeOpacity: 1,
      virtualEdges: true,
      label: true,
      labelText: 'group three',
      labelFill: '#fff',
      labelFontSize: 12,
      labelPadding: 2,
      labelBackground: true,
      labelBackgroundFill: '#EFB0AA',
      labelBackgroundRadius: 5,
      labelCloseToPath: true,
      labelAutoRotate: true,
      labelOffsetX: 0,
      labelOffsetY: 0,
      labelPlacement: 'bottom',
    },
    "groupFour": {
      fill: '#8CA6D9',
      fillOpacity: 0.4,
      stroke: '#EFB0AA',
      strokeOpacity: 1,
      virtualEdges: true,
      label: true,
      labelText: 'group four',
      labelFill: '#fff',
      labelFontSize: 12,
      labelPadding: 2,
      labelBackground: true,
      labelBackgroundFill: '#8CA6D9',
      labelBackgroundRadius: 5,
      labelCloseToPath: true,
      labelAutoRotate: true,
      labelOffsetX: 0,
      labelOffsetY: 0,
      labelPlacement: 'bottom',
    },
  },
  BUBBLE_GROUP_QUADRANT_POSITIONS: {
    groupOne: "top-left", groupTwo: "top-right", groupThree: "bottom-left", groupFour: "bottom-right"
  },
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

// Set to true to reset positions of selected elements when clicking the reset selection button in the top right selection frame
  RESET_SELECTION_BUTTON_RESETS_POSITIONS: true,
  INVISIBLE_CHAR: "\u200B",

  // AI Assistant configuration lives entirely in localStorage (key
  // `gll.assistant.settings`). Defaults live in
  // src/managers/assistant/settings.js and are surfaced through the
  // setup/settings modal — nothing to keep in sync here.
}

export {VERSION, DEFAULTS, CFG}