/* global ExcelJS */ // loaded as a global via vendored src/lib/exceljs.min.js script tag
import { DEFAULTS, CFG, VERSION } from '../config.js';
import { sanitizeAnnotations } from '../graph/annotation_geometry.js';
import { StaticUtilities } from '../utilities/static.js';
import { buildDataTable } from '../utilities/data_editor.js';
import { EXPORT_SCALES } from '../utilities/export_scale.js';

const EXPORT_SCALE_KEY = 'gll.exportScale';
// Grace period before revoking an SVG download's blob URL: long enough for
// any browser to start (and realistically finish) fetching the blob, short
// enough not to pin big documents in memory for the whole session.
const SVG_URL_REVOKE_DELAY_MS = 60_000;

function readExportScale() {
  try {
    const stored = Number(window.localStorage.getItem(EXPORT_SCALE_KEY));
    return EXPORT_SCALES.includes(stored) ? stored : 1;
  } catch {
    return 1;
  }
}

function writeExportScale(scale) {
  try {
    window.localStorage.setItem(EXPORT_SCALE_KEY, String(scale));
  } catch {
    /* storage unavailable — resolution choice just won't persist */
  }
}

/**
 * Which bubble groups a SAVED layout carries. `bubbleSetStyle` is the authority
 * whenever the file has one — an empty object means "this workspace has no
 * groups", which is a real state, not a missing field. Only a file that predates
 * `bubbleSetStyle` entirely falls back to inferring groups from its
 * `${group}Props` / `${group}ManualMembers` keys, so a pre-1.17 model does not
 * lose the groups it stored.
 * @param {object} layout raw, unparsed layout from the JSON model
 * @returns {string[]} group keys
 */
function savedLayoutGroupKeys(layout) {
  if (layout?.bubbleSetStyle) return Object.keys(layout.bubbleSetStyle);
  const derived = new Set();
  for (const key of Object.keys(layout ?? {})) {
    for (const suffix of ['ManualMembers', 'Props']) {
      if (key.length > suffix.length && key.endsWith(suffix)) {
        derived.add(key.slice(0, -suffix.length));
      }
    }
  }
  return [...derived];
}

/**
 * Replace boolean D4Data values with 'true'/'false' strings, in place, on
 * every node and edge. Raw booleans mis-classify as numeric downstream
 * (isNaN(true) === false) and become degenerate [1,1] range sliders whose
 * generated BETWEEN condition can never validate — the query AST requires
 * typeof number — so a boolean property silently hides its carriers under an
 * OR filter join. As strings they become categorical true/false filters.
 * Runs at the shared import boundary so every source (Excel, JSON, live API,
 * Neo4j) is covered regardless of how it encodes booleans.
 *
 * @param {{nodes?: object[], edges?: object[]}} fileData
 */
function normalizeD4DataBooleans(fileData) {
  for (const element of [...(fileData.nodes ?? []), ...(fileData.edges ?? [])]) {
    if (!element?.D4Data) continue;
    for (const group of Object.values(element.D4Data)) {
      if (!group || typeof group !== 'object') continue;
      for (const subGroup of Object.values(group)) {
        if (!subGroup || typeof subGroup !== 'object') continue;
        for (const [prop, value] of Object.entries(subGroup)) {
          if (typeof value === 'boolean') subGroup[prop] = String(value);
        }
      }
    }
  }
}

