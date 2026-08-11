/**
 * The Excel interchange schema: the compressed template workbook the ⤓
 * download is built from, and the column tables that map every spreadsheet
 * column onto a node or edge property in both directions.
 *
 * Data, not behaviour — it lived in io.js purely because that is where it was
 * first needed, and made up a quarter of that module.
 */
import { DEFAULTS } from '../config.js';

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

export { excelData, EXCEL_NODE_PROPERTIES, EXCEL_EDGE_PROPERTIES };
