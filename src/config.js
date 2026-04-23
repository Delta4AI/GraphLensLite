/**
 * Defaults for the graph, layouts and UI
 */
const VERSION = "1.13.0";

const DEFAULTS = {
  NODE: {
    FILL_COLOR: "#C33D35", SIZE: 20, LINE_WIDTH: 1, TYPE: "hexagon", STROKE_COLOR: null,
    BADGE: {
      FONT_SIZE: 8, COLOR: "#C33D35"
    },
    LABEL: {
      FOREGROUND_COLOR: "#000000", BACKGROUND: false, BACKGROUND_COLOR: null, BACKGROUND_RADIUS: 5,
      PADDING: 2, PLACEMENT: "bottom", FONT_SIZE: 12, CURSOR: "default", LINE_SPACING: 0, MAX_LINES: 1,
      MAX_WIDTH: "200%", TEXT_ALIGN: "middle", WORD_WRAP: false, Z_INDEX: 0, OFFSET_X: 0, OFFSET_Y: 0,
    },
  },
  EDGE: {
    COLOR: "#403C5390", LINE_WIDTH: 0.75, LINE_DASH: 0, TYPE: "line",
    ARROWS: {START: false, END: false, START_SIZE: 8, START_TYPE: "triangle", END_SIZE: 8, END_TYPE: "triangle"},
    LABEL: {
      TEXT: null, FOREGROUND_COLOR: "#000000", BACKGROUND: false, BACKGROUND_COLOR: null,
      BACKGROUND_CURSOR: "default", BACKGROUND_FILL_OPACITY: 1, BACKGROUND_RADIUS: 0, BACKGROUND_STROKE_OPACITY: 1,
      CURSOR: "default", FILL_OPACITY: 1, FONT_WEIGHT: "normal", MAX_LINES: 1, MAX_WIDTH: "80%", PADDING: 0,
      PLACEMENT: "center", FONT_SIZE: 12, AUTO_ROTATE: false, OFFSET_X: 4, OFFSET_Y: 0, TEXT_ALIGN: "left",
      TEXT_BASE_LINE: "middle", TEXT_OVERFLOW: "ellipsis", VISIBILITY: "visible", WORD_WRAP: false, OPACITY: 1,
    },
    HALO: {
      ENABLED: false, COLOR: "#403C53", WIDTH: 3,
    }
  },
  LAYOUT: "force",
  LAYOUT_INTERNALS: {
    "force": {gravity: 10},
    // "fruchterman": {gravity: 5, speed: 5, clustering: true, nodeClusterBy: 'cluster', clusterGravity: 16},
    // "antv-dagre": {nodesep: 100, ranksep: 70, controlPoints: true},
    "circular": {startRadius: 10, endRadius: 300},
    "radial": {direction: "LR", nodeSize: 32, unitRadius: 100, linkDistance: 200},
    "concentric": {nodeSize: 32, maxLevelDiff: 0.5, sortBy: 'degree', preventOverlap: true},
    "grid": {sortBy: "id", nodeSize: 32},
    "mds": {nodeSize: 32, linkDistance: 100},
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
    EDGE_ARROW_TYPES: ["triangle", "circle", "diamond", "vee", "rect", "triangleRect", "simple"],
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

// Specifies the slider step size for integer-based properties
  FILTER_STEP_SIZE_INTEGER: 1,

// Specifies the slider step size for float-based properties
  FILTER_STEP_SIZE_FLOAT: 0.000001,

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

// if network is greater than defined threshold, hover effects are disabled
  MAX_NODES_BEFORE_DISABLING_HOVER_EFFECT: 200,
  MAX_EDGES_BEFORE_DISABLING_HOVER_EFFECT: 500,
  DISABLE_HOVER_EFFECT: false,

// if network is greater than defined threshold, bubble groups may span across non-bubble group members
  MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS: 300,
  AVOID_MEMBERS_IN_BUBBLE_GROUPS: false,

// Maximum capacity of selection memory
  MAX_SELECTION_MEMORY: 25,

// Header automatically assigned to properties without a group definition
  EXCEL_UNCATEGORIZED_SUBHEADER: "Uncategorized Properties",

// Node filter header
  EXCEL_NODE_HEADER: "Node filters",

// Edge filter header
  EXCEL_EDGE_HEADER: "Edge filters",

// Set to true in case original g6.min.js is used and issue #7195 is NOT resolved (https://github.com/antvis/G6/issues/7195)
  APPLY_BUBBLE_SET_HOTFIX: false,

// Set to true to use current filter configuration for pushing property to query editor, e.g. if slider is inverted
// false uses defaults (non-inverted) and min/max
  QUERY_BTN_USE_CURRENT_FILTER: true,

// Set to true to reset positions of selected elements when clicking the reset selection button in the top right selection frame
  RESET_SELECTION_BUTTON_RESETS_POSITIONS: true,
  INVISIBLE_DUMMY_NODE: {
    id: "INVISIBLEDUMMYNODEWITHIMPOSSIBLEID",
    style: {
      visibility: "hidden"
    },
  },

  INVISIBLE_CHAR: "\u200B",

  ASSISTANT: {
    ENABLED: true,
    ENDPOINT: 'http://localhost:11434',
    MODEL: 'llama3.1:8b',
    MAX_CONTEXT_NODES: 25,
    MAX_STATUS_LOG_LINES: 10,
    MAX_HISTORY_MESSAGES: 12,
  },
}

export {VERSION, DEFAULTS, CFG}