// @formatter:off
let excelData = {"s":{"readme":{"d":[[0,0,"Color Codes Explained"],[0,1,"Description"],[1,0,"Required"],[1,1,"Strictly required property"],[2,0,"Optional"],[2,1,"Optional property; Column name can not be re-used for user-defined data"],[3,0,"User Data [group]"],[3,1,"Add custom properties in new columns. Use [brackets] for grouping (e.g., \"Temperature [Celsius] [Physics]\"). The last [bracket] becomes the group name."],[5,0,"Data Types Explained"],[5,1,"Description"],[6,0,"text"],[6,1,"any text"],[7,0,"number"],[7,1,"integers or floating-point numbers"],[8,0,"boolean"],[8,1,"true or TRUE or 1, false or FALSE or 0"],[9,0,"RGBA"],[9,1,"RGBA hex color code (e.g. #C33D3580 for 50% opacity) (last 2 digits are optional)"],[10,0,"value 1 | value 2"],[10,1,"List of categorical values of which one must be matched (excluding optional information in brackets)"],[11,0,"any"],[11,1,"Categorical view when text is given, slider-based view when numerical input is given"],[13,0,"Node Properties Explained"],[13,1,"Description"],[13,2,"Default Value"],[13,3,"Type"],[14,0,"ID"],[14,1,"Unique identifier for a node"],[14,2,"-"],[14,3,"text (unique)"],[15,0,"Label"],[15,1,"Label of the node; if no Label is given, the ID is displayed per default"],[15,2,"-"],[15,3,"text"],[16,0,"Description"],[16,1,"Description of the node, displayed in the tooltip text"],[16,2,"-"],[16,3,"text"],[17,0,"Shape"],[17,1,"The shape of the node"],[17,2,"hexagon"],[17,3,"circle (●) | diamond (◆) | hexagon (⬢) | rect (■) | triangle (▲) | star (★)"],[18,0,"Size"],[18,1,"The size of the node"],[18,2,"20"],[18,3,"number"],[19,0,"Fill Color"],[19,1,"The fill color of the node in RGBA format (e.g. #FF000080 for a red node with 50% opacity)"],[19,2,"#C33D35"],[19,3,"rgba"],[20,0,"Border Size"],[20,1,"The stroke width"],[20,2,"1"],[20,3,"number"],[21,0,"Border Color"],[21,1,"The stroke color of the node in RGBA format"],[21,2,"-"],[21,3,"rgba"],[22,0,"Opacity"],[22,1,"The opacity of the node, applied to its fill and border (1 = opaque, 0 = transparent). Multiplies into the color’s own alpha, so it composes with an RGBA fill/border color."],[22,2,"1"],[22,3,"number"],[23,0,"Label Font Size"],[23,1,"Label font size"],[23,2,"12"],[23,3,"number"],[24,0,"Label Placement"],[24,1,"Label position relative to the main shape of the node"],[24,2,"bottom"],[24,3,"left | right | top | bottom | left-top | left-bottom | right-top | right-bottom | top-left | top-right | bottom-left | bottom-right | center"],[25,0,"Label Color"],[25,1,"The color of the nodes label"],[25,2,"-"],[25,3,"rgba"],[26,0,"Label Background Color"],[26,1,"Label background fill color"],[26,2,"-"],[26,3,"rgba"],[27,0,"X Coordinate"],[27,1,"The x coordinate of the node"],[27,2,"-"],[27,3,"number"],[28,0,"Y Coordinate"],[28,1,"The y coordinate of the node"],[28,2,"-"],[28,3,"number"],[29,0,"property A [group A]"],[29,1,"User-defined custom node properties"],[29,2,"-"],[29,3,"any"],[31,0,"Edge Properties Explained"],[31,1,"Description"],[31,2,"Default Value"],[31,3,"Type"],[32,0,"Source ID"],[32,1,"The ID of the source node"],[32,2,"-"],[32,3,"text"],[33,0,"Target ID"],[33,1,"The ID of the target node"],[33,2,"-"],[33,3,"text"],[34,0,"Label"],[34,1,"Label of the edge; if no Label is given, the edge is only visible as line without any text"],[34,2,"-"],[34,3,"text"],[35,0,"Description"],[35,1,"Description of the edge, displayed in the tooltip text"],[35,2,"-"],[35,3,"text"],[36,0,"Type"],[36,1,"The edge type"],[36,2,"line"],[36,3,"line | cubic | quadratic | polyline"],[37,0,"Line Width"],[37,1,"The border width of the edge"],[37,2,"0.75"],[37,3,"number"],[38,0,"Line Dash"],[38,1,"The dash offset of the edge line"],[38,2,"0"],[38,3,"number"],[39,0,"Color"],[39,1,"The stroke color of the edge in RGBA format"],[39,2,"#403C5390"],[39,3,"rgba"],[40,0,"Opacity"],[40,1,"The opacity of the edge (1 = opaque, 0 = transparent). Multiplies into the color’s own alpha, so it composes with an RGBA edge color."],[40,2,"1"],[40,3,"number"],[41,0,"Label Font Size"],[41,1,"The font size of the edges label"],[41,2,"12"],[41,3,"number"],[42,0,"Label Placement"],[42,1,"The position of the label relative to the edge"],[42,2,"center"],[42,3,"start | center | end"],[43,0,"Label Auto Rotate"],[43,1,"Whether to automatically rotate the label to match the edge’s direction"],[43,2,{"formula":"FALSE()"}],[43,3,"boolean"],[44,0,"Label Offset X"],[44,1,"The offset of the label on the X-Axis"],[44,2,"4"],[44,3,"number"],[45,0,"Label Offset Y"],[45,1,"The offset of the label on the Y-Axis"],[45,2,"0"],[45,3,"number"],[46,0,"Label Color"],[46,1,"The color of the edges label text"],[46,2,"#000000"],[46,3,"rgba"],[47,0,"Label Background Color"],[47,1,"The color for the edge label’s background"],[47,2,"-"],[47,3,"rgba"],[48,0,"Start Arrow"],[48,1,"Whether to display the start arrow on the edge"],[48,2,{"formula":"FALSE()"}],[48,3,"boolean"],[49,0,"Start Arrow Size"],[49,1,"The size of the start arrow"],[49,2,"8"],[49,3,"number"],[50,0,"Start Arrow Type"],[50,1,"The type of the start arrow"],[50,2,"arrow"],[50,3,"arrow | rect | diamond | circle | tee | triangle | vee | triangleRect | simple | square"],[51,0,"Start Arrow Color"],[51,1,"The fill color of the start arrow; inherits the edge color if unset"],[51,2,"-"],[51,3,"rgba"],[52,0,"Start Arrow Border Color"],[52,1,"The border color of the start arrow; no border if unset"],[52,2,"-"],[52,3,"rgba"],[53,0,"Start Arrow Border Size"],[53,1,"The border width of the start arrow (0 = auto, ~20% of the marker)"],[53,2,"0"],[53,3,"number"],[54,0,"End Arrow"],[54,1,"Whether to display the end arrow on the edge"],[54,2,{"formula":"FALSE()"}],[54,3,"boolean"],[55,0,"End Arrow Size"],[55,1,"The size of the end arrow"],[55,2,"8"],[55,3,"number"],[56,0,"End Arrow Type"],[56,1,"The type of the end arrow"],[56,2,"arrow"],[56,3,"arrow | rect | diamond | circle | tee | triangle | vee | triangleRect | simple | square"],[57,0,"End Arrow Color"],[57,1,"The fill color of the end arrow; inherits the edge color if unset"],[57,2,"-"],[57,3,"rgba"],[58,0,"End Arrow Border Color"],[58,1,"The border color of the end arrow; no border if unset"],[58,2,"-"],[58,3,"rgba"],[59,0,"End Arrow Border Size"],[59,1,"The border width of the end arrow (0 = auto, ~20% of the marker)"],[59,2,"0"],[59,3,"number"]],"st":{"A1":0,"B1":0,"C1":1,"D1":2,"A2":3,"B2":2,"C2":1,"D2":2,"A3":4,"B3":2,"C3":1,"D3":2,"A4":5,"B4":2,"C4":1,"D4":2,"A5":2,"B5":2,"C5":1,"D5":2,"A6":0,"B6":0,"C6":6,"D6":7,"A7":8,"B7":2,"C7":1,"D7":2,"A8":8,"B8":2,"C8":1,"D8":2,"A9":8,"B9":2,"C9":1,"D9":2,"A10":8,"B10":2,"C10":1,"D10":2,"A11":9,"B11":2,"C11":1,"D11":2,"A12":8,"B12":2,"C12":1,"D12":2,"A13":2,"B13":2,"C13":1,"D13":2,"A14":10,"B14":10,"C14":11,"D14":10,"A15":3,"B15":2,"C15":1,"D15":2,"A16":4,"B16":2,"C16":1,"D16":2,"A17":4,"B17":2,"C17":1,"D17":2,"A18":4,"B18":2,"C18":1,"D18":12,"A19":4,"B19":2,"C19":1,"D19":2,"A20":4,"B20":2,"C20":1,"D20":2,"A21":4,"B21":2,"C21":1,"D21":2,"A22":4,"B22":2,"C22":1,"D22":2,"A23":4,"B23":2,"C23":1,"D23":2,"A24":4,"B24":2,"C24":1,"D24":2,"A25":4,"B25":2,"C25":1,"D25":12,"A26":4,"B26":2,"C26":1,"D26":2,"A27":4,"B27":2,"C27":1,"D27":2,"A28":4,"B28":2,"C28":1,"D28":2,"A29":4,"B29":2,"C29":1,"D29":2,"A30":5,"B30":2,"C30":1,"D30":2,"A31":2,"B31":2,"C31":1,"D31":2,"A32":10,"B32":10,"C32":11,"D32":10,"A33":3,"B33":2,"C33":1,"D33":2,"A34":3,"B34":2,"C34":1,"D34":2,"A35":4,"B35":2,"C35":1,"D35":2,"A36":4,"B36":2,"C36":1,"D36":2,"A37":4,"B37":2,"C37":1,"D37":12,"A38":4,"B38":2,"C38":1,"D38":2,"A39":4,"B39":2,"C39":1,"D39":2,"A40":4,"B40":2,"C40":1,"D40":2,"A41":4,"B41":2,"C41":1,"D41":2,"A42":4,"B42":2,"C42":1,"D42":2,"A43":4,"B43":2,"C43":1,"D43":12,"A44":4,"B44":2,"C44":13,"D44":2,"A45":4,"B45":2,"C45":1,"D45":2,"A46":4,"B46":2,"C46":1,"D46":2,"A47":4,"B47":2,"C47":1,"D47":2,"A48":4,"B48":2,"C48":13,"D48":2,"A49":4,"B49":2,"C49":13,"D49":2,"A50":4,"B50":2,"C50":1,"D50":2,"A51":4,"B51":2,"C51":13,"D51":12,"A52":4,"B52":2,"C52":13,"D52":12,"A53":4,"B53":2,"C53":13,"D53":12,"A54":4,"B54":2,"C54":1,"D54":12,"A55":4,"B55":2,"C55":13,"D55":2,"A56":4,"B56":2,"C56":1,"D56":14,"A57":4,"B57":2,"C57":13,"D57":12,"A58":4,"B58":2,"C58":13,"D58":12,"A59":4,"B59":2,"C59":13,"D59":12,"A60":4,"B60":2,"C60":1,"D60":12},"dim":[60,4]},"nodes":{"d":[[0,0,"ID"],[0,1,"Label"],[0,2,"Description"],[0,3,"Shape"],[0,4,"Size"],[0,5,"Fill Color"],[0,6,"Border Color"],[0,7,"Feature X [group A]"],[0,8,"Feature Y [nm] [group A]"],[0,9,"Feature Z [group B]"],[1,0,"A"],[1,1,"Node 1"],[1,2,"The first node"],[1,3,"circle"],[1,4,"60"],[1,5,"#403C53"],[1,6,"#C33D35"],[1,7,"1"],[1,8,"foo"],[1,9,"1"],[2,0,"B"],[2,1,"Node 2"],[2,2,"The second node"],[2,7,"0.5"],[2,8,"foo"],[2,9,"2"],[3,0,"C"],[3,1,"Node 3"],[3,2,"The third node"],[3,7,"1.1"],[3,8,"foo"],[3,9,"1"],[4,0,"D"],[4,1,"Node 4"],[4,2,"The fourth node"],[4,7,"1.3"],[4,8,"bar"],[4,9,"0"],[5,0,"E"],[5,7,"0"],[5,8,"bar"],[5,9,"-1"],[6,0,"F"],[6,1,"Lonely Node"],[6,7,"-1"]],"st":{"A1":3,"B1":4,"C1":4,"D1":4,"E1":4,"F1":4,"G1":4,"H1":5,"I1":5,"J1":5,"A2":15,"B2":16,"C2":16,"D2":16,"E2":16,"F2":16,"G2":16,"H2":17,"I2":17,"J2":17,"A3":15,"B3":16,"C3":16,"D3":16,"E3":16,"F3":16,"G3":16,"H3":17,"I3":17,"J3":17,"A4":15,"B4":16,"C4":16,"D4":16,"E4":16,"F4":16,"G4":16,"H4":17,"I4":17,"J4":17,"A5":15,"B5":16,"C5":16,"D5":16,"E5":16,"F5":16,"G5":16,"H5":17,"I5":17,"J5":17,"A6":15,"B6":16,"C6":16,"D6":16,"E6":16,"F6":16,"G6":16,"H6":17,"I6":17,"J6":17,"A7":15,"B7":16,"C7":16,"D7":16,"E7":16,"F7":16,"G7":16,"H7":17,"I7":17,"J7":17},"dim":[7,10]},"edges":{"d":[[0,0,"Source ID"],[0,1,"Target ID"],[0,2,"Color"],[0,3,"Line Width"],[0,4,"Label"],[0,5,"Feature EX [group X]"],[0,6,"Feature EY [group X]"],[0,7,"Feature EZ [group Y]"],[1,0,"A"],[1,1,"B"],[1,2,"#FF0000"],[1,3,"0.75"],[1,4,"foo"],[1,5,"1"],[1,6,"Dummy Category 1"],[1,7,"1"],[2,0,"A"],[2,1,"C"],[2,5,"0.5"],[2,6,"Dummy Category 2"],[2,7,"2"],[3,0,"C"],[3,1,"D"],[3,5,"1.1"],[3,6,"Dummy Category 3"],[3,7,"1"],[4,0,"D"],[4,1,"E"],[4,5,"1.3"],[4,6,"Dummy Category 4"],[4,7,"0"]],"st":{"A1":3,"B1":3,"C1":4,"D1":4,"E1":4,"F1":5,"G1":5,"H1":5,"A2":15,"B2":15,"C2":16,"D2":16,"E2":16,"F2":17,"G2":17,"H2":17,"A3":15,"B3":15,"C3":16,"D3":16,"E3":16,"F3":17,"G3":17,"H3":17,"A4":15,"B4":15,"C4":16,"D4":16,"E4":16,"F4":17,"G4":17,"H4":17,"A5":15,"B5":15,"C5":16,"D5":16,"E5":16,"F5":17,"G5":17,"H5":17},"dim":[5,8]}},"st":{"0":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}},"1":{"f":{"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"left","v":"bottom"}},"2":{"f":{"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"v":"bottom"}},"3":{"f":{"b":1,"sz":10,"n":"Arial"},"fill":{"fg":"FF9A9A","bg":"FF8080"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}},"4":{"f":{"b":1,"sz":10,"n":"Arial"},"fill":{"fg":"FEFFE1","bg":"FFFFFF"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}},"5":{"f":{"b":1,"sz":10,"n":"Arial"},"fill":{"fg":"81D41A","bg":"969696"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}},"6":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"left","v":"bottom"}},"7":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"p":"none"},"a":{"v":"bottom"}},"8":{"f":{"b":1,"sz":10,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}},"9":{"f":{"b":1,"i":1,"sz":10,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}},"10":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"]},"a":{"v":"bottom"}},"11":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"]},"a":{"h":"left","v":"bottom"}},"12":{"f":{"i":1,"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"v":"bottom"}},"13":{"f":{"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"left","v":"bottom"},"nf":"\"TRUE\";\"TRUE\";\"FALSE\""},"14":{"f":{"u":1,"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"v":"bottom"}},"15":{"f":{"sz":10,"n":"Arial"},"fill":{"fg":"FF9A9A","bg":"FF8080"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}},"16":{"f":{"sz":10,"n":"Arial"},"fill":{"fg":"FEFFE1","bg":"FFFFFF"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}},"17":{"f":{"sz":10,"n":"Arial"},"fill":{"fg":"81D41A","bg":"969696"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"v":"bottom"}}},"sc":18};
// @formatter:on

// The following constants define the columns in the Excel template for mapping node and edge properties
// allowed types: "str", "num", "bool", "rgba", "oneOf:a|b|c"
// @formatter:off
const EXCEL_NODE_PROPERTIES = [
  {
    column: 'ID',
    type: 'str',
    required: true,
    get: (n) => {
      return n.id;
    },
  },
  {
    column: 'Label',
    type: 'str',
    apply: (n, v) => {
      n.label = v;
      n.style.label = false;
      n.style.labelText = v;
      n.style.labelFontSize = DEFAULTS.NODE.LABEL.FONT_SIZE;
      n.style.labelFill = DEFAULTS.NODE.LABEL.FOREGROUND_COLOR;
      n.style.labelBackground = DEFAULTS.NODE.LABEL.BACKGROUND;
      n.style.labelBackgroundFill = DEFAULTS.NODE.LABEL.BACKGROUND_COLOR;
      n.style.labelPlacement = DEFAULTS.NODE.LABEL.PLACEMENT;
    },
    get: (n) => {
      return n.label;
    },
  },
  {
    column: 'Description',
    type: 'str',
    apply: (n, v) => {
      n.description = v;
    },
    get: (n) => {
      return n.description;
    },
  },
  {
    column: 'Shape',
    type: 'oneOf:circle|diamond|hexagon|rect|triangle|star',
    apply: (n, v) => {
      n.type = v;
    },
    get: (n) => {
      return n.type;
    },
  },
  {
    column: 'Size',
    type: 'num',
    apply: (n, v) => {
      n.style.size = v;
    },
    get: (n) => {
      return n.style.size;
    },
  },
  {
    column: 'Fill Color',
    type: 'rgba',
    apply: (n, v) => {
      n.style.fill = v;
    },
    get: (n) => {
      return n.style.fill;
    },
  },
  {
    column: 'Border Size',
    type: 'num',
    apply: (n, v) => {
      n.style.lineWidth = v;
    },
    get: (n) => {
      return n.style.lineWidth;
    },
  },
  {
    column: 'Border Color',
    type: 'rgba',
    apply: (n, v) => {
      n.style.stroke = v;
    },
    get: (n) => {
      return n.style.stroke;
    },
  },
  {
    column: 'Opacity',
    type: 'num',
    apply: (n, v) => {
      n.style.opacity = v;
    },
    get: (n) => {
      return n.style.opacity;
    },
  },
  {
    column: 'Label Font Size',
    type: 'num',
    apply: (n, v) => {
      n.style.labelFontSize = v;
    },
    get: (n) => {
      return n.style.labelFontSize;
    },
  },
  {
    column: 'Label Placement',
    type:
      'oneOf:left|right|top|bottom|left-top|left-bottom|right-top|right-bottom|top-left|top-right|bottom-left|' +
      'bottom-right|center',
    apply: (n, v) => {
      n.style.labelPlacement = v;
    },
    get: (n) => {
      return n.style.labelPlacement;
    },
  },
  {
    column: 'Label Color',
    type: 'rgba',
    apply: (n, v) => {
      n.style.labelFill = v;
    },
    get: (n) => {
      return n.style.labelFill;
    },
  },
  {
    column: 'Label Background Color',
    type: 'rgba',
    apply: (n, v) => {
      n.style.labelBackground = true;
      n.style.labelBackgroundFill = v;
    },
    get: (n) => {
      return n.style.labelBackground ? n.style.labelBackgroundFill : undefined;
    },
  },
  {
    column: 'X Coordinate',
    type: 'num',
    apply: (n, v) => {
      n.style.x = v;
    },
    get: (n) => {
      return n.style.x;
    },
  },
  {
    column: 'Y Coordinate',
    type: 'num',
    apply: (n, v) => {
      n.style.y = v;
    },
    get: (n) => {
      return n.style.y;
    },
  },
];

const EXCEL_EDGE_PROPERTIES = [
  {
    column: 'Source ID',
    type: 'str',
    required: true,
    get: (e) => {
      return e.source;
    },
  },
  {
    column: 'Target ID',
    type: 'str',
    required: true,
    get: (e) => {
      return e.target;
    },
  },
  {
    column: 'Label',
    type: 'str',
    apply: (e, v) => {
      e.label = v;
      e.style.label = false;
      e.style.labelText = v;
      e.style.labelFontSize = DEFAULTS.EDGE.LABEL.FONT_SIZE;
      e.style.labelFill = DEFAULTS.EDGE.LABEL.FOREGROUND_COLOR;
      e.style.labelPlacement = DEFAULTS.EDGE.LABEL.PLACEMENT;
      e.style.labelAutoRotate = DEFAULTS.EDGE.LABEL.AUTO_ROTATE;
      e.style.labelBackground = DEFAULTS.EDGE.LABEL.BACKGROUND;
      e.style.labelBackgroundFill = DEFAULTS.EDGE.LABEL.BACKGROUND_COLOR;
    },
    get: (e) => {
      return e.label;
    },
  },
  {
    column: 'Description',
    type: 'str',
    apply: (e, v) => {
      e.description = v;
    },
    get: (e) => {
      return e.description;
    },
  },
  {
    column: 'Type',
    type: 'oneOf:line|cubic|quadratic|polyline',
    apply: (e, v) => {
      e.type = v;
    },
    get: (e) => {
      return e.type;
    },
  },
  {
    column: 'Line Width',
    type: 'num',
    apply: (e, v) => {
      e.style.lineWidth = v;
    },
    get: (e) => {
      return e.style.lineWidth;
    },
  },
  {
    column: 'Line Dash',
    type: 'num',
    apply: (e, v) => {
      e.style.lineDash = v;
    },
    get: (e) => {
      return e.style.lineDash;
    },
  },
  {
    column: 'Color',
    type: 'rgba',
    apply: (e, v) => {
      e.style.stroke = v;
    },
    get: (e) => {
      return e.style.stroke;
    },
  },
  {
    column: 'Opacity',
    type: 'num',
    apply: (e, v) => {
      e.style.opacity = v;
    },
    get: (e) => {
      return e.style.opacity;
    },
  },
  {
    column: 'Label Font Size',
    type: 'num',
    apply: (e, v) => {
      e.style.labelFontSize = v;
    },
    get: (e) => {
      return e.style.labelFontSize;
    },
  },
  {
    column: 'Label Placement',
    type: 'oneOf:start|center|end',
    apply: (e, v) => {
      e.style.labelPlacement = v;
    },
    get: (e) => {
      return e.style.labelPlacement;
    },
  },
  {
    column: 'Label Auto Rotate',
    type: 'bool',
    apply: (e, v) => {
      e.style.labelAutoRotate = v;
    },
    get: (e) => {
      return e.style.labelAutoRotate;
    },
  },
  {
    column: 'Label Offset X',
    type: 'num',
    apply: (e, v) => {
      e.style.labelOffsetX = v;
    },
    get: (e) => {
      return e.style.labelOffsetX;
    },
  },
  {
    column: 'Label Offset Y',
    type: 'num',
    apply: (e, v) => {
      e.style.labelOffsetY = v;
    },
    get: (e) => {
      return e.style.labelOffsetY;
    },
  },
  {
    column: 'Label Color',
    type: 'rgba',
    apply: (e, v) => {
      e.style.labelFill = v;
    },
    get: (e) => {
      return e.style.labelFill;
    },
  },
  {
    column: 'Label Background Color',
    type: 'rgba',
    apply: (e, v) => {
      e.style.labelBackground = true;
      e.style.labelBackgroundFill = v;
    },
    get: (e) => {
      return e.style.labelBackground ? e.style.labelBackgroundFill : undefined;
    },
  },
  {
    column: 'Start Arrow',
    type: 'bool',
    apply: (e, v) => {
      e.style.startArrow = v;
    },
    get: (e) => {
      return e.style.startArrow;
    },
  },
  {
    column: 'Start Arrow Size',
    type: 'num',
    apply: (e, v) => {
      e.style.startArrowSize = v;
    },
    get: (e) => {
      return e.style.startArrowSize;
    },
  },
  {
    column: 'Start Arrow Type',
    // New marker vocabulary + legacy G6 names (alias-mapped at render time
    // by graph_model.edgeMarkerCode) so old workbooks keep importing.
    type: 'oneOf:arrow|rect|diamond|circle|tee|triangle|vee|triangleRect|simple|square',
    apply: (e, v) => {
      e.style.startArrowType = v;
    },
    get: (e) => {
      return e.style.startArrowType;
    },
  },
  {
    column: 'Start Arrow Color',
    type: 'rgba',
    apply: (e, v) => {
      e.style.startArrowColor = v;
    },
    get: (e) => {
      return e.style.startArrow ? e.style.startArrowColor : undefined;
    },
  },
  {
    column: 'Start Arrow Border Color',
    type: 'rgba',
    apply: (e, v) => {
      e.style.startArrowBorderColor = v;
    },
    get: (e) => {
      return e.style.startArrow ? e.style.startArrowBorderColor : undefined;
    },
  },
  {
    column: 'Start Arrow Border Size',
    type: 'num',
    apply: (e, v) => {
      e.style.startArrowBorderSize = v;
    },
    get: (e) => {
      return e.style.startArrow ? e.style.startArrowBorderSize : undefined;
    },
  },
  {
    column: 'End Arrow',
    type: 'bool',
    apply: (e, v) => {
      e.style.endArrow = v;
    },
    get: (e) => {
      return e.style.endArrow;
    },
  },
  {
    column: 'End Arrow Size',
    type: 'num',
    apply: (e, v) => {
      e.style.endArrowSize = v;
    },
    get: (e) => {
      return e.style.endArrowSize;
    },
  },
  {
    column: 'End Arrow Type',
    type: 'oneOf:arrow|rect|diamond|circle|tee|triangle|vee|triangleRect|simple|square',
    apply: (e, v) => {
      e.style.endArrowType = v;
    },
    get: (e) => {
      return e.style.endArrowType;
    },
  },
  {
    column: 'End Arrow Color',
    type: 'rgba',
    apply: (e, v) => {
      e.style.endArrowColor = v;
    },
    get: (e) => {
      return e.style.endArrow ? e.style.endArrowColor : undefined;
    },
  },
  {
    column: 'End Arrow Border Color',
    type: 'rgba',
    apply: (e, v) => {
      e.style.endArrowBorderColor = v;
    },
    get: (e) => {
      return e.style.endArrow ? e.style.endArrowBorderColor : undefined;
    },
  },
  {
    column: 'End Arrow Border Size',
    type: 'num',
    apply: (e, v) => {
      e.style.endArrowBorderSize = v;
    },
    get: (e) => {
      return e.style.endArrow ? e.style.endArrowBorderSize : undefined;
    },
  },
  {
    column: 'Halo Color',
    type: 'rgba',
    apply: (e, v) => {
      e.style.halo = true;
      e.style.haloStroke = v;
    },
    get: (e) => {
      return e.style.halo ? e.style.haloStroke : undefined;
    },
  },
  {
    column: 'Halo Width',
    type: 'num',
    apply: (e, v) => {
      e.style.haloLineWidth = v;
    },
    get: (e) => {
      return e.style.haloLineWidth;
    },
  },
];
// @formatter:on

class ExcelTemplate {
  constructor(compressedData) {
    this.compressed = compressedData;
  }

  createWorkbook(ExcelJS) {
    const workbook = new ExcelJS.Workbook();

    Object.entries(this.compressed.s).forEach(([sheetName, sheet]) => {
      const worksheet = workbook.addWorksheet(sheetName);

      // Restore data from sparse format
      sheet.d.forEach(([rowIndex, colIndex, value]) => {
        const cell = worksheet.getCell(rowIndex + 1, colIndex + 1);
        cell.value = value;
      });

      // Apply styles using global style map
      if (sheet.st) {
        Object.entries(sheet.st).forEach(([ref, styleId]) => {
          const cell = worksheet.getCell(ref);
          const style = this.compressed.st[styleId];

          if (style.f) {
            cell.font = {
              bold: style.f.b,
              italic: style.f.i,
              underline: style.f.u,
              strike: style.f.s,
              size: style.f.sz || 11,
              name: style.f.n || 'Calibri',
              color: style.f.c && { argb: 'FF' + style.f.c },
            };
          }

          if (style.fill) {
            cell.fill = {
              type: 'pattern',
              pattern: style.fill.p || 'solid',
              fgColor: style.fill.fg && { argb: 'FF' + style.fill.fg },
              bgColor: style.fill.bg && { argb: 'FF' + style.fill.bg },
            };
          }

          if (style.b) {
            const border = {};
            const sides = ['top', 'bottom', 'left', 'right'];
            const keys = ['t', 'b', 'l', 'r'];
            keys.forEach((key, idx) => {
              if (style.b[key]) {
                border[sides[idx]] = {
                  style: style.b[key][0],
                  color: { argb: 'FF' + style.b[key][1] },
                };
              }
            });
            cell.border = border;
          }

          if (style.a) {
            cell.alignment = {
              horizontal: style.a.h,
              vertical: style.a.v,
              wrapText: style.a.w,
            };
          }

          if (style.nf) {
            cell.numFmt = style.nf;
          }
        });
      }
    });

    return workbook;
  }
}

class IOManager {
  constructor(cache) {
    this.cache = cache;
    this.exportScale = readExportScale();
  }

  parseJSON(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const jsonContent = JSON.parse(reader.result);
          if (!jsonContent.edges || !jsonContent.nodes) {
            this.cache.ui.error('File does not contain edges or nodes.');
            resolve(null);
          } else {
            this.noteFileVersion(jsonContent);
            // Convert arrays back to Sets for specific properties
            this.restoreSetsFromJSON(jsonContent);
            resolve(jsonContent);
          }
        } catch (errorMsg) {
          this.cache.ui.error(`Failed to parse file as JSON: ${errorMsg}`);
          resolve(null);
        }
      };
      reader.onerror = () => {
        this.cache.ui.error(`Failed to load file: ${reader.error}`);
        resolve(null);
      };
      reader.readAsText(file);
    });
  }

  restoreSetsFromJSON(jsonContent) {
    // Deduplicate headers to fix old exported files with duplicate headers
    if (jsonContent.nodeDataHeaders) {
      const seen = new Set();
      jsonContent.nodeDataHeaders = jsonContent.nodeDataHeaders.filter((h) => {
        const key = `${h.subGroup}::${h.key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (jsonContent.edgeDataHeaders) {
      const seen = new Set();
      jsonContent.edgeDataHeaders = jsonContent.edgeDataHeaders.filter((h) => {
        const key = `${h.subGroup}::${h.key}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Restore Sets in layouts
    if (jsonContent.layouts) {
      for (const layoutName in jsonContent.layouts) {
        const layout = jsonContent.layouts[layoutName];

        // Restore bubble group manual members
        for (const key in layout) {
          if (key.endsWith('ManualMembers') && Array.isArray(layout[key])) {
            layout[key] = new Set(layout[key]);
          }
          if (key.endsWith('Props') && Array.isArray(layout[key])) {
            layout[key] = new Set(layout[key]);
          }
        }

        // Restore filters Map and nested Sets
        if (layout.filters && typeof layout.filters === 'object') {
          const filtersMap = new Map(Object.entries(layout.filters));

          // Restore Sets within each filter value
          for (const [propId, filterValue] of filtersMap.entries()) {
            if (filterValue.categories && Array.isArray(filterValue.categories)) {
              filterValue.categories = new Set(filterValue.categories);
            }
            // Per-filter `${group}Members/IDs/MembersHidden/IDsHidden` sets used to be
            // revived here. Group membership lives on the LAYOUT
            // (`${group}Props` / `${group}ManualMembers`, above); those four were
            // either never read or mirrored `${group}Props`. Files that still carry
            // them are simply ignored.
          }

          layout.filters = filtersMap;
        }

        // Restore positions Map
        if (layout.positions && typeof layout.positions === 'object') {
          layout.positions = new Map(Object.entries(layout.positions));
        }

        // Restore style Maps
        if (layout.nodeStyles && typeof layout.nodeStyles === 'object') {
          layout.nodeStyles = new Map(Object.entries(layout.nodeStyles));
        }
        if (layout.edgeStyles && typeof layout.edgeStyles === 'object') {
          layout.edgeStyles = new Map(Object.entries(layout.edgeStyles));
        }
      }
    }

    // Restore Sets in filterDefaults
    if (jsonContent.filterDefaults && typeof jsonContent.filterDefaults === 'object') {
      const filterDefaultsMap = new Map(Object.entries(jsonContent.filterDefaults));

      // Restore Sets within each filter default value
      for (const [propId, filterValue] of filterDefaultsMap.entries()) {
        if (filterValue.categories && Array.isArray(filterValue.categories)) {
          filterValue.categories = new Set(filterValue.categories);
        }
      }

      jsonContent.filterDefaults = filterDefaultsMap;
    }
  }

  /**
   * Parses an Excel file into the required JSON structure.
   *
   * @param {File} file - The Excel file to be parsed.
   * @param {Object} [options]
   * @param {boolean} [options.merge] - Merge mode: a single "nodes" or "edges"
   *   sheet suffices, and empty sheets are tolerated (one of them must have rows).
   * @param {Set<string>} [options.knownNodeIDs] - Node ids already in the graph;
   *   edge endpoints are validated against the file's nodes plus this set.
   * @returns {Object} - Parsed JSON structure compatible with the existing system.
   */
  async parseExcelToJson(file, options = {}) {
    const merge = options.merge === true;
    const knownNodeIDs = options.knownNodeIDs ?? new Set();

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file);

    const nodesSheet = workbook.getWorksheet('nodes');
    const edgesSheet = workbook.getWorksheet('edges');

    if (merge ? !nodesSheet && !edgesSheet : !nodesSheet || !edgesSheet) {
      this.cache.ui.error(
        merge
          ? 'The Excel file must contain a "nodes" and/or "edges" sheet.'
          : 'The Excel file must contain a "nodes" and "edges" sheet.'
      );
      return;
    }

    const getOrNull = (row, key) => {
      const lowerCaseKey = key.toString().toLowerCase().trim();
      const value = row[Object.keys(row).find((key) => key.toLowerCase() === lowerCaseKey)];
      // Explicitly check for null/undefined to preserve 0 values
      if (value !== null && value !== undefined && value.toString().trim() !== '') {
        return value;
      }
      return null;
    };

    const validateColumns = (requiredColumns, firstRowKeys, sheetName) => {
      for (const column of requiredColumns) {
        if (!firstRowKeys.includes(column)) {
          const origColumn = firstRowKeys.filter((k) => k.toLowerCase().trim() === column)[0];
          this.cache.ui.error(`The "${sheetName}" sheet must contain an "${origColumn}" column.`);
          return;
        }
      }
    };

    const sanitizeColumns = (sheetJson, sheetDescriptor) => {
      if (!sheetJson || sheetJson.length === 0) return;

      const firstRow = sheetJson[0];
      const columnMapping = {};

      Object.keys(firstRow).forEach((originalKey) => {
        if (originalKey.startsWith('__EMPTY')) return;

        if (originalKey.includes('(') || originalKey.includes(')')) {
          columnMapping[originalKey] = originalKey.replace(/\(/g, '[').replace(/\)/g, ']');
        }
      });

      sheetJson.forEach((row) => {
        Object.entries(columnMapping).forEach(([originalKey, sanitizedKey]) => {
          if (Object.prototype.hasOwnProperty.call(row, originalKey)) {
            row[sanitizedKey] = row[originalKey];
            delete row[originalKey];
          }
        });
      });

      Object.entries(columnMapping).forEach(([original, sanitized]) => {
        this.cache.ui.warning(
          `Column "${original}" in "${sheetDescriptor}" sheet was renamed to "${sanitized}" for proper group parsing.`
        );
      });
    };

    const removeEmptyColumns = (sheetJson, sheetDescriptor) => {
      if (!sheetJson || sheetJson.length === 0) return;

      const propertyDefs =
        sheetDescriptor === 'edges' ? EXCEL_EDGE_PROPERTIES : EXCEL_NODE_PROPERTIES;
      const requiredCols = propertyDefs.filter((prop) => prop.required).map((prop) => prop.column);
      const optionalCols = propertyDefs.filter((prop) => !prop.required).map((prop) => prop.column);

      const allCols = Object.keys(sheetJson[0]).filter(
        (c) => !c.startsWith('__EMPTY') && c !== '__rowNum__'
      );

      const isColumnEmpty = (col) =>
        sheetJson.every((row) => {
          const v = row[col];
          return v == null || v.toString().trim() === '';
        });

      const emptyRequiredColumns = allCols.filter(
        (col) => requiredCols.includes(col) && isColumnEmpty(col)
      );

      const emptyOptionalColumns = allCols.filter(
        (col) => optionalCols.includes(col) && isColumnEmpty(col)
      );

      const emptyUserColumns = allCols.filter(
        (col) => !requiredCols.includes(col) && !optionalCols.includes(col) && isColumnEmpty(col)
      );

      emptyRequiredColumns.forEach((col) => {
        this.cache.ui.error(`Required column "${col}" in "${sheetDescriptor}" sheet is empty.`);
      });

      emptyOptionalColumns.forEach((col) => {
        this.cache.ui.info(`Optional column "${col}" in "${sheetDescriptor}" sheet is empty.`);
      });

      emptyUserColumns.forEach((col) => {
        this.cache.ui.warning(
          `User defined column "${col}" in "${sheetDescriptor}" sheet is empty.`
        );
      });

      const allEmptyColumns = [
        ...emptyRequiredColumns,
        ...emptyOptionalColumns,
        ...emptyUserColumns,
      ];
      sheetJson.forEach((row) => {
        allEmptyColumns.forEach((col) => delete row[col]);
      });
    };

    // ExcelJS surfaces rich cells as objects (rich-text runs, hyperlinks,
    // formulas, error cells). Normalize to the primitive the user sees in the
    // sheet — raw objects leaking into D4Data corrupt change detection and
    // crash the category filters downstream.
    const cellValueToPrimitive = (value) => {
      if (value === null || typeof value !== 'object' || value instanceof Date) return value;
      if (Array.isArray(value.richText)) return value.richText.map((run) => run.text).join('');
      if (value.text !== undefined) return cellValueToPrimitive(value.text); // hyperlink cell
      if (value.result !== undefined) return cellValueToPrimitive(value.result); // formula cell
      return null; // formula without cached result, error cell, unknown shape → empty
    };

    const worksheetToJson = (worksheet) => {
      if (!worksheet) return { headers: [], jsonData: [] };

      const jsonData = [];
      const headers = [];

      const firstRow = worksheet.getRow(1);
      firstRow.eachCell((cell, colNumber) => {
        headers[colNumber] = cellValueToPrimitive(cell.value);
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const rowData = { __rowNum__: rowNumber - 2 };

        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber];
          if (header) {
            rowData[header] = cellValueToPrimitive(cell.value);
          }
        });

        const hasData = Object.values(rowData).some(
          (val) => val !== null && val !== undefined && val !== ''
        );
        if (hasData) {
          jsonData.push(rowData);
        }
      });

      return { headers: headers, jsonData: jsonData };
    };

    const decodeKey = (key) => {
      let subGroup = this.cache.CFG.EXCEL_UNCATEGORIZED_SUBHEADER;
      let trimmedKey;

      const matches = key.match(/\[.*?\]/g);
      if (matches && matches.length >= 2) {
        const lastBracketContent = matches[matches.length - 1];
        subGroup = lastBracketContent.substring(1, lastBracketContent.length - 1).trim();

        // For multiple brackets, preserve all except the last one in the key
        const lastBracketIndex = key.lastIndexOf(matches[matches.length - 1]);
        trimmedKey = key.substring(0, lastBracketIndex).trim();
      } else if (matches && matches.length === 1) {
        const bracketContent = matches[0];
        subGroup = bracketContent.substring(1, bracketContent.length - 1).trim();
        trimmedKey = key.substring(0, key.indexOf('[')).trim();
      } else {
        trimmedKey = key.trim();
      }

      return { subGroup: subGroup, key: trimmedKey };
    };

    const nodesDataDict = worksheetToJson(nodesSheet);
    const edgesDataDict = worksheetToJson(edgesSheet);

    const nodesData = nodesDataDict.jsonData;
    const edgesData = edgesDataDict.jsonData;

    if (nodesData.length === 0 && !merge) {
      this.cache.ui.error('The "nodes" sheet is empty or invalid.');
      return;
    }

    if (edgesData.length === 0 && !merge) {
      this.cache.ui.error('The "edges" sheet is empty or invalid.');
      return;
    }

    if (merge && nodesData.length === 0 && edgesData.length === 0) {
      this.cache.ui.error('The Excel file contains no node or edge rows.');
      return;
    }

    sanitizeColumns(nodesData, 'nodes');
    sanitizeColumns(edgesData, 'edges');

    removeEmptyColumns(nodesData, 'nodes');
    removeEmptyColumns(edgesData, 'edges');

    if (nodesData.length > 0) {
      const firstNodeRowKeys = nodesDataDict.headers.map((k) => k.toLowerCase().trim());
      const requiredNodeColumns = EXCEL_NODE_PROPERTIES.filter((node) => node.required).map(
        (node) => node.column.toLowerCase().trim()
      );
      validateColumns(requiredNodeColumns, firstNodeRowKeys, 'nodes');
    }

    if (edgesData.length > 0) {
      const firstEdgeRowKeys = edgesDataDict.headers.map((k) => k.toLowerCase().trim());
      const requiredEdgeColumns = EXCEL_EDGE_PROPERTIES.filter((edge) => edge.required).map(
        (edge) => edge.column.toLowerCase().trim()
      );
      validateColumns(requiredEdgeColumns, firstEdgeRowKeys, 'edges');
    }

    const nonDataNodeColumns = new Set(
      EXCEL_NODE_PROPERTIES.map((p) => p.column.toLowerCase().trim())
    );
    const nodeDataHeaders = nodesDataDict.headers
      .filter(
        (k) =>
          !nonDataNodeColumns.has(k.toLowerCase().trim()) &&
          !k.startsWith('__EMPTY') &&
          k !== '__rowNum__'
      )
      .map((k) => decodeKey(k));

    const nonDataEdgeColumns = new Set(
      EXCEL_EDGE_PROPERTIES.map((p) => p.column.toLowerCase().trim())
    );
    const edgeDataHeaders = edgesDataDict.headers
      .filter(
        (k) =>
          !nonDataEdgeColumns.has(k.toLowerCase().trim()) &&
          !k.startsWith('__EMPTY') &&
          k !== '__rowNum__'
      )
      .map((k) => decodeKey(k));

    const addNodeOrEdgeStyle = (nodeOrEdge, row, propertyMap, descriptor) => {
      nodeOrEdge.style = {};

      propertyMap.forEach(({ column, type, required, apply }) => {
        if (required) return;

        const rowNum = row.__rowNum__ + 1;

        if (!type) {
          this.cache.ui
            .warning(`Unsure how to validate ${descriptor} property ${column} in row ${rowNum}. 
        Missing definition in EXCEL_NODE_PROPERTIES or EXCEL_EDGE_PROPERTIES?`);
          return;
        }

        const maybeValue = getOrNull(row, column);
        if (maybeValue) {
          let validated = false;
          let listValues = null;
          if (type.startsWith('oneOf:')) {
            listValues = type.split(':')[1].split('|');
            type = 'list';
          }
          switch (type) {
            case 'str':
              validated = true;
              break;
            case 'num':
              validated = StaticUtilities.isNumber(maybeValue);
              break;
            case 'bool':
              validated = StaticUtilities.isBoolean(maybeValue);
              break;
            case 'rgba':
              validated = StaticUtilities.isHexColor(maybeValue);
              break;
            case 'list':
              validated = StaticUtilities.isInList(maybeValue, listValues);
              break;
            default:
              break;
          }
          if (!validated) {
            this.cache.ui.error(
              `${descriptor} property '${column}' in row ${rowNum} has an invalid value '${maybeValue}' and will be ignored (value must be of type '${type}').`
            );
          } else {
            let coerced = maybeValue;
            if (type === 'num') coerced = parseFloat(maybeValue);
            else if (type === 'bool')
              coerced =
                typeof maybeValue === 'string'
                  ? maybeValue.trim().toLowerCase() === 'true'
                  : !!maybeValue;
            apply(nodeOrEdge, coerced);
          }
        }
      });
    };

    const validateUserData = (row, key) => {
      const val = row[key];

      // Explicitly check for null/undefined to preserve 0 values
      if (val === null || val === undefined || val.toString().trim() === '') {
        return null;
      }

      return { value: val, ...decodeKey(key) };
    };

    const addNodeOrEdgeUserData = (nodeOrEdge, row, propertyMap, header, descriptor) => {
      nodeOrEdge.D4Data = {
        [header]: {},
      };

      let propsAdded = 0;
      const reservedProperties = propertyMap.map((p) => p.column.toLowerCase().trim());

      for (let key in row) {
        if (key === '__rowNum__' || reservedProperties.includes(key.toLowerCase())) continue;

        const userData = validateUserData(row, key);

        if (!userData) continue;

        if (!Object.prototype.hasOwnProperty.call(nodeOrEdge.D4Data[header], userData.subGroup)) {
          nodeOrEdge.D4Data[header][userData.subGroup] = {};
        }

        nodeOrEdge.D4Data[header][userData.subGroup][userData.key] = userData.value;
        propsAdded++;
      }

      return propsAdded;
    };

    const nodeIDs = new Set();

    const parsedNodes = nodesData
      .map((row) => {
        const node = {};
        const nodeRowNum = row.__rowNum__ + 1;
        const descriptor = 'Node';

        const nodeID = getOrNull(row, 'ID');
        if (!nodeID) {
          this.cache.ui.warning(
            `Node in row ${nodeRowNum} does not contain an ID and will be skipped.`
          );
          return null;
        }

        if (nodeIDs.has(nodeID)) {
          this.cache.ui.warning(
            `Node in row ${nodeRowNum} (ID ${nodeID}) already exists and will be skipped.`
          );
          return null;
        }

        node.id = nodeID;
        nodeIDs.add(nodeID);

        addNodeOrEdgeStyle(node, row, EXCEL_NODE_PROPERTIES, descriptor);
        const propsAdded = addNodeOrEdgeUserData(
          node,
          row,
          EXCEL_NODE_PROPERTIES,
          this.cache.CFG.EXCEL_NODE_HEADER,
          descriptor
        );
        node._propsAdded = propsAdded;

        return node;
      })
      .filter((node) => node !== null);

    const nodesWithoutProps = parsedNodes.filter((n) => n._propsAdded === 0);
    if (nodesWithoutProps.length > 0) {
      const ids = nodesWithoutProps.map((n) => n.id);
      this.cache.ui.info(
        `${nodesWithoutProps.length} node(s) have no user-defined properties and will always be visible:\n` +
          ids.map((id) => `  - ${id}`).join('\n')
      );
    }
    parsedNodes.forEach((n) => delete n._propsAdded);

    const parsedEdges = edgesData
      .map((row) => {
        const edge = {};
        const edgeRowNum = row.__rowNum__ + 1;
        const descriptor = 'Edge';

        const sourceID = getOrNull(row, 'Source ID');
        if (!sourceID) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} does not contain a Source ID and will be skipped.`
          );
          return null;
        }

        if (!nodeIDs.has(sourceID) && !knownNodeIDs.has(String(sourceID))) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} has an invalid/missing Source ID (${sourceID}) and will be skipped.`
          );
          return null;
        }

        const targetID = getOrNull(row, 'Target ID');
        if (!targetID) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} does not contain a Target ID and will be skipped.`
          );
          return null;
        }

        if (!nodeIDs.has(targetID) && !knownNodeIDs.has(String(targetID))) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} has an invalid/missing Target ID (${targetID}) and will be skipped.`
          );
          return null;
        }

        edge.id = `${sourceID}::${targetID}`;
        edge.source = sourceID;
        edge.target = targetID;

        addNodeOrEdgeStyle(edge, row, EXCEL_EDGE_PROPERTIES, descriptor);
        const propsAdded = addNodeOrEdgeUserData(
          edge,
          row,
          EXCEL_EDGE_PROPERTIES,
          this.cache.CFG.EXCEL_EDGE_HEADER,
          descriptor
        );
        edge._propsAdded = propsAdded;

        return edge;
      })
      .filter((edge) => edge !== null);

    const edgesWithoutProps = parsedEdges.filter((e) => e._propsAdded === 0);
    if (edgesWithoutProps.length > 0) {
      const ids = edgesWithoutProps.map((e) => e.id);
      this.cache.ui.info(
        `${edgesWithoutProps.length} edge(s) have no user-defined properties and will always be visible:\n` +
          ids.map((id) => `  - ${id}`).join('\n')
      );
    }
    parsedEdges.forEach((e) => delete e._propsAdded);

    return {
      nodes: parsedNodes,
      edges: parsedEdges,
      nodeDataHeaders: nodeDataHeaders,
      edgeDataHeaders: edgeDataHeaders,
      skippedNodeRows: nodesData.length - parsedNodes.length,
      skippedEdgeRows: edgesData.length - parsedEdges.length,
    };
  }

  async downloadExcelTemplate() {
    const template = new ExcelTemplate(excelData);
    const workbook = template.createWorkbook(ExcelJS);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'simple-template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  preProcessData(fileData) {
    this.cache.reset();
    normalizeD4DataBooleans(fileData);

    this.cache.CFG.HIDE_LABELS =
      fileData.nodes.length > this.cache.CFG.MAX_NODES_BEFORE_HIDING_LABELS;
    this.cache.CFG.AVOID_MEMBERS_IN_BUBBLE_GROUPS =
      fileData.nodes.length >
      this.cache.CFG.MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS;

    this.cache.nodePositionsFromExcelImport = new Map();

    this.populateCacheHeaders(fileData);

    this.cache.data.nodes = fileData.nodes.map((node) => {
      const nodeFeatures = new Set();
      const nodeFeatureValues = new Map();
      const nodeFeatureWithinThreshold = new Map();

      for (let [section, subsection, prop, data] of this.cache.gcm.traverseD4Data(node)) {
        let propId = StaticUtilities.generatePropHashId(section, subsection, prop);
        nodeFeatures.add(propId);

        if (isNaN(data)) {
          // Split categorical values by pipe separator
          const values = String(data).includes('|')
            ? String(data)
                .split('|')
                .map((v) => v.trim())
                .filter((v) => v !== '')
            : [data];

          if (!nodeFeatureValues.has(propId)) {
            nodeFeatureValues.set(propId, new Set());
          }
          values.forEach((val) => {
            nodeFeatureValues.get(propId).add(val);
            this.populateFilterPropsLowsAndHighs(propId, val);
          });
        } else {
          nodeFeatureValues.set(propId, data);
          this.populateFilterPropsLowsAndHighs(propId, data);
        }
        nodeFeatureWithinThreshold.set(propId, null);
      }

      if (node.style?.x && node.style?.y) {
        this.cache.nodePositionsFromExcelImport.set(node.id, {
          x: node.style.x,
          y: node.style.y,
        });
      }

      // Preserve visibility from loaded data before applying defaults
      const savedVisibility = node.style?.visibility;

      const nodeDefaults = this.cache.style.getNodeStyleOrDefaults(node);
      const processedNode = {
        ...node,
        ...nodeDefaults,
        originalType: nodeDefaults.type,
        originalStyle: structuredClone(nodeDefaults.style),
        features: nodeFeatures,
        featureValues: nodeFeatureValues,
        featureIsWithinThreshold: nodeFeatureWithinThreshold,
      };

      // Restore visibility if it was set in loaded data
      if (savedVisibility) {
        processedNode.style.visibility = savedVisibility;
      }

      return processedNode;
    });

    this.cache.data.edges = fileData.edges.map((edge) => {
      const edgeFeatures = new Set();
      const edgeFeatureValues = new Map();
      const edgeFeatureWithinThreshold = new Map();

      for (let [section, subsection, prop, data] of this.cache.gcm.traverseD4Data(edge)) {
        let propId = StaticUtilities.generatePropHashId(section, subsection, prop);
        edgeFeatures.add(propId);
        if (isNaN(data)) {
          // Split categorical values by pipe separator
          const values = String(data).includes('|')
            ? String(data)
                .split('|')
                .map((v) => v.trim())
                .filter((v) => v !== '')
            : [data];

          if (!edgeFeatureValues.has(propId)) {
            edgeFeatureValues.set(propId, new Set());
          }
          values.forEach((val) => {
            edgeFeatureValues.get(propId).add(val);
            this.populateFilterPropsLowsAndHighs(propId, val);
          });
        } else {
          edgeFeatureValues.set(propId, data);
          this.populateFilterPropsLowsAndHighs(propId, data);
        }
        edgeFeatureWithinThreshold.set(propId, null);
      }

      // Preserve visibility from loaded data before applying defaults
      const savedVisibility = edge.style?.visibility;

      const edgeDefaults = this.cache.style.getEdgeStyleOrDefaults(edge);
      const processedEdge = {
        ...edge,
        ...edgeDefaults,
        originalType: edgeDefaults.type,
        originalStyle: structuredClone(edgeDefaults.style),
        features: edgeFeatures,
        featureValues: edgeFeatureValues,
        featureIsWithinThreshold: edgeFeatureWithinThreshold,
      };

      // Restore visibility if it was set in loaded data
      if (savedVisibility) {
        processedEdge.style.visibility = savedVisibility;
      }

      return processedEdge;
    });

    this.finalizeFilterClassification();

    const excelHasCoordinates = this.cache.nodePositionsFromExcelImport.size > 0;
    this.cache.data.selectedLayout =
      fileData.selectedLayout ||
      (excelHasCoordinates ? this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME : 'Default');

    // create individual map for each layout, no matter if default or manual, with positions, current filters, ..
    if (fileData.layouts) {
      this.cache.data.layouts = this.cache.io.parseLayouts(fileData.layouts);
      if (fileData.selectedLayout === this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME) {
        this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE = true;
      }
    } else {
      // Create only a single "Default" layout using force layout
      this.cache.data.layouts = {
        Default: this.cache.lm.createDefaultLayout(this.cache.DEFAULTS.LAYOUT, false),
      };

      if (excelHasCoordinates) {
        this.cache.data.layouts[this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME] =
          this.cache.lm.createDefaultLayout(this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME, true);
        this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE = true;
      }
    }

    // Rebuild layout filters in the correct order from filterDefaults
    // This ensures new columns appear in alphabetical position, not at the end
    for (const layoutName in this.cache.data.layouts) {
      const layout = this.cache.data.layouts[layoutName];
      const oldFilters = new Map(layout.filters); // Save old filter values
      layout.filters.clear(); // Clear to rebuild in correct order

      // Rebuild filters in the order they appear in filterDefaults
      for (const [propId, defaultFilter] of this.cache.data.filterDefaults.entries()) {
        if (oldFilters.has(propId)) {
          // Preserve existing filter values (user's slider positions, etc.),
          // reconciled against the property's freshly-derived type — a loaded
          // filter saved before boolean inference (or before a type override)
          // may no longer match the widget the property gets now.
          layout.filters.set(
            propId,
            this.reconcileLoadedFilterType(oldFilters.get(propId), defaultFilter)
          );
        } else {
          // Add new property with default filter
          layout.filters.set(propId, structuredClone(defaultFilter));
        }
      }
    }

    // Initialize empty stash (legacy support)
    this.cache.data.stash = {};

    this.cache.initialize({
      nodeDataHeaders: fileData.nodeDataHeaders,
      edgeDataHeaders: fileData.edgeDataHeaders,
    });
    this.cache.ui.debug('Done pre-processing data');
  }

  getDefaultFilterObject() {
    let obj = {
      active: true,
      lowerThreshold: Infinity,
      upperThreshold: -Infinity,
      isInverted: false,
      isCategory: false,
      // Boolean classification (§6.1): boolCandidate stays true while every
      // observed value is a boolean encoding (true/TRUE/1 vs false/FALSE/0);
      // finalizeFilterClassification then promotes candidates to isBoolean.
      // Classification is purely data-driven — when the data changes (e.g. a
      // third distinct number appears via the data editor), the rebuild
      // reclassifies the column automatically.
      isBoolean: false,
      boolCandidate: true,
      // Mixed-type accounting (§6.2): a column holding both numeric and text
      // values becomes an unusable (disabled) filter row instead of being
      // deleted; the counts feed the row's explanation.
      unusable: false,
      numericCount: 0,
      textCount: 0,
      hasFloatValues: false,
      categories: new Set(),
    };
    return obj;
  }

  // Accumulates one observed value into a property's filter defaults. Type
  // conflicts are NOT resolved here — numeric bounds and categorical values
  // both accumulate, and finalizeFilterClassification decides afterwards
  // whether the property is numeric, categorical, boolean, or unusable.
  populateFilterPropsLowsAndHighs(propHash, nodeOrEdgeValue) {
    if (!this.cache.data.filterDefaults.get(propHash)) {
      this.cache.data.filterDefaults.set(propHash, this.getDefaultFilterObject());
    }

    if (nodeOrEdgeValue === '') {
      return;
    }

    const fo = this.cache.data.filterDefaults.get(propHash);
    if (fo.boolCandidate && StaticUtilities.booleanTokenValue(nodeOrEdgeValue) === null) {
      fo.boolCandidate = false;
    }

    if (isNaN(nodeOrEdgeValue)) {
      fo.textCount += 1;
      fo.isCategory = true;
      fo.categories.add(nodeOrEdgeValue);
      return;
    }

    fo.numericCount += 1;
    if (!fo.hasFloatValues && !StaticUtilities.isInteger(nodeOrEdgeValue)) {
      fo.hasFloatValues = true;
    }
    fo.lowerThreshold = Math.min(nodeOrEdgeValue, fo.lowerThreshold);
    fo.upperThreshold = Math.max(nodeOrEdgeValue, fo.upperThreshold);
  }

  // Reconcile a filter loaded from a saved workspace with the property's
  // freshly-derived default. Boolean props canonicalize the saved categories
  // (pre-inference files stored raw spellings like 'TRUE'); a type mismatch
  // in either direction falls back to a clone of the new default. Non-boolean
  // props keep the loaded filter untouched (today's behavior).
  reconcileLoadedFilterType(loaded, defaultFilter) {
    if (defaultFilter.isBoolean) {
      const canonical = new Set(
        [...(loaded.categories ?? [])]
          .map((c) => StaticUtilities.booleanTokenValue(c))
          .filter((c) => c !== null)
      );
      if (loaded.isCategory && canonical.size > 0) {
        return {
          ...structuredClone(defaultFilter),
          active: loaded.active,
          categories: canonical,
        };
      }
      return structuredClone(defaultFilter); // numeric-era or empty → reset
    }
    if (defaultFilter.unusable || loaded.isBoolean) {
      return structuredClone(defaultFilter);
    }
    return loaded;
  }

  /**
   * Resolve every property's final filter type once all values are collected
   * (§6.1/§6.2). Runs after the node/edge preprocessing loops and before the
   * per-layout filter rebuild, so cloned layout filters inherit the result.
   *
   * - Boolean: every value is a boolean encoding → isBoolean (a refined
   *   categorical with canonical categories {'true','false'}).
   * - Mixed numeric+text: kept visible but marked unusable (disabled row)
   *   instead of the pre-1.17 silent delete.
   */
  finalizeFilterClassification() {
    for (const [propHash, fo] of this.cache.data.filterDefaults.entries()) {
      const hasText = fo.categories.size > 0;
      const hasNumeric = fo.lowerThreshold !== Infinity;
      if (!hasText && !hasNumeric) continue; // header-only property, no values

      if (fo.boolCandidate) {
        fo.isBoolean = true;
        fo.isCategory = true;
        fo.categories = new Set(['true', 'false']);
        this.#canonicalizeBooleanFeatureValues(propHash);
        continue;
      }

      if (hasText && hasNumeric) {
        fo.unusable = true;
        fo.active = false;
        const [section, subSection, prop] = StaticUtilities.decodePropHashId(propHash);
        this.cache.ui.warning(
          `Property ${prop} (section ${section}, sub-section ${subSection}) mixes ` +
            `${fo.numericCount} numeric and ${fo.textCount} text values — its filter is disabled.`
        );
      }
    }
  }

  // Rewrite a boolean property's derived featureValues to canonical
  // Set{'true'|'false'} on every carrier, so categorical consumers (color
  // ramps, pies, IN queries) see one value space regardless of the source
  // encoding (TRUE vs 1). Raw D4Data is never touched — exports stay
  // byte-faithful.
  #canonicalizeBooleanFeatureValues(propHash) {
    for (const element of [...this.cache.data.nodes, ...this.cache.data.edges]) {
      if (!element.features?.has(propHash)) continue;
      const raw = element.featureValues.get(propHash);
      const rawValues = raw instanceof Set ? [...raw] : [raw];
      const canonical = new Set();
      for (const value of rawValues) {
        canonical.add(StaticUtilities.booleanTokenValue(value) ?? 'false');
      }
      element.featureValues.set(propHash, canonical);
    }
  }

  populateCacheHeaders(fileData) {
    if (fileData.nodeDataHeaders) {
      for (const nodeHeader of fileData.nodeDataHeaders) {
        const nodePropHash = StaticUtilities.generatePropHashId(
          this.cache.CFG.EXCEL_NODE_HEADER,
          nodeHeader.subGroup,
          nodeHeader.key
        );
        this.cache.data.filterDefaults.set(nodePropHash, this.getDefaultFilterObject());
      }
    }
    if (fileData.edgeDataHeaders) {
      for (const edgeHeader of fileData.edgeDataHeaders) {
        const edgePropHash = StaticUtilities.generatePropHashId(
          this.cache.CFG.EXCEL_EDGE_HEADER,
          edgeHeader.subGroup,
          edgeHeader.key
        );
        this.cache.data.filterDefaults.set(edgePropHash, this.getDefaultFilterObject());
      }
    }
  }

  buildExportFilename(ext, suffix = '') {
    const now = new Date();
    const ts =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      '-' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');

    const label = document.getElementById('dataSourceLabel')?.textContent || '';
    let basename = label
      .replace(/\.[a-z0-9]+$/i, '') // strip file extension
      .replace(/^(\d{8}-\d{6}_GLL_)+/, '') // strip stacked GLL prefixes
      .replace(/[<>:"/\\|?*,]+/g, '_') // replace unsafe chars
      .replace(/\s+/g, '_') // spaces to underscores
      .replace(/_+/g, '_') // collapse multiple underscores
      .replace(/^_|_$/g, ''); // trim leading/trailing underscores

    if (!basename) basename = 'export';
    if (suffix) basename += `_${suffix}`;

    return `${ts}_GLL_${basename}.${ext}`;
  }

  /**
   * Record the producing version of a loaded file (for diagnostics and any
   * future targeted migration) and warn — softly — when the file was saved by
   * a NEWER app than the one loading it, where forward compatibility is not
   * guaranteed. Older or version-less files load silently: the importer is
   * backward-tolerant by defaulting every missing key.
   */
  noteFileVersion(jsonContent) {
    // Validate at the boundary: keep only a string version, else null — never
    // store an arbitrary JSON value (number/object) as the producing version.
    const raw = jsonContent?.version;
    const version = typeof raw === 'string' ? raw : null;
    this.cache.loadedFileVersion = version;
    if (version && StaticUtilities.isVersionNewer(version, VERSION)) {
      this.cache.ui.info(
        `This file was saved by a newer version (v${version}) than this app ` +
          `(v${VERSION}). Some settings may not load correctly.`
      );
    }
  }

  /**
   * The serialized save: the live graph state plus a top-level `version` stamp
   * and the workspace heatmap overlay (held on the adapter, not in cache.data,
   * so it must be folded in explicitly). Pure — does not mutate cache.data.
   */
  buildExportPayload() {
    // version last so the current app stamp always wins, even if a stale
    // version key ever rode in on cache.data.
    const payload = { ...this.cache.data, version: VERSION };
    const heatmap = this.cache.graph?.heatmapLayer;
    if (heatmap) {
      payload.heatmap = {
        enabled: !!heatmap.heatmapEnabled,
        settings: { ...heatmap.settings },
      };
    }
    return payload;
  }

  /**
   * Restore the heatmap overlay from a loaded file onto the freshly-created
   * adapter. Settings first, then enabled, so the dim-graph refresh in
   * setHeatmapEnabled sees the final settings. No-op for files without a
   * heatmap block (backward compatible) or before the graph exists.
   */
  restoreHeatmapFromImport(fileData) {
    const heatmap = this.cache.graph?.heatmapLayer;
    if (!heatmap || !fileData?.heatmap) return;
    if (fileData.heatmap.settings) heatmap.updateSettings(fileData.heatmap.settings);
    heatmap.setHeatmapEnabled(!!fileData.heatmap.enabled);
  }

  async exportGraphAsJSON() {
    if (this.cache.data === null) {
      this.cache.ui.error('No graph data to save.');
      return false;
    }

    // helper for JSON.stringify to serialize Maps to plain objects and Sets to arrays
    function replacer(key, value) {
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return [...value];
      return value;
    }

    await this.cache.ui.showLoading('Exporting graph ..');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // Clear and rebuild headers from filterDefaults to avoid duplicates
    this.cache.data.nodeDataHeaders = [];
    this.cache.data.edgeDataHeaders = [];

    for (const filterDefaultKey of this.cache.data.filterDefaults.keys()) {
      const [nodeOrEdge, subGroup, key] = StaticUtilities.decodePropHashId(filterDefaultKey);
      const targetList =
        nodeOrEdge === this.cache.CFG.EXCEL_NODE_HEADER
          ? this.cache.data.nodeDataHeaders
          : this.cache.data.edgeDataHeaders;
      const elem = { subGroup: subGroup, key: key };

      // Check if header already exists by comparing actual values
      const exists = targetList.some((h) => h.subGroup === elem.subGroup && h.key === elem.key);
      if (!exists) {
        // Insert next to existing group members to keep groups contiguous
        const lastGroupIdx = targetList.findLastIndex((h) => h.subGroup === subGroup);
        if (lastGroupIdx !== -1) {
          targetList.splice(lastGroupIdx + 1, 0, elem);
        } else {
          targetList.push(elem);
        }
      }
    }

    // Clean base node/edge styles - only keep visibility, remove all other style properties
    // All styles should be stored in per-layout nodeStyles/edgeStyles maps
    if (this.cache.graph) {
      const { nodes, edges } = await this.cache.graph.getData();

      // Reset cache.data.nodes to clean state, only preserving visibility
      for (const node of this.cache.data.nodes) {
        const graphNode = nodes.find((n) => n.id === node.id);
        const visibility = graphNode?.style?.visibility || 'visible';

        // Get the original clean style and type from nodeRef
        const nodeRefData = this.cache.nodeRef.get(node.id);
        if (nodeRefData && nodeRefData.originalStyle) {
          // Reset to original clean style and type, then apply visibility
          node.style = structuredClone(nodeRefData.originalStyle);
          node.style.visibility = visibility;
          node.type = nodeRefData.originalType;
        } else {
          // Fallback: only preserve visibility
          node.style = { visibility: visibility };
        }
      }

      // Reset cache.data.edges to clean state, only preserving visibility
      for (const edge of this.cache.data.edges) {
        const graphEdge = edges.find((e) => e.id === edge.id);
        const visibility = graphEdge?.style?.visibility || 'visible';

        // Get the original clean style and type from edgeRef
        const edgeRefData = this.cache.edgeRef.get(edge.id);
        if (edgeRefData && edgeRefData.originalStyle) {
          // Reset to original clean style and type, then apply visibility
          edge.style = structuredClone(edgeRefData.originalStyle);
          edge.style.visibility = visibility;
          edge.type = edgeRefData.originalType;
        } else {
          // Fallback: only preserve visibility
          edge.style = { visibility: visibility };
        }
      }
    }

    const blob = new Blob([JSON.stringify(this.buildExportPayload(), replacer)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.buildExportFilename('json');
    a.click();
    URL.revokeObjectURL(url);
    await this.cache.ui.hideLoading();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  parseLayouts(jsonLayouts) {
    const parsedLayouts = {};
    Object.entries(jsonLayouts).forEach(([key, layout]) => {
      const positions =
        layout.positions instanceof Map
          ? layout.positions
          : new Map(Object.entries(layout.positions || {}));
      parsedLayouts[key] = {
        // layoutType gates the initial layout run in core.js: a view with no
        // positions needs one so the force algorithm fires. Authored payloads
        // (e.g. bubble groups, §7) omit it; without this default they'd render
        // every node stacked at the origin. Honour an explicit value when given.
        layoutType:
          layout.layoutType || (positions.size === 0 ? this.cache.DEFAULTS.LAYOUT : undefined),
        internals: layout.internals || null,
        // Check if already a Map (from restoreSetsFromJSON), otherwise convert
        positions,
        filters: this.parseFiltersAsMap(layout.filters),
        isCustom: layout.isCustom || false,
        query: layout['query'] || undefined,
        // Per-view filter-join settings; default for pre-1.15.4 files that
        // predate them (OR / non-strict = the historical behavior).
        filterJoinMode: layout.filterJoinMode === 'AND' ? 'AND' : 'OR',
        filterStrict: layout.filterStrict === true,
        // Per-view styles - check if already Maps
        hideDisconnectedNodes: layout.hideDisconnectedNodes || false,
        nodeStyles:
          layout.nodeStyles instanceof Map
            ? layout.nodeStyles
            : new Map(Object.entries(layout.nodeStyles || {})),
        edgeStyles:
          layout.edgeStyles instanceof Map
            ? layout.edgeStyles
            : new Map(Object.entries(layout.edgeStyles || {})),
        bubbleSetStyle: (() => {
          const defaults = this.cache.DEFAULTS.BUBBLE_GROUP_STYLE;
          const merged = {};
          // Iterate the SAVED group keys, never the defaults': a model is the
          // authority on which groups it has, and the defaults are a template
          // that does not enumerate them. Keying off the defaults would drop
          // every group a file names that the template does not.
          for (const group of savedLayoutGroupKeys(layout)) {
            merged[group] = {
              ...(defaults[group] ?? {}),
              ...(layout.bubbleSetStyle?.[group] || {}),
            };
          }
          return merged;
        })(),
        // Trust boundary for loaded text notes: malformed records are dropped,
        // fields are clamped/defaulted (annotation_geometry.js). Pre-note
        // files simply get [].
        annotations: sanitizeAnnotations(layout.annotations),
      };

      // Keyed off the layout BEING PARSED, not traverseBubbleSets(): that reads
      // data.layouts[data.selectedLayout], a different and not-yet-installed
      // workspace. Once the group list is per-layout, a load into a workspace
      // with a different set of groups would leave these as raw arrays instead
      // of Sets, and getEffectiveGroupMembers would throw on `.has()`.
      for (let group of Object.keys(parsedLayouts[key].bubbleSetStyle)) {
        parsedLayouts[key][`${group}Props`] = new Set(layout[`${group}Props`] || []);
        // Also restore ManualMembers if not already restored
        parsedLayouts[key][`${group}ManualMembers`] =
          layout[`${group}ManualMembers`] instanceof Set
            ? layout[`${group}ManualMembers`]
            : new Set(layout[`${group}ManualMembers`] || []);
      }
    });
    return parsedLayouts;
  }

  parseFiltersAsMap(filtersObj) {
    if (filtersObj instanceof Map) {
      return structuredClone(filtersObj);
    }

    return new Map(
      Object.entries(filtersObj || {}).map(([key, value]) => [
        key,
        { ...value, categories: new Set(value?.categories || []) },
      ])
    );
  }

  loadFile(event) {
    const file = event.target.files[0];
    if (!file) {
      this.cache.ui.error('No file selected.');
      return Promise.resolve(null);
    }

    const fileType = file.name.split('.').pop().toLowerCase();

    try {
      switch (fileType) {
        case 'json':
          return this.parseJSON(file);

        case 'xls':
        case 'xlsx':
        case 'ods':
          return file
            .arrayBuffer()
            .then((buffer) => {
              return this.parseExcelToJson(buffer);
            })
            .catch((errorMsg) => {
              this.cache.ui.error(`Error reading Excel file: ${errorMsg}`);
              return null;
            });

        default:
          this.cache.ui.error(`Unsupported file type: ${fileType}`);
      }
    } catch (errorMsg) {
      this.cache.ui.error(`Failed to load file: ${errorMsg}`);
    }

    // Reset the file input for subsequent uploads
    event.target.value = '';
  }

  async loadFileWrapper(event) {
    let file = event.target.files[0];
    if (!file) return;

    this.cache.ui.setDataSourceLabel(file.name);

    await this.cache.ui.showLoading(
      'Loading',
      `Loading ${file.name} (${file.type} with ${StaticUtilities.humanFileSize(file.size)})`
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));

    if (this.cache.graph) {
      await this.cache.gcm.destroyGraphAndRollBackUI();
      await this.cache.gcm.resetEventLocks();
    }

    this.cache.io
      .loadFile(event)
      .then(async (fileData) => {
        if (!fileData) {
          this.cache.ui.error('File data is empty.');
          await this.cache.ui.hideLoading();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return;
        }

        this.cache.io.preProcessData(fileData);
        this.cache.ui.updateHoverToggleButton();
        this.cache.buildDataTable(fileData);
        this.cache.ui.buildUI();

        // Check if there's a saved query and set lock state
        const savedQuery = this.cache.data.layouts[this.cache.data.selectedLayout]['query'];
        if (savedQuery) {
          this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
          this.cache.qm.updateQueryTextArea();
          this.cache.qm.updateUIFromQueryInstructions();
        }

        await this.cache.gcm.createGraphInstance();

        if (!this.cache.graph) {
          this.cache.ui.error('Graph not initialized, aborting.');
          await this.cache.ui.hideLoading();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return;
        }
        await this.cache.graph.render();
        await this.cache.gcm.fitViewToVisibleNodes();
        this.cache.io.restoreHeatmapFromImport(fileData);

        // Restored ManualMembers populate the layout, but the selection-panel
        // badges (per-group deselect toggles) only refresh via these calls —
        // mirror the post-layout sync so loaded groups stay deselectable.
        this.cache.bs.updateManualGroupStatus();
        this.cache.bs.updateManualGroupButtonState();

        this.cache.ui.debug('Initial graph rendered.');

        // Update UI lock state if query was applied
        if (savedQuery) {
          this.cache.ui.updateFilterLockState();
        }
      })
      .catch(async (errorMsg) => {
        this.cache.ui.error(`Error loading graph: ${errorMsg}`);
        await this.cache.ui.hideLoading();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      })
      .finally(async () => {
        await this.cache.ui.hideLoading();
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
  }

  /**
   * Export the current viewport as PNG. An explicit `scale` (1/2/4) updates
   * and persists the remembered resolution; calling without one (keyboard "P")
   * reuses it. The renderer clamps the factor to canvas limits — if the final
   * resolution fell short of the request, the user is told.
   */
  async exportPNG(scale) {
    if (typeof scale === 'number') {
      this.exportScale = scale;
      writeExportScale(scale);
    }
    const useScale = this.exportScale || 1;

    try {
      await this.cache.ui.showLoading('Loading', 'Generating picture data');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { url, requestedScale, appliedScale } = await this.cache.graph.toDataURL({
        scale: useScale,
      });

      const link = document.createElement('a');
      link.href = url;
      link.download = this.buildExportFilename('png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));

      if (appliedScale < requestedScale - 1e-6) {
        this.cache.ui.warning(
          `Image too large at ${requestedScale}× — exported at the maximum supported resolution instead.`
        );
      }
    } catch (errorMsg) {
      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.cache.ui.error(errorMsg);
    }
  }

  /**
   * Export the current viewport as SVG — resolution-independent vector output
   * (publication figures, editable in Inkscape/Illustrator), so there is no
   * scale factor and no canvas size ceiling involved.
   */
  async exportSVG() {
    try {
      await this.cache.ui.showLoading('Loading', 'Generating vector data');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const { svg } = this.cache.graph.toSVG();

      const objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      // The download fetches the blob AFTER click() returns (asynchronously),
      // so revoking on this tick races it — Firefox reliably saves an empty
      // file. Defer the revoke; a data URI is no alternative because large
      // graphs exceed browsers' data-URI navigation limits.
      setTimeout(() => URL.revokeObjectURL(objectUrl), SVG_URL_REVOKE_DELAY_MS);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = this.buildExportFilename('svg');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    } catch (errorMsg) {
      await this.cache.ui.hideLoading();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.cache.ui.error(errorMsg);
    }
  }
}

export {
  excelData,
  ExcelTemplate,
  EXCEL_NODE_PROPERTIES,
  EXCEL_EDGE_PROPERTIES,
  IOManager,
  normalizeD4DataBooleans,
};
