import { DEFAULTS, CFG } from "../config.js";
import { StaticUtilities } from "../utilities/static.js";
import { buildDataTable } from "../utilities/data_editor.js";

// @formatter:off
let excelData = {"s":{"readme":{"d":[[0,0,"Color Codes Explained"],[0,1,"Description"],[1,0,"Required"],[1,1,"Strictly required property"],[2,0,"Optional"],[2,1,"Optional property; Column name can not be re-used for user-defined data"],[3,0,"User Data [group]"],[3,1,"Add custom properties in new columns. Use [brackets] for grouping (e.g., \"Temperature [Celsius] [Physics]\"). The last [bracket] becomes the group name."],[5,0,"Data Types Explained"],[5,1,"Description"],[6,0,"text"],[6,1,"any text"],[7,0,"number"],[7,1,"whole decimal numbers or floating point numbers"],[8,0,"boolean"],[8,1,"true or TRUE or 1, false or FALSE or 0"],[9,0,"RGBA"],[9,1,"RGBA hex color code (e.g. #C33D3580 for 50% opacity) (last 2 digits are optional)"],[10,0,"value 1 | value 2"],[10,1,"List of categorical values of which one must be matched (excluding optional information in brackets)"],[11,0,"any"],[11,1,"Categorical view when text is given, slider-based view when numerical input is given"],[13,0,"Node Properties Explained"],[13,1,"Description"],[13,2,"Default Value"],[13,3,"Type"],[14,0,"ID"],[14,1,"Unique identifier for a node"],[14,2,"-"],[14,3,"text (unique)"],[15,0,"Label"],[15,1,"Label of the node; if no Label is given, the ID is displayed per default"],[15,2,"-"],[15,3,"text"],[16,0,"Description"],[16,1,"Description of the node, displayed in the tooltip text"],[16,2,"-"],[16,3,"text"],[17,0,"Shape"],[17,1,"The shape of the node"],[17,2,"hexagon"],[17,3,"circle (●) | diamond (◆) | hexagon (⬢) | rect (■) | triangle (▲) | star (★)"],[18,0,"Size"],[18,1,"The size of the node"],[18,2,"20"],[18,3,"number"],[19,0,"Fill Color"],[19,1,"The fill color of the node in RGBA format (e.g. #FF000080 for a red node with 50% opacity)"],[19,2,"#C33D35"],[19,3,"rgba"],[20,0,"Border Size"],[20,1,"The stroke width"],[20,2,"1"],[20,3,"number"],[21,0,"Border Color"],[21,1,"The stroke color of the node in RGBA format"],[21,2,"-"],[21,3,"rgba"],[22,0,"Label Font Size"],[22,1,"Label font size"],[22,2,"12"],[22,3,"number"],[23,0,"Label Placement"],[23,1,"Label position relative to the main shape of the node"],[23,2,"bottom"],[23,3,"left | right | top | bottom | left-top | left-bottom | right-top | right-bottom | top-left | top-right | bottom-left | bottom-right | center"],[24,0,"Label Color"],[24,1,"The color of the nodes label"],[24,2,"-"],[24,3,"rgba"],[25,0,"Label Background Color"],[25,1,"Label background fill color"],[25,2,"-"],[25,3,"rgba"],[26,0,"X Coordinate"],[26,1,"The x coordinate of the node"],[26,2,"-"],[26,3,"number"],[27,0,"Y Coordinate"],[27,1,"The y coordinate of the node"],[27,2,"-"],[27,3,"number"],[28,0,"property A [group A]"],[28,1,"User-defined custom node properties"],[28,2,"-"],[28,3,"any"],[30,0,"Edge Properties Explained"],[30,1,"Description"],[30,2,"Default Value"],[30,3,"Type"],[31,0,"Source ID"],[31,1,"The ID of the source node"],[31,2,"-"],[31,3,"text"],[32,0,"Target ID"],[32,1,"The ID of the target node"],[32,2,"-"],[32,3,"text"],[33,0,"Label"],[33,1,"Label of the edge; if no Label is given, the edge is only visible as line without any text"],[33,2,"-"],[33,3,"text"],[34,0,"Description"],[34,1,"Description of the edge, displayed in the tooltip text"],[34,2,"-"],[34,3,"text"],[35,0,"Type"],[35,1,"The edge type"],[35,2,"line"],[35,3,"line | cubic | quadratic | polyline"],[36,0,"Line Width"],[36,1,"The border width of the edge"],[36,2,"0.75"],[36,3,"number"],[37,0,"Line Dash"],[37,1,"The dash offset of the edge line"],[37,2,"0"],[37,3,"number"],[38,0,"Color"],[38,1,"The stroke color of the edge in RGBA format"],[38,2,"#403C5390"],[38,3,"rgba"],[39,0,"Label Font Size"],[39,1,"The font size of the edges label"],[39,2,"center"],[39,3,"number"],[40,0,"Label Placement"],[40,1,"The position of the label relative to the edge"],[40,2,"#000000"],[40,3,"start | center | end"],[41,0,"Label Auto Rotate"],[41,1,"Whether to automatically rotate the label to match the edge’s direction"],[41,2,"1"],[41,3,"boolean"],[42,0,"Label Offset X"],[42,1,"The offset of the label on the X-Axis"],[42,2,"0"],[42,3,"number"],[43,0,"Label Offset Y"],[43,1,"The offset of the label on the Y-Axis"],[43,2,"0"],[43,3,"number"],[44,0,"Label Color"],[44,1,"The color of the edges label text"],[44,2,"-"],[44,3,"rgba"],[45,0,"Label Background Color"],[45,1,"The color for the edge label’s background"],[45,2,"#E4E3EA"],[45,3,"rgba"],[46,0,"Start Arrow"],[46,1,"Whether to display the start arrow on the edge"],[46,2,{"formula":"FALSE()"}],[46,3,"boolean"],[47,0,"Start Arrow Size"],[47,1,"The size of the start arrow"],[47,2,"8"],[47,3,"number"],[48,0,"Start Arrow Type"],[48,1,"The type of the start arrow"],[48,2,"triangle"],[48,3,"triangle | circle | diamond | vee | rect | triangleRect | simple"],[49,0,"End Arrow"],[49,1,"Whether to display the end arrow on the edge"],[49,2,{"formula":"FALSE()"}],[49,3,"boolean"],[50,0,"End Arrow Size"],[50,1,"The size of the end arrow"],[50,2,"8"],[50,3,"number"],[51,0,"End Arrow Type"],[51,1,"The type of the end arrow"],[51,2,"triangle"],[51,3,"triangle | circle | diamond | vee | rect | triangleRect | simple"]],"st":{"A1":0,"B1":0,"C1":1,"D1":2,"A2":3,"B2":2,"C2":1,"D2":2,"A3":4,"B3":2,"C3":1,"D3":2,"A4":5,"B4":2,"C4":1,"D4":2,"A5":2,"B5":2,"C5":1,"D5":2,"A6":0,"B6":0,"C6":6,"D6":7,"A7":8,"B7":2,"C7":1,"D7":2,"A8":8,"B8":2,"C8":1,"D8":2,"A9":8,"B9":2,"C9":1,"D9":2,"A10":8,"B10":2,"C10":1,"D10":2,"A11":9,"B11":2,"C11":1,"D11":2,"A12":8,"B12":2,"C12":1,"D12":2,"A13":2,"B13":2,"C13":1,"D13":2,"A14":10,"B14":10,"C14":11,"D14":10,"A15":3,"B15":2,"C15":1,"D15":2,"A16":4,"B16":2,"C16":1,"D16":2,"A17":4,"B17":2,"C17":1,"D17":2,"A18":4,"B18":2,"C18":1,"D18":12,"A19":4,"B19":2,"C19":1,"D19":2,"A20":4,"B20":2,"C20":1,"D20":2,"A21":4,"B21":2,"C21":1,"D21":2,"A22":4,"B22":2,"C22":1,"D22":2,"A23":4,"B23":2,"C23":1,"D23":2,"A24":4,"B24":2,"C24":1,"D24":12,"A25":4,"B25":2,"C25":1,"D25":2,"A26":4,"B26":2,"C26":1,"D26":2,"A27":4,"B27":2,"C27":1,"D27":2,"A28":4,"B28":2,"C28":1,"D28":2,"A29":5,"B29":2,"C29":1,"D29":2,"A30":2,"B30":2,"C30":1,"D30":2,"A31":10,"B31":10,"C31":11,"D31":10,"A32":3,"B32":2,"C32":1,"D32":2,"A33":3,"B33":2,"C33":1,"D33":2,"A34":4,"B34":2,"C34":1,"D34":2,"A35":4,"B35":2,"C35":1,"D35":2,"A36":4,"B36":2,"C36":1,"D36":12,"A37":4,"B37":2,"C37":1,"D37":2,"A38":4,"B38":2,"C38":1,"D38":2,"A39":4,"B39":2,"C39":1,"D39":2,"A40":4,"B40":2,"C40":1,"D40":2,"A41":4,"B41":2,"C41":1,"D41":12,"A42":4,"B42":2,"C42":13,"D42":2,"A43":4,"B43":2,"C43":1,"D43":2,"A44":4,"B44":2,"C44":1,"D44":2,"A45":4,"B45":2,"C45":1,"D45":2,"A46":4,"B46":2,"C46":13,"D46":2,"A47":4,"B47":2,"C47":13,"D47":2,"A48":4,"B48":2,"C48":1,"D48":2,"A49":4,"B49":2,"C49":13,"D49":12,"A50":4,"B50":2,"C50":13,"D50":2,"A51":4,"B51":2,"C51":1,"D51":14,"A52":4,"B52":2,"C52":13,"D52":12},"dim":[52,4]},"nodes":{"d":[[0,0,"ID"],[0,1,"Label"],[0,2,"Description"],[0,3,"Shape"],[0,4,"Size"],[0,5,"Fill Color"],[0,6,"Border Color"],[0,7,"Feature X [group A]"],[0,8,"Feature Y [nm] [group A]"],[0,9,"Feature Z [group B]"],[1,0,"A"],[1,1,"Node 1"],[1,2,"The first node"],[1,3,"circle"],[1,4,"60"],[1,5,"#403C53"],[1,6,"#C33D35"],[1,7,"1"],[1,8,"foo"],[1,9,"1"],[2,0,"B"],[2,1,"Node 2"],[2,2,"The second node"],[2,7,"0.5"],[2,8,"foo"],[2,9,"2"],[3,0,"C"],[3,1,"Node 3"],[3,2,"The third node"],[3,7,"1.1"],[3,8,"foo"],[3,9,"1"],[4,0,"D"],[4,1,"Node 4"],[4,2,"The fourth node"],[4,7,"1.3"],[4,8,"bar"],[4,9,"0"],[5,0,"E"],[5,7,"0"],[5,8,"bar"],[5,9,"-1"],[6,0,"F"],[6,1,"Lonely Node"],[6,7,"-1"]],"st":{"A1":3,"B1":4,"C1":4,"D1":4,"E1":4,"F1":4,"G1":4,"H1":5,"I1":5,"J1":5,"A2":15,"B2":16,"C2":16,"D2":16,"E2":16,"F2":16,"G2":16,"H2":17,"I2":17,"J2":17,"A3":15,"B3":16,"C3":16,"D3":16,"E3":16,"F3":16,"G3":16,"H3":17,"I3":17,"J3":17,"A4":15,"B4":16,"C4":16,"D4":16,"E4":16,"F4":16,"G4":16,"H4":17,"I4":17,"J4":17,"A5":15,"B5":16,"C5":16,"D5":16,"E5":16,"F5":16,"G5":16,"H5":17,"I5":17,"J5":17,"A6":15,"B6":16,"C6":16,"D6":16,"E6":16,"F6":16,"G6":16,"H6":17,"I6":17,"J6":17,"A7":15,"B7":16,"C7":16,"D7":16,"E7":16,"F7":16,"G7":16,"H7":17,"I7":17,"J7":17},"dim":[7,10]},"edges":{"d":[[0,0,"Source ID"],[0,1,"Target ID"],[0,2,"Color"],[0,3,"Line Width"],[0,4,"Label"],[0,5,"Feature EX [group X]"],[0,6,"Feature EY [group X]"],[0,7,"Feature EZ [group Y]"],[1,0,"A"],[1,1,"B"],[1,2,"#FF0000"],[1,3,"0.75"],[1,4,"foo"],[1,5,"1"],[1,6,"Dummy Category 1"],[1,7,"1"],[2,0,"A"],[2,1,"C"],[2,5,"0.5"],[2,6,"Dummy Category 2"],[2,7,"2"],[3,0,"C"],[3,1,"D"],[3,5,"1.1"],[3,6,"Dummy Category 3"],[3,7,"1"],[4,0,"D"],[4,1,"E"],[4,5,"1.3"],[4,6,"Dummy Category 4"],[4,7,"0"]],"st":{"A1":3,"B1":3,"C1":4,"D1":4,"E1":4,"F1":5,"G1":5,"H1":5,"A2":15,"B2":15,"C2":16,"D2":16,"E2":16,"F2":17,"G2":17,"H2":17,"A3":15,"B3":15,"C3":16,"D3":16,"E3":16,"F3":17,"G3":17,"H3":17,"A4":15,"B4":15,"C4":16,"D4":16,"E4":16,"F4":17,"G4":17,"H4":17,"A5":15,"B5":15,"C5":16,"D5":16,"E5":16,"F5":17,"G5":17,"H5":17},"dim":[5,8]}},"st":{"0":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"1":{"f":{"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"left","v":"bottom"},"nf":"General"},"2":{"f":{"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"general","v":"bottom"},"nf":"General"},"3":{"f":{"b":1,"sz":10,"n":"Arial"},"fill":{"fg":"FF9A9A","bg":"FF8080"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"4":{"f":{"b":1,"sz":10,"n":"Arial"},"fill":{"fg":"FEFFE1","bg":"FFFFFF"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"5":{"f":{"b":1,"sz":10,"n":"Arial"},"fill":{"fg":"81D41A","bg":"969696"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"6":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"left","v":"bottom"},"nf":"General"},"7":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"general","v":"bottom"},"nf":"General"},"8":{"f":{"b":1,"sz":10,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"9":{"f":{"b":1,"i":1,"sz":10,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"10":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"11":{"f":{"b":1,"sz":12,"n":"Arial"},"fill":{"fg":"E4E3EA","bg":"FEFFE1"},"b":{"t":["thin","000000"],"b":["thin","000000"]},"a":{"h":"left","v":"bottom"},"nf":"General"},"12":{"f":{"i":1,"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"general","v":"bottom"},"nf":"General"},"13":{"f":{"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"left","v":"bottom"},"nf":"\"TRUE\";\"TRUE\";\"FALSE\""},"14":{"f":{"u":1,"sz":10,"n":"Arial"},"fill":{"p":"none"},"a":{"h":"general","v":"bottom"},"nf":"General"},"15":{"f":{"sz":10,"n":"Arial"},"fill":{"fg":"FF9A9A","bg":"FF8080"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"16":{"f":{"sz":10,"n":"Arial"},"fill":{"fg":"FEFFE1","bg":"FFFFFF"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"},"17":{"f":{"sz":10,"n":"Arial"},"fill":{"fg":"81D41A","bg":"969696"},"b":{"t":["thin","000000"],"b":["thin","000000"],"l":["thin","000000"],"r":["thin","000000"]},"a":{"h":"general","v":"bottom"},"nf":"General"}},"sc":18};
// @formatter:on

// The following constants define the columns in the Excel template for mapping node and edge properties
// allowed types: "str", "num", "bool", "rgba", "oneOf:a|b|c"
// @formatter:off
const EXCEL_NODE_PROPERTIES = [
  {
    column: "ID",
    type: "str",
    required: true,
    get: (n) => {
      return n.id;
    },
  },
  {
    column: "Label",
    type: "str",
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
    column: "Description",
    type: "str",
    apply: (n, v) => {
      n.description = v;
    },
    get: (n) => {
      return n.description;
    },
  },
  {
    column: "Shape",
    type: "oneOf:circle|diamond|hexagon|rect|triangle|star",
    apply: (n, v) => {
      n.type = v;
    },
    get: (n) => {
      return n.type;
    },
  },
  {
    column: "Size",
    type: "num",
    apply: (n, v) => {
      n.style.size = v;
    },
    get: (n) => {
      return n.style.size;
    },
  },
  {
    column: "Fill Color",
    type: "rgba",
    apply: (n, v) => {
      n.style.fill = v;
    },
    get: (n) => {
      return n.style.fill;
    },
  },
  {
    column: "Border Size",
    type: "num",
    apply: (n, v) => {
      n.style.lineWidth = v;
    },
    get: (n) => {
      return n.style.lineWidth;
    },
  },
  {
    column: "Border Color",
    type: "rgba",
    apply: (n, v) => {
      n.style.stroke = v;
    },
    get: (n) => {
      return n.style.stroke;
    },
  },
  {
    column: "Label Font Size",
    type: "num",
    apply: (n, v) => {
      n.style.labelFontSize = v;
    },
    get: (n) => {
      return n.style.labelFontSize;
    },
  },
  {
    column: "Label Placement",
    type:
      "oneOf:left|right|top|bottom|left-top|left-bottom|right-top|right-bottom|top-left|top-right|bottom-left|" +
      "bottom-right|center",
    apply: (n, v) => {
      n.style.labelPlacement = v;
    },
    get: (n) => {
      return n.style.labelPlacement;
    },
  },
  {
    column: "Label Color",
    type: "rgba",
    apply: (n, v) => {
      n.style.labelFill = v;
    },
    get: (n) => {
      return n.style.labelFill;
    },
  },
  {
    column: "Label Background Color",
    type: "rgba",
    apply: (n, v) => {
      n.style.labelBackground = true;
      n.style.labelBackgroundFill = v;
    },
    get: (n) => {
      return n.style.labelBackground ? n.style.labelBackgroundFill : undefined;
    },
  },
  {
    column: "X Coordinate",
    type: "num",
    apply: (n, v) => {
      n.style.x = v;
    },
    get: (n) => {
      return n.style.x;
    },
  },
  {
    column: "Y Coordinate",
    type: "num",
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
    column: "Source ID",
    type: "str",
    required: true,
    get: (e) => {
      return e.source;
    },
  },
  {
    column: "Target ID",
    type: "str",
    required: true,
    get: (e) => {
      return e.target;
    },
  },
  {
    column: "Label",
    type: "str",
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
    column: "Description",
    type: "str",
    apply: (e, v) => {
      e.description = v;
    },
    get: (e) => {
      return e.description;
    },
  },
  {
    column: "Type",
    type: "oneOf:line|cubic|quadratic|polyline",
    apply: (e, v) => {
      e.type = v;
    },
    get: (e) => {
      return e.type;
    },
  },
  {
    column: "Line Width",
    type: "num",
    apply: (e, v) => {
      e.style.lineWidth = v;
    },
    get: (e) => {
      return e.style.lineWidth;
    },
  },
  {
    column: "Line Dash",
    type: "num",
    apply: (e, v) => {
      e.style.lineDash = v;
    },
    get: (e) => {
      return e.style.lineDash;
    },
  },
  {
    column: "Color",
    type: "rgba",
    apply: (e, v) => {
      e.style.stroke = v;
    },
    get: (e) => {
      return e.style.stroke;
    },
  },
  {
    column: "Label Font Size",
    type: "num",
    apply: (e, v) => {
      e.style.labelFontSize = v;
    },
    get: (e) => {
      return e.style.labelFontSize;
    },
  },
  {
    column: "Label Placement",
    type: "oneOf:start|center|end",
    apply: (e, v) => {
      e.style.labelPlacement = v;
    },
    get: (e) => {
      return e.style.labelPlacement;
    },
  },
  {
    column: "Label Auto Rotate",
    type: "bool",
    apply: (e, v) => {
      e.style.labelAutoRotate = v;
    },
    get: (e) => {
      return e.style.labelAutoRotate;
    },
  },
  {
    column: "Label Offset X",
    type: "num",
    apply: (e, v) => {
      e.style.labelOffsetX = v;
    },
    get: (e) => {
      return e.style.labelOffsetX;
    },
  },
  {
    column: "Label Offset Y",
    type: "num",
    apply: (e, v) => {
      e.style.labelOffsetY = v;
    },
    get: (e) => {
      return e.style.labelOffsetY;
    },
  },
  {
    column: "Label Color",
    type: "rgba",
    apply: (e, v) => {
      e.style.labelFill = v;
    },
    get: (e) => {
      return e.style.labelFill;
    },
  },
  {
    column: "Label Background Color",
    type: "rgba",
    apply: (e, v) => {
      e.style.labelBackground = true;
      e.style.labelBackgroundFill = v;
    },
    get: (e) => {
      return e.style.labelBackground ? e.style.labelBackgroundFill : undefined;
    },
  },
  {
    column: "Start Arrow",
    type: "bool",
    apply: (e, v) => {
      e.style.startArrow = v;
    },
    get: (e) => {
      return e.style.startArrow;
    },
  },
  {
    column: "Start Arrow Size",
    type: "num",
    apply: (e, v) => {
      e.style.startArrowSize = v;
    },
    get: (e) => {
      return e.style.startArrowSize;
    },
  },
  {
    column: "Start Arrow Type",
    // New marker vocabulary + legacy G6 names (alias-mapped at render time
    // by graph_model.edgeMarkerCode) so old workbooks keep importing.
    type: "oneOf:arrow|rect|diamond|circle|tee|triangle|vee|triangleRect|simple|square",
    apply: (e, v) => {
      e.style.startArrowType = v;
    },
    get: (e) => {
      return e.style.startArrowType;
    },
  },
  {
    column: "End Arrow",
    type: "bool",
    apply: (e, v) => {
      e.style.endArrow = v;
    },
    get: (e) => {
      return e.style.endArrow;
    },
  },
  {
    column: "End Arrow Size",
    type: "num",
    apply: (e, v) => {
      e.style.endArrowSize = v;
    },
    get: (e) => {
      return e.style.endArrowSize;
    },
  },
  {
    column: "End Arrow Type",
    type: "oneOf:arrow|rect|diamond|circle|tee|triangle|vee|triangleRect|simple|square",
    apply: (e, v) => {
      e.style.endArrowType = v;
    },
    get: (e) => {
      return e.style.endArrowType;
    },
  },
  {
    column: "Halo Color",
    type: "rgba",
    apply: (e, v) => {
      e.style.halo = true;
      e.style.haloStroke = v;
    },
    get: (e) => {
      return e.style.halo ? e.style.haloStroke : undefined;
    },
  },
  {
    column: "Halo Width",
    type: "num",
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
              name: style.f.n || "Calibri",
              color: style.f.c && { argb: "FF" + style.f.c },
            };
          }

          if (style.fill) {
            cell.fill = {
              type: "pattern",
              pattern: style.fill.p || "solid",
              fgColor: style.fill.fg && { argb: "FF" + style.fill.fg },
              bgColor: style.fill.bg && { argb: "FF" + style.fill.bg },
            };
          }

          if (style.b) {
            const border = {};
            const sides = ["top", "bottom", "left", "right"];
            const keys = ["t", "b", "l", "r"];
            keys.forEach((key, idx) => {
              if (style.b[key]) {
                border[sides[idx]] = {
                  style: style.b[key][0],
                  color: { argb: "FF" + style.b[key][1] },
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
  }

  parseJSON(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const jsonContent = JSON.parse(reader.result);
          if (!jsonContent.edges || !jsonContent.nodes) {
            this.cache.ui.error("File does not contain edges or nodes.");
            resolve(null);
          } else {
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
          if (key.endsWith("ManualMembers") && Array.isArray(layout[key])) {
            layout[key] = new Set(layout[key]);
          }
          if (key.endsWith("Props") && Array.isArray(layout[key])) {
            layout[key] = new Set(layout[key]);
          }
        }

        // Restore filters Map and nested Sets
        if (layout.filters && typeof layout.filters === "object") {
          const filtersMap = new Map(Object.entries(layout.filters));

          // Restore Sets within each filter value
          for (const [propId, filterValue] of filtersMap.entries()) {
            if (
              filterValue.categories &&
              Array.isArray(filterValue.categories)
            ) {
              filterValue.categories = new Set(filterValue.categories);
            }
            // Restore bubble group member Sets
            for (const key in filterValue) {
              if (key.endsWith("Members") && Array.isArray(filterValue[key])) {
                filterValue[key] = new Set(filterValue[key]);
              }
              if (key.endsWith("IDs") && Array.isArray(filterValue[key])) {
                filterValue[key] = new Set(filterValue[key]);
              }
              if (
                key.endsWith("MembersHidden") &&
                Array.isArray(filterValue[key])
              ) {
                filterValue[key] = new Set(filterValue[key]);
              }
              if (
                key.endsWith("IDsHidden") &&
                Array.isArray(filterValue[key])
              ) {
                filterValue[key] = new Set(filterValue[key]);
              }
            }
          }

          layout.filters = filtersMap;
        }

        // Restore positions Map
        if (layout.positions && typeof layout.positions === "object") {
          layout.positions = new Map(Object.entries(layout.positions));
        }

        // Restore style Maps
        if (layout.nodeStyles && typeof layout.nodeStyles === "object") {
          layout.nodeStyles = new Map(Object.entries(layout.nodeStyles));
        }
        if (layout.edgeStyles && typeof layout.edgeStyles === "object") {
          layout.edgeStyles = new Map(Object.entries(layout.edgeStyles));
        }
      }
    }

    // Restore Sets in filterDefaults
    if (
      jsonContent.filterDefaults &&
      typeof jsonContent.filterDefaults === "object"
    ) {
      const filterDefaultsMap = new Map(
        Object.entries(jsonContent.filterDefaults),
      );

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
   * @returns {Object} - Parsed JSON structure compatible with the existing system.
   */
  async parseExcelToJson(file) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file);

    const nodesSheet = workbook.getWorksheet("nodes");
    const edgesSheet = workbook.getWorksheet("edges");

    if (!nodesSheet || !edgesSheet) {
      this.cache.ui.error(
        'The Excel file must contain a "nodes" and "edges" sheet.',
      );
      return;
    }

    const getOrNull = (row, key) => {
      const lowerCaseKey = key.toString().toLowerCase().trim();
      const value =
        row[Object.keys(row).find((key) => key.toLowerCase() === lowerCaseKey)];
      // Explicitly check for null/undefined to preserve 0 values
      if (
        value !== null &&
        value !== undefined &&
        value.toString().trim() !== ""
      ) {
        return value;
      }
      return null;
    };

    const validateColumns = (requiredColumns, firstRowKeys, sheetName) => {
      for (const column of requiredColumns) {
        if (!firstRowKeys.includes(column)) {
          const origColumn = firstRowKeys.filter(
            (k) => k.toLowerCase().trim() === column,
          )[0];
          this.cache.ui.error(
            `The "${sheetName}" sheet must contain an "${origColumn}" column.`,
          );
          return;
        }
      }
    };

    const sanitizeColumns = (sheetJson, sheetDescriptor) => {
      if (!sheetJson || sheetJson.length === 0) return;

      const firstRow = sheetJson[0];
      const columnMapping = {};

      Object.keys(firstRow).forEach((originalKey) => {
        if (originalKey.startsWith("__EMPTY")) return;

        if (originalKey.includes("(") || originalKey.includes(")")) {
          columnMapping[originalKey] = originalKey
            .replace(/\(/g, "[")
            .replace(/\)/g, "]");
        }
      });

      sheetJson.forEach((row) => {
        Object.entries(columnMapping).forEach(([originalKey, sanitizedKey]) => {
          if (row.hasOwnProperty(originalKey)) {
            row[sanitizedKey] = row[originalKey];
            delete row[originalKey];
          }
        });
      });

      Object.entries(columnMapping).forEach(([original, sanitized]) => {
        this.cache.ui.warning(
          `Column "${original}" in "${sheetDescriptor}" sheet was renamed to "${sanitized}" for proper group parsing.`,
        );
      });
    };

    const removeEmptyColumns = (sheetJson, sheetDescriptor) => {
      const propertyDefs =
        sheetDescriptor === "edges"
          ? EXCEL_EDGE_PROPERTIES
          : EXCEL_NODE_PROPERTIES;
      const requiredCols = propertyDefs
        .filter((prop) => prop.required)
        .map((prop) => prop.column);
      const optionalCols = propertyDefs
        .filter((prop) => !prop.required)
        .map((prop) => prop.column);

      const allCols = Object.keys(sheetJson[0]).filter(
        (c) => !c.startsWith("__EMPTY") && c !== "__rowNum__",
      );

      const isColumnEmpty = (col) =>
        sheetJson.every((row) => {
          const v = row[col];
          return v == null || v.toString().trim() === "";
        });

      const emptyRequiredColumns = allCols.filter(
        (col) => requiredCols.includes(col) && isColumnEmpty(col),
      );

      const emptyOptionalColumns = allCols.filter(
        (col) => optionalCols.includes(col) && isColumnEmpty(col),
      );

      const emptyUserColumns = allCols.filter(
        (col) =>
          !requiredCols.includes(col) &&
          !optionalCols.includes(col) &&
          isColumnEmpty(col),
      );

      emptyRequiredColumns.forEach((col) => {
        this.cache.ui.error(
          `Required column "${col}" in "${sheetDescriptor}" sheet is empty.`,
        );
      });

      emptyOptionalColumns.forEach((col) => {
        this.cache.ui.info(
          `Optional column "${col}" in "${sheetDescriptor}" sheet is empty.`,
        );
      });

      emptyUserColumns.forEach((col) => {
        this.cache.ui.warning(
          `User defined column "${col}" in "${sheetDescriptor}" sheet is empty.`,
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

    const worksheetToJson = (worksheet) => {
      if (!worksheet) return [];

      const jsonData = [];
      const headers = [];

      const firstRow = worksheet.getRow(1);
      firstRow.eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value;
      });

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const rowData = { __rowNum__: rowNumber - 2 };

        row.eachCell((cell, colNumber) => {
          const header = headers[colNumber];
          if (header) {
            rowData[header] = cell.value;
          }
        });

        const hasData = Object.values(rowData).some(
          (val) => val !== null && val !== undefined && val !== "",
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
        subGroup = lastBracketContent
          .substring(1, lastBracketContent.length - 1)
          .trim();

        // For multiple brackets, preserve all except the last one in the key
        const lastBracketIndex = key.lastIndexOf(matches[matches.length - 1]);
        trimmedKey = key.substring(0, lastBracketIndex).trim();
      } else if (matches && matches.length === 1) {
        const bracketContent = matches[0];
        subGroup = bracketContent
          .substring(1, bracketContent.length - 1)
          .trim();
        trimmedKey = key.substring(0, key.indexOf("[")).trim();
      } else {
        trimmedKey = key.trim();
      }

      return { subGroup: subGroup, key: trimmedKey };
    };

    const nodesDataDict = worksheetToJson(nodesSheet);
    const edgesDataDict = worksheetToJson(edgesSheet);

    const nodesData = nodesDataDict.jsonData;
    const edgesData = edgesDataDict.jsonData;

    if (nodesData.length === 0) {
      this.cache.ui.error('The "nodes" sheet is empty or invalid.');
      return;
    }

    if (edgesData.length === 0) {
      this.cache.ui.error('The "edges" sheet is empty or invalid.');
      return;
    }

    sanitizeColumns(nodesData, "nodes");
    sanitizeColumns(edgesData, "edges");

    removeEmptyColumns(nodesData, "nodes");
    removeEmptyColumns(edgesData, "edges");

    const firstNodeRowKeys = nodesDataDict.headers.map((k) =>
      k.toLowerCase().trim(),
    );
    const requiredNodeColumns = EXCEL_NODE_PROPERTIES.filter(
      (node) => node.required,
    ).map((node) => node.column.toLowerCase().trim());
    validateColumns(requiredNodeColumns, firstNodeRowKeys, "nodes");

    const firstEdgeRowKeys = edgesDataDict.headers.map((k) =>
      k.toLowerCase().trim(),
    );
    const requiredEdgeColumns = EXCEL_EDGE_PROPERTIES.filter(
      (edge) => edge.required,
    ).map((edge) => edge.column.toLowerCase().trim());
    validateColumns(requiredEdgeColumns, firstEdgeRowKeys, "edges");

    const nonDataNodeColumns = new Set(
      EXCEL_NODE_PROPERTIES.map((p) => p.column.toLowerCase().trim()),
    );
    const nodeDataHeaders = nodesDataDict.headers
      .filter(
        (k) =>
          !nonDataNodeColumns.has(k.toLowerCase().trim()) &&
          !k.startsWith("__EMPTY") &&
          k !== "__rowNum__",
      )
      .map((k) => decodeKey(k));

    const nonDataEdgeColumns = new Set(
      EXCEL_EDGE_PROPERTIES.map((p) => p.column.toLowerCase().trim()),
    );
    const edgeDataHeaders = edgesDataDict.headers
      .filter(
        (k) =>
          !nonDataEdgeColumns.has(k.toLowerCase().trim()) &&
          !k.startsWith("__EMPTY") &&
          k !== "__rowNum__",
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
          if (type.startsWith("oneOf:")) {
            listValues = type.split(":")[1].split("|");
            type = "list";
          }
          switch (type) {
            case "str":
              validated = true;
              break;
            case "num":
              validated = StaticUtilities.isNumber(maybeValue);
              break;
            case "bool":
              validated = StaticUtilities.isBoolean(maybeValue);
              break;
            case "rgba":
              validated = StaticUtilities.isHexColor(maybeValue);
              break;
            case "list":
              validated = StaticUtilities.isInList(maybeValue, listValues);
              break;
            default:
              break;
          }
          if (!validated) {
            this.cache.ui.error(
              `${descriptor} property '${column}' in row ${rowNum} has an invalid value '${maybeValue}' and will be ignored (value must be of type '${type}').`,
            );
          } else {
            let coerced = maybeValue;
            if (type === "num") coerced = parseFloat(maybeValue);
            else if (type === "bool")
              coerced =
                typeof maybeValue === "string"
                  ? maybeValue.trim().toLowerCase() === "true"
                  : !!maybeValue;
            apply(nodeOrEdge, coerced);
          }
        }
      });
    };

    const validateUserData = (row, key) => {
      const val = row[key];

      // Explicitly check for null/undefined to preserve 0 values
      if (val === null || val === undefined || val.toString().trim() === "") {
        return null;
      }

      return { value: val, ...decodeKey(key) };
    };

    const addNodeOrEdgeUserData = (
      nodeOrEdge,
      row,
      propertyMap,
      header,
      descriptor,
    ) => {
      nodeOrEdge.D4Data = {
        [header]: {},
      };

      let propsAdded = 0;
      const reservedProperties = propertyMap.map((p) =>
        p.column.toLowerCase().trim(),
      );

      for (let key in row) {
        if (
          key === "__rowNum__" ||
          reservedProperties.includes(key.toLowerCase())
        )
          continue;

        const userData = validateUserData(row, key);

        if (!userData) continue;

        if (!nodeOrEdge.D4Data[header].hasOwnProperty(userData.subGroup)) {
          nodeOrEdge.D4Data[header][userData.subGroup] = {};
        }

        nodeOrEdge.D4Data[header][userData.subGroup][userData.key] =
          userData.value;
        propsAdded++;
      }

      return propsAdded;
    };

    const nodeIDs = new Set();

    const parsedNodes = nodesData
      .map((row) => {
        const node = {};
        const nodeRowNum = row.__rowNum__ + 1;
        const descriptor = "Node";

        const nodeID = getOrNull(row, "ID");
        if (!nodeID) {
          this.cache.ui.warning(
            `Node in row ${nodeRowNum} does not contain an ID and will be skipped.`,
          );
          return null;
        }

        if (nodeIDs.has(nodeID)) {
          this.cache.ui.warning(
            `Node in row ${nodeRowNum} (ID ${nodeID}) already exists and will be skipped.`,
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
          descriptor,
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
          ids.map((id) => `  - ${id}`).join("\n"),
      );
    }
    parsedNodes.forEach((n) => delete n._propsAdded);

    const parsedEdges = edgesData
      .map((row) => {
        const edge = {};
        const edgeRowNum = row.__rowNum__ + 1;
        const descriptor = "Edge";

        const sourceID = getOrNull(row, "Source ID");
        if (!sourceID) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} does not contain a Source ID and will be skipped.`,
          );
          return null;
        }

        if (!nodeIDs.has(sourceID)) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} has an invalid/missing Source ID (${sourceID}) and will be skipped.`,
          );
          return null;
        }

        const targetID = getOrNull(row, "Target ID");
        if (!targetID) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} does not contain a Target ID and will be skipped.`,
          );
          return null;
        }

        if (!nodeIDs.has(targetID)) {
          this.cache.ui.warning(
            `Edge in row ${edgeRowNum} has an invalid/missing Target ID (${targetID}) and will be skipped.`,
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
          descriptor,
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
          ids.map((id) => `  - ${id}`).join("\n"),
      );
    }
    parsedEdges.forEach((e) => delete e._propsAdded);

    return {
      nodes: parsedNodes,
      edges: parsedEdges,
      nodeDataHeaders: nodeDataHeaders,
      edgeDataHeaders: edgeDataHeaders,
    };
  }

  async downloadExcelTemplate() {
    const template = new ExcelTemplate(excelData);
    const workbook = template.createWorkbook(ExcelJS);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "simple-template.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  preProcessData(fileData) {
    this.cache.reset();

    this.cache.CFG.HIDE_LABELS =
      fileData.nodes.length > this.cache.CFG.MAX_NODES_BEFORE_HIDING_LABELS;
    this.cache.CFG.DISABLE_HOVER_EFFECT =
      fileData.nodes.length >
      this.cache.CFG.MAX_NODES_BEFORE_DISABLING_HOVER_EFFECT ||
      fileData.edges.length >
      this.cache.CFG.MAX_EDGES_BEFORE_DISABLING_HOVER_EFFECT;
    this.cache.CFG.AVOID_MEMBERS_IN_BUBBLE_GROUPS =
      fileData.nodes.length >
      this.cache.CFG.MAX_NODES_BEFORE_DISABLING_AVOID_MEMBERS_IN_BUBBLE_GROUPS;

    this.cache.nodePositionsFromExcelImport = new Map();

    this.populateCacheHeaders(fileData);

    this.cache.data.nodes = fileData.nodes.map((node) => {
      const nodeFeatures = new Set();
      const nodeFeatureValues = new Map();
      const nodeFeatureWithinThreshold = new Map();

      for (let [
        section,
        subsection,
        prop,
        data,
      ] of this.cache.gcm.traverseD4Data(node)) {
        let propId = StaticUtilities.generatePropHashId(
          section,
          subsection,
          prop,
        );
        nodeFeatures.add(propId);

        if (isNaN(data)) {
          // Split categorical values by pipe separator
          const values = String(data).includes("|")
            ? String(data)
                .split("|")
                .map((v) => v.trim())
                .filter((v) => v !== "")
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

      for (let [
        section,
        subsection,
        prop,
        data,
      ] of this.cache.gcm.traverseD4Data(edge)) {
        let propId = StaticUtilities.generatePropHashId(
          section,
          subsection,
          prop,
        );
        edgeFeatures.add(propId);
        if (isNaN(data)) {
          // Split categorical values by pipe separator
          const values = String(data).includes("|")
            ? String(data)
                .split("|")
                .map((v) => v.trim())
                .filter((v) => v !== "")
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

    const excelHasCoordinates =
      this.cache.nodePositionsFromExcelImport.size > 0;
    this.cache.data.selectedLayout =
      fileData.selectedLayout ||
      (excelHasCoordinates
        ? this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME
        : "Default");

    // create individual map for each layout, no matter if default or manual, with positions, current filters, ..
    if (fileData.layouts) {
      this.cache.data.layouts = this.cache.io.parseLayouts(fileData.layouts);
      if (fileData.selectedLayout === this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME) {
        this.cache.EVENT_LOCKS.TRIGGER_SET_LAYOUT_ONCE = true;
      }
    } else {
      // Create only a single "Default" layout using force layout
      this.cache.data.layouts = {
        Default: this.cache.lm.createDefaultLayout(
          this.cache.DEFAULTS.LAYOUT,
          false,
        ),
      };

      if (excelHasCoordinates) {
        this.cache.data.layouts[this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME] =
          this.cache.lm.createDefaultLayout(
            this.cache.DEFAULTS.CUSTOM_LAYOUT_NAME,
            true,
          );
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
      for (const [
        propId,
        defaultFilter,
      ] of this.cache.data.filterDefaults.entries()) {
        if (oldFilters.has(propId)) {
          // Preserve existing filter values (user's slider positions, etc.)
          layout.filters.set(propId, oldFilters.get(propId));
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
    this.cache.ui.debug("Done pre-processing data");
  }

  getDefaultFilterObject() {
    let obj = {
      active: true,
      lowerThreshold: Infinity,
      upperThreshold: -Infinity,
      isInverted: false,
      isCategory: false,
      hasFloatValues: false,
      categories: new Set(),
    };
    for (let group of this.cache.bs.traverseBubbleSets()) {
      obj[`${group}Members`] = new Set();
      obj[`${group}MembersHidden`] = new Set();
      obj[`${group}IDs`] = new Set();
      obj[`${group}IDsHidden`] = new Set();
    }
    return obj;
  }

  populateFilterPropsLowsAndHighs(propHash, nodeOrEdgeValue) {
    if (!this.cache.data.filterDefaults.get(propHash)) {
      this.cache.data.filterDefaults.set(
        propHash,
        this.getDefaultFilterObject(),
      );
    }

    if (nodeOrEdgeValue === "") {
      return;
    }

    if (isNaN(nodeOrEdgeValue)) {
      if (
        this.cache.data.filterDefaults.get(propHash).lowerThreshold !== Infinity
      ) {
        let [section, subSection, prop] =
          StaticUtilities.decodePropHashId(propHash);
        this.cache.ui
          .warning(`Property ${prop} (section ${section} sub-section ${subSection} contains both numeric and 
        categorical values. To proceed, please use a single data type. Property has been excluded.`);
        this.cache.data.filterDefaults.delete(propHash);
        return;
      }
      this.cache.data.filterDefaults.get(propHash).isCategory = true;
      this.cache.data.filterDefaults
        .get(propHash)
        .categories.add(nodeOrEdgeValue);
      return;
    }

    if (
      !this.cache.data.filterDefaults.get(propHash).hasFloatValues &&
      !StaticUtilities.isInteger(nodeOrEdgeValue)
    ) {
      this.cache.data.filterDefaults.get(propHash).hasFloatValues = true;
    }
    this.cache.data.filterDefaults.get(propHash).lowerThreshold = Math.min(
      nodeOrEdgeValue,
      this.cache.data.filterDefaults.get(propHash).lowerThreshold,
    );
    this.cache.data.filterDefaults.get(propHash).upperThreshold = Math.max(
      nodeOrEdgeValue,
      this.cache.data.filterDefaults.get(propHash).upperThreshold,
    );
  }

  populateCacheHeaders(fileData) {
    if (fileData.nodeDataHeaders) {
      for (const nodeHeader of fileData.nodeDataHeaders) {
        const nodePropHash = StaticUtilities.generatePropHashId(
          this.cache.CFG.EXCEL_NODE_HEADER,
          nodeHeader.subGroup,
          nodeHeader.key,
        );
        this.cache.data.filterDefaults.set(
          nodePropHash,
          this.getDefaultFilterObject(),
        );
      }
    }
    if (fileData.edgeDataHeaders) {
      for (const edgeHeader of fileData.edgeDataHeaders) {
        const edgePropHash = StaticUtilities.generatePropHashId(
          this.cache.CFG.EXCEL_EDGE_HEADER,
          edgeHeader.subGroup,
          edgeHeader.key,
        );
        this.cache.data.filterDefaults.set(
          edgePropHash,
          this.getDefaultFilterObject(),
        );
      }
    }
  }

  buildExportFilename(ext, suffix = '') {
    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + '-'
      + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');

    const label = document.getElementById('dataSourceLabel')?.textContent || '';
    let basename = label
      .replace(/\.[a-z0-9]+$/i, '')                // strip file extension
      .replace(/^(\d{8}-\d{6}_GLL_)+/, '')          // strip stacked GLL prefixes
      .replace(/[<>:"/\\|?*,]+/g, '_')              // replace unsafe chars
      .replace(/\s+/g, '_')                         // spaces to underscores
      .replace(/_+/g, '_')                          // collapse multiple underscores
      .replace(/^_|_$/g, '');                        // trim leading/trailing underscores

    if (!basename) basename = 'export';
    if (suffix) basename += `_${suffix}`;

    return `${ts}_GLL_${basename}.${ext}`;
  }

  async exportGraphAsJSON() {
    if (this.cache.data === null) {
      this.cache.ui.error("No graph data to save.");
      return false;
    }

    // helper for JSON.stringify to serialize Maps to plain objects and Sets to arrays
    function replacer(key, value) {
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return [...value];
      return value;
    }

    await this.cache.ui.showLoading("Exporting graph ..");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    // Clear and rebuild headers from filterDefaults to avoid duplicates
    this.cache.data.nodeDataHeaders = [];
    this.cache.data.edgeDataHeaders = [];

    for (const filterDefaultKey of this.cache.data.filterDefaults.keys()) {
      const [nodeOrEdge, subGroup, key] =
        StaticUtilities.decodePropHashId(filterDefaultKey);
      const targetList =
        nodeOrEdge === this.cache.CFG.EXCEL_NODE_HEADER
          ? this.cache.data.nodeDataHeaders
          : this.cache.data.edgeDataHeaders;
      const elem = { subGroup: subGroup, key: key };

      // Check if header already exists by comparing actual values
      const exists = targetList.some(
        (h) => h.subGroup === elem.subGroup && h.key === elem.key,
      );
      if (!exists) {
        // Insert next to existing group members to keep groups contiguous
        const lastGroupIdx = targetList.findLastIndex(h => h.subGroup === subGroup);
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
        const visibility = graphNode?.style?.visibility || "visible";

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
        const visibility = graphEdge?.style?.visibility || "visible";

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

    const blob = new Blob([JSON.stringify(this.cache.data, replacer)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = this.buildExportFilename("json");
    a.click();
    URL.revokeObjectURL(url);
    await this.cache.ui.hideLoading();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  parseGroups(filterValue) {
    const groupData = {
      categories: new Set(filterValue?.categories || []),
    };
    for (let group of this.cache.bs.traverseBubbleSets()) {
      groupData[`${group}Members`] = new Set(
        filterValue[`${group}Members`] || [],
      );
      groupData[`${group}IDs`] = new Set(filterValue[`${group}IDs`] || []);
      groupData[`${group}MembersHidden`] = new Set(
        filterValue[`${group}MembersHidden`] || [],
      );
      groupData[`${group}IDsHidden`] = new Set(
        filterValue[`${group}IDsHidden`] || [],
      );
    }
    return groupData;
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
          layout.layoutType ||
          (positions.size === 0 ? this.cache.DEFAULTS.LAYOUT : undefined),
        internals: layout.internals || null,
        // Check if already a Map (from restoreSetsFromJSON), otherwise convert
        positions,
        filters: this.parseFiltersAsMap(layout.filters),
        isCustom: layout.isCustom || false,
        query: layout["query"] || undefined,
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
          const saved = layout.bubbleSetStyle;
          if (!saved) return structuredClone(defaults);
          const merged = {};
          for (const group of Object.keys(defaults)) {
            merged[group] = { ...defaults[group], ...(saved[group] || {}) };
          }
          return merged;
        })(),
      };

      for (let group of this.cache.bs.traverseBubbleSets()) {
        parsedLayouts[key][`${group}Props`] = new Set(
          layout[`${group}Props`] || [],
        );
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
        { ...value, ...this.parseGroups(value) },
      ]),
    );
  }

  loadFile(event) {
    const file = event.target.files[0];
    if (!file) {
      this.cache.ui.error("No file selected.");
      return Promise.resolve(null);
    }

    const fileType = file.name.split(".").pop().toLowerCase();

    try {
      switch (fileType) {
        case "json":
          return this.parseJSON(file);

        case "xls":
        case "xlsx":
        case "ods":
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
    event.target.value = "";
  }

  async loadFileWrapper(event) {
    let file = event.target.files[0];
    if (!file) return;

    this.cache.ui.setDataSourceLabel(file.name);

    await this.cache.ui.showLoading(
      "Loading",
      `Loading ${file.name} (${file.type} with ${StaticUtilities.humanFileSize(file.size)})`,
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
          this.cache.ui.error("File data is empty.");
          await this.cache.ui.hideLoading();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return;
        }

        this.cache.io.preProcessData(fileData);
        this.cache.ui.updateHoverToggleButton();
        this.cache.buildDataTable(fileData);
        this.cache.ui.buildUI();

        // Check if there's a saved query and set lock state
        const savedQuery =
          this.cache.data.layouts[this.cache.data.selectedLayout]["query"];
        if (savedQuery) {
          this.cache.EVENT_LOCKS.FILTERS_LOCKED_BY_MANUAL_QUERY = true;
          this.cache.qm.updateQueryTextArea();
          this.cache.qm.updateUIFromQueryInstructions();
        }

        await this.cache.gcm.createGraphInstance();

        if (!this.cache.graph) {
          this.cache.ui.error("Graph not initialized, aborting.");
          await this.cache.ui.hideLoading();
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return;
        }
        await this.cache.graph.render();
        await this.cache.gcm.fitViewToVisibleNodes();
        this.cache.ui.debug("Initial graph rendered.");

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

  async exportPNG() {

    try {
      await this.cache.ui.showLoading("Loading", "Generating picture data");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const imageData = await this.cache.graph.toDataURL({
        type: "image/png",
        mode: "viewport",
      });

      const link = document.createElement("a");
      link.href = imageData;
      link.download = this.buildExportFilename("png");
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
};
