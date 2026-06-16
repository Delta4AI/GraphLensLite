import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULTS, CFG } from "../src/config.js";
import {
  EXCEL_NODE_PROPERTIES,
  EXCEL_EDGE_PROPERTIES,
} from "../src/managers/io.js";
import { StaticUtilities } from "../src/utilities/static.js";

// --------------------------------------------------------------------------
// Helpers that mirror the production code paths
// --------------------------------------------------------------------------

// Mirrors GraphStyleManager.getNodeStyleOrDefaults (src/graph/style.js)
function getNodeStyleOrDefaults(node) {
  const src = node.style ?? {};
  const d = DEFAULTS.NODE;

  const defaultNode = {
    type: node.type ?? d.TYPE,
    style: {
      size: src.size ?? d.SIZE,
      fill: src.fill ?? d.FILL_COLOR,
      stroke: src.stroke ?? d.STROKE_COLOR,
      lineWidth: src.lineWidth ?? d.LINE_WIDTH,
      badge: src.badge ?? false,
      badges: src.badges ?? [],
      badgePalette: src.badgePalette ?? [],
      badgeFontSize: src.badgeFontSize ?? d.BADGE.FONT_SIZE,
      badgeScaleWithNode: src.badgeScaleWithNode ?? d.BADGE.SCALE_WITH_NODE,
    },
  };

  if (!CFG.HIDE_LABELS || src.label) {
    const l = DEFAULTS.NODE.LABEL;
    Object.assign(defaultNode.style, {
      label: true,
      labelText: src.labelText,
      labelBackgroundFill: src.labelBackgroundFill ?? l.BACKGROUND_COLOR,
      labelBackground: src.labelBackground ?? l.BACKGROUND,
      labelBackgroundRadius: src.labelBackgroundRadius ?? l.BACKGROUND_RADIUS,
      labelCursor: src.labelCursor ?? l.CURSOR,
      labelFill: src.labelFill ?? l.FOREGROUND_COLOR,
      labelFontSize: src.labelFontSize ?? l.FONT_SIZE,
      labelLeading: src.labelLeading ?? l.LINE_SPACING,
      labelMaxLines: src.labelMaxLines ?? l.MAX_LINES,
      labelMaxWidth: src.labelMaxWidth ?? l.MAX_WIDTH,
      labelOffsetX: src.labelOffsetX ?? l.OFFSET_X,
      labelOffsetY: src.labelOffsetY ?? l.OFFSET_Y,
      labelPadding: src.labelPadding ?? l.PADDING,
      labelPlacement: src.labelPlacement ?? l.PLACEMENT,
      labelTextAlign: src.labelTextAlign ?? l.TEXT_ALIGN,
      labelWordWrap: src.labelWordWrap ?? l.WORD_WRAP,
      labelZIndex: src.labelZIndex ?? l.Z_INDEX,
    });
  }

  return defaultNode;
}

// Mirrors GraphStyleManager.getEdgeStyleOrDefaults (src/graph/style.js)
function getEdgeStyleOrDefaults(edge) {
  const src = edge.style ?? {};
  const d = DEFAULTS.EDGE;

  const defaultEdge = {
    type: edge.type ?? d.TYPE,
    style: {
      startArrow: src.startArrow ?? d.ARROWS.START,
      startArrowSize: src.startArrowSize ?? d.ARROWS.START_SIZE,
      startArrowType: src.startArrowType ?? d.ARROWS.START_TYPE,
      endArrow: src.endArrow ?? d.ARROWS.END,
      endArrowSize: src.endArrowSize ?? d.ARROWS.END_SIZE,
      endArrowType: src.endArrowType ?? d.ARROWS.END_TYPE,
      lineWidth: src.lineWidth ?? d.LINE_WIDTH,
      lineDash: src.lineDash ?? d.LINE_DASH,
      stroke: src.stroke ?? d.COLOR,
      halo: src.halo ?? d.HALO.ENABLED,
      haloStroke: src.haloStroke ?? d.HALO.COLOR,
      haloLineWidth: src.haloLineWidth ?? d.HALO.WIDTH,
    },
  };

  if (!CFG.HIDE_LABELS || src.label) {
    const l = DEFAULTS.EDGE.LABEL;
    Object.assign(defaultEdge.style, {
      label: true,
      labelAutoRotate: src.labelAutoRotate ?? l.AUTO_ROTATE,
      labelBackground: src.labelBackground ?? l.BACKGROUND,
      labelBackgroundFill: src.labelBackgroundFill ?? l.BACKGROUND_COLOR,
      labelBackgroundCursor: src.labelBackgroundCursor ?? l.BACKGROUND_CURSOR,
      labelBackgroundFillOpacity:
        src.labelBackgroundFillOpacity ?? l.BACKGROUND_FILL_OPACITY,
      labelBackgroundRadius: src.labelBackgroundRadius ?? l.BACKGROUND_RADIUS,
      labelBackgroundStrokeOpacity:
        src.labelBackgroundStrokeOpacity ?? l.BACKGROUND_STROKE_OPACITY,
      labelCursor: src.labelCursor ?? l.CURSOR,
      labelFill: src.labelFill ?? l.FOREGROUND_COLOR,
      labelFillOpacity: src.labelFillOpacity ?? l.FILL_OPACITY,
      labelFontSize: src.labelFontSize ?? l.FONT_SIZE,
      labelFontWeight: src.labelFontWeight ?? l.FONT_WEIGHT,
      labelMaxLines: src.labelMaxLines ?? l.MAX_LINES,
      labelMaxWidth: src.labelMaxWidth ?? l.MAX_WIDTH,
      labelOffsetX: src.labelOffsetX ?? l.OFFSET_X,
      labelOffsetY: src.labelOffsetY ?? l.OFFSET_Y,
      labelOpacity: src.labelOpacity ?? l.OPACITY,
      labelPlacement: src.labelPlacement ?? l.PLACEMENT,
      labelPadding: src.labelPadding ?? l.PADDING,
      labelText: src.labelText ?? l.TEXT,
      labelTextAlign: src.labelTextAlign ?? l.TEXT_ALIGN,
      labelTextBaseLine: src.labelTextBaseLine ?? l.TEXT_BASE_LINE,
      labelTextOverflow: src.labelTextOverflow ?? l.TEXT_OVERFLOW,
      labelVisibility: src.labelVisibility ?? l.VISIBILITY,
      labelWordWrap: src.labelWordWrap ?? l.WORD_WRAP,
    });
  }

  return defaultEdge;
}

// Mirrors addNodeOrEdgeStyle in io.js — applies Excel column values to a fresh object
function applyExcelRow(obj, columnValues, propertyMap) {
  obj.style = {};
  propertyMap.forEach(({ column, required, apply }) => {
    if (required) return;
    const value = columnValues[column];
    if (value !== undefined && value !== null) {
      apply(obj, value);
    }
  });
}

// Mirrors iterNodes in gll.js — builds a nodeRef entry
function buildNodeRef(importedNode) {
  const clone = structuredClone(importedNode);
  const withDefaults = getNodeStyleOrDefaults(importedNode);
  clone.type = withDefaults.type;
  clone.style = structuredClone(withDefaults.style);
  clone.originalStyle = structuredClone(withDefaults.style);
  clone.originalType = withDefaults.type;
  return clone;
}

// Mirrors iterEdges in gll.js — builds an edgeRef entry
function buildEdgeRef(importedEdge) {
  const clone = structuredClone(importedEdge);
  const withDefaults = getEdgeStyleOrDefaults(importedEdge);
  clone.type = withDefaults.type;
  clone.style = structuredClone(withDefaults.style);
  clone.originalStyle = structuredClone(withDefaults.style);
  clone.originalType = withDefaults.type;
  return clone;
}

// Mirrors the export loop — builds a row from EXCEL_*_PROPERTIES getters
function buildNodeExportRow(nodeRef, positions) {
  const pos = positions?.get(nodeRef.id);
  const exportNode = pos
    ? {
        ...nodeRef,
        style: { ...nodeRef.style, x: pos.style.x, y: pos.style.y },
      }
    : nodeRef;
  return EXCEL_NODE_PROPERTIES.map((prop) =>
    prop.get ? prop.get(exportNode) : "",
  );
}

function buildEdgeExportRow(edgeRef) {
  return EXCEL_EDGE_PROPERTIES.map((prop) =>
    prop.get ? prop.get(edgeRef) : "",
  );
}

// Extracts a named column value from an export row
function col(row, columnName, propertyMap) {
  const idx = propertyMap.findIndex((p) => p.column === columnName);
  return row[idx];
}
function nodeCol(row, columnName) {
  return col(row, columnName, EXCEL_NODE_PROPERTIES);
}
function edgeCol(row, columnName) {
  return col(row, columnName, EXCEL_EDGE_PROPERTIES);
}

// Simulates a full import → nodeRef → export cycle for a single node
function importAndExportNode(excelColumns, positions) {
  const node = { id: excelColumns["ID"] ?? "test" };
  applyExcelRow(node, excelColumns, EXCEL_NODE_PROPERTIES);
  if (excelColumns["Label"] !== undefined) node.label = excelColumns["Label"];
  if (excelColumns["Description"] !== undefined)
    node.description = excelColumns["Description"];
  const ref = buildNodeRef(node);
  return { ref, row: buildNodeExportRow(ref, positions) };
}

// Simulates a full import → edgeRef → export cycle for a single edge
function importAndExportEdge(excelColumns) {
  const edge = {
    id: `${excelColumns["Source ID"]}::${excelColumns["Target ID"]}`,
    source: excelColumns["Source ID"],
    target: excelColumns["Target ID"],
  };
  applyExcelRow(edge, excelColumns, EXCEL_EDGE_PROPERTIES);
  if (excelColumns["Label"] !== undefined) edge.label = excelColumns["Label"];
  if (excelColumns["Description"] !== undefined)
    edge.description = excelColumns["Description"];
  const ref = buildEdgeRef(edge);
  return { ref, row: buildEdgeExportRow(ref) };
}

// --------------------------------------------------------------------------
// Validation helpers — mirror addNodeOrEdgeStyle validation in io.js
// --------------------------------------------------------------------------

function validateValue(value, typeDef) {
  if (value === null || value === undefined) return false;
  let type = typeDef;
  let listValues = null;
  if (type.startsWith("oneOf:")) {
    listValues = type.split(":")[1].split("|");
    type = "list";
  }
  switch (type) {
    case "str":
      return true;
    case "num":
      return StaticUtilities.isNumber(value);
    case "bool":
      return StaticUtilities.isBoolean(value);
    case "rgba":
      return StaticUtilities.isHexColor(value);
    case "list":
      return StaticUtilities.isInList(value, listValues);
    default:
      return false;
  }
}

// ==========================================================================
// Tests
// ==========================================================================

describe("Excel export: node properties", () => {
  it("exports all user-provided style properties", () => {
    const { row } = importAndExportNode({
      ID: "A",
      Label: "Node 1",
      Description: "The first node",
      Shape: "circle",
      Size: 60,
      "Fill Color": "#FF0000",
      "Border Size": 2,
      "Border Color": "#00FF00",
      "Label Font Size": 16,
      "Label Placement": "top",
      "Label Color": "#0000FF",
      "Label Background Color": "#AABBCC",
    });

    expect(nodeCol(row, "ID")).toBe("A");
    expect(nodeCol(row, "Label")).toBe("Node 1");
    expect(nodeCol(row, "Description")).toBe("The first node");
    expect(nodeCol(row, "Shape")).toBe("circle");
    expect(nodeCol(row, "Size")).toBe(60);
    expect(nodeCol(row, "Fill Color")).toBe("#FF0000");
    expect(nodeCol(row, "Border Size")).toBe(2);
    expect(nodeCol(row, "Border Color")).toBe("#00FF00");
    expect(nodeCol(row, "Label Font Size")).toBe(16);
    expect(nodeCol(row, "Label Placement")).toBe("top");
    expect(nodeCol(row, "Label Color")).toBe("#0000FF");
    expect(nodeCol(row, "Label Background Color")).toBe("#AABBCC");
  });

  it("exports default values for unprovided optional properties", () => {
    const { row } = importAndExportNode({ ID: "B" });

    expect(nodeCol(row, "ID")).toBe("B");
    expect(nodeCol(row, "Shape")).toBe(DEFAULTS.NODE.TYPE);
    expect(nodeCol(row, "Size")).toBe(DEFAULTS.NODE.SIZE);
    expect(nodeCol(row, "Fill Color")).toBe(DEFAULTS.NODE.FILL_COLOR);
    expect(nodeCol(row, "Border Size")).toBe(DEFAULTS.NODE.LINE_WIDTH);
    expect(nodeCol(row, "Border Color")).toBe(DEFAULTS.NODE.STROKE_COLOR);
  });

  it("uses positions from layout map, not stale nodeRef style", () => {
    const { ref, row: rowWithout } = importAndExportNode({ ID: "A" });

    // Without positions, x/y should be undefined (not in getNodeStyleOrDefaults)
    expect(nodeCol(rowWithout, "X Coordinate")).toBeUndefined();
    expect(nodeCol(rowWithout, "Y Coordinate")).toBeUndefined();

    // With positions from layout map
    const positions = new Map([["A", { style: { x: 100, y: 200 } }]]);
    const rowWith = buildNodeExportRow(ref, positions);

    expect(nodeCol(rowWith, "X Coordinate")).toBe(100);
    expect(nodeCol(rowWith, "Y Coordinate")).toBe(200);
  });

  it("does not mutate nodeRef when injecting positions", () => {
    const { ref } = importAndExportNode({ ID: "A" });
    const positions = new Map([["A", { style: { x: 42, y: 99 } }]]);

    buildNodeExportRow(ref, positions);

    expect(ref.style.x).toBeUndefined();
    expect(ref.style.y).toBeUndefined();
  });

  it("preserves Excel-imported coordinates through position map", () => {
    // Simulate: user provided X/Y in Excel, import stores them in positions map
    const node = { id: "C" };
    applyExcelRow(
      node,
      {
        ID: "C",
        "X Coordinate": 300,
        "Y Coordinate": 400,
      },
      EXCEL_NODE_PROPERTIES,
    );

    // Import path: x/y go to nodePositionsFromExcelImport, then to layout positions
    const positions = new Map([
      ["C", { style: { x: node.style.x, y: node.style.y } }],
    ]);

    const ref = buildNodeRef(node);
    const row = buildNodeExportRow(ref, positions);

    expect(nodeCol(row, "X Coordinate")).toBe(300);
    expect(nodeCol(row, "Y Coordinate")).toBe(400);
  });

  it("handles node with no positions map at all", () => {
    const { row } = importAndExportNode({ ID: "X" }, undefined);
    expect(nodeCol(row, "X Coordinate")).toBeUndefined();
    expect(nodeCol(row, "Y Coordinate")).toBeUndefined();
  });

  it("handles node ID missing from positions map", () => {
    const positions = new Map([["other", { style: { x: 1, y: 2 } }]]);
    const { ref } = importAndExportNode({ ID: "missing" });
    const row = buildNodeExportRow(ref, positions);
    expect(nodeCol(row, "X Coordinate")).toBeUndefined();
    expect(nodeCol(row, "Y Coordinate")).toBeUndefined();
  });
});

describe("Excel export: edge properties", () => {
  it("exports all user-provided style properties", () => {
    const { row } = importAndExportEdge({
      "Source ID": "A",
      "Target ID": "B",
      Label: "edge-label",
      Description: "test edge",
      Type: "cubic",
      "Line Width": 2,
      "Line Dash": 10,
      Color: "#FF000080",
      "Label Font Size": 14,
      "Label Placement": "start",
      "Label Auto Rotate": true,
      "Label Offset X": 5,
      "Label Offset Y": -3,
      "Label Color": "#112233",
      "Label Background Color": "#AABBCC",
      "Start Arrow": true,
      "Start Arrow Size": 12,
      "Start Arrow Type": "vee",
      "End Arrow": true,
      "End Arrow Size": 10,
      "End Arrow Type": "diamond",
      "Halo Color": "#FF0000",
      "Halo Width": 5,
    });

    expect(edgeCol(row, "Source ID")).toBe("A");
    expect(edgeCol(row, "Target ID")).toBe("B");
    expect(edgeCol(row, "Label")).toBe("edge-label");
    expect(edgeCol(row, "Description")).toBe("test edge");
    expect(edgeCol(row, "Type")).toBe("cubic");
    expect(edgeCol(row, "Line Width")).toBe(2);
    expect(edgeCol(row, "Line Dash")).toBe(10);
    expect(edgeCol(row, "Color")).toBe("#FF000080");
    expect(edgeCol(row, "Label Font Size")).toBe(14);
    expect(edgeCol(row, "Label Placement")).toBe("start");
    expect(edgeCol(row, "Label Auto Rotate")).toBe(true);
    expect(edgeCol(row, "Label Offset X")).toBe(5);
    expect(edgeCol(row, "Label Offset Y")).toBe(-3);
    expect(edgeCol(row, "Label Color")).toBe("#112233");
    expect(edgeCol(row, "Label Background Color")).toBe("#AABBCC");
    expect(edgeCol(row, "Start Arrow")).toBe(true);
    expect(edgeCol(row, "Start Arrow Size")).toBe(12);
    expect(edgeCol(row, "Start Arrow Type")).toBe("vee");
    expect(edgeCol(row, "End Arrow")).toBe(true);
    expect(edgeCol(row, "End Arrow Size")).toBe(10);
    expect(edgeCol(row, "End Arrow Type")).toBe("diamond");
    expect(edgeCol(row, "Halo Color")).toBe("#FF0000");
    expect(edgeCol(row, "Halo Width")).toBe(5);
  });

  it("exports default values for unprovided optional properties", () => {
    const { row } = importAndExportEdge({
      "Source ID": "A",
      "Target ID": "B",
    });

    expect(edgeCol(row, "Type")).toBe(DEFAULTS.EDGE.TYPE);
    expect(edgeCol(row, "Line Width")).toBe(DEFAULTS.EDGE.LINE_WIDTH);
    expect(edgeCol(row, "Line Dash")).toBe(DEFAULTS.EDGE.LINE_DASH);
    expect(edgeCol(row, "Color")).toBe(DEFAULTS.EDGE.COLOR);
    // Halo Color is gated on e.style.halo (src/managers/io.js — see 6bc4e4a):
    // minimal edges have halo disabled, so the column is intentionally empty
    // to prevent re-import from silently activating the halo.
    expect(edgeCol(row, "Halo Color")).toBeUndefined();
    expect(edgeCol(row, "Halo Width")).toBe(DEFAULTS.EDGE.HALO.WIDTH);
  });

  it("preserves arrow properties in edgeRef style", () => {
    const { ref } = importAndExportEdge({
      "Source ID": "A",
      "Target ID": "B",
      "Start Arrow": true,
      "Start Arrow Size": 14,
      "Start Arrow Type": "circle",
      "End Arrow": true,
      "End Arrow Size": 16,
      "End Arrow Type": "vee",
    });

    // Arrow properties live in style (consistent with getEdgeStyleOrDefaults)
    expect(ref.style.startArrow).toBe(true);
    expect(ref.style.startArrowSize).toBe(14);
    expect(ref.style.startArrowType).toBe("circle");
    expect(ref.style.endArrow).toBe(true);
    expect(ref.style.endArrowSize).toBe(16);
    expect(ref.style.endArrowType).toBe("vee");
  });
});

describe("Excel export: custom user-defined properties", () => {
  it("exports custom D4Data properties for nodes", () => {
    const node = {
      id: "A",
      D4Data: {
        "Node filters": {
          "group A": { "Feature X": 1.5, "Feature Y": "foo" },
          "group B": { "Feature Z": 42 },
        },
      },
    };
    applyExcelRow(node, { ID: "A" }, EXCEL_NODE_PROPERTIES);
    const ref = buildNodeRef(node);

    const nodeExclusiveProps = [
      "Node filters::group A::Feature X",
      "Node filters::group A::Feature Y",
      "Node filters::group B::Feature Z",
    ];

    const customValues = nodeExclusiveProps.map((propHash) => {
      const [group, subGroup, prop] =
        StaticUtilities.decodePropHashId(propHash);
      return ref.D4Data?.[group]?.[subGroup]?.[prop] ?? "";
    });

    expect(customValues).toEqual([1.5, "foo", 42]);
  });

  it("exports empty string for missing custom properties", () => {
    const node = { id: "A", D4Data: {} };
    applyExcelRow(node, { ID: "A" }, EXCEL_NODE_PROPERTIES);
    const ref = buildNodeRef(node);

    const [group, subGroup, prop] = StaticUtilities.decodePropHashId(
      "Node filters::group A::Missing",
    );
    const value = ref.D4Data?.[group]?.[subGroup]?.[prop] ?? "";
    expect(value).toBe("");
  });
});

describe("Excel export → re-import compatibility", () => {
  it("exported node values pass import validation", () => {
    const { row } = importAndExportNode({
      ID: "A",
      Label: "Node 1",
      Shape: "circle",
      Size: 60,
      "Fill Color": "#FF0000",
      "Border Size": 2,
      "Border Color": "#00FF00",
      "Label Font Size": 16,
      "Label Placement": "top",
      "Label Color": "#0000FF",
      "Label Background Color": "#AABBCC",
    });

    EXCEL_NODE_PROPERTIES.forEach((prop, i) => {
      const value = row[i];
      if (value === null || value === undefined) return;
      if (prop.required) return;
      if (!prop.type) return;

      expect(validateValue(value, prop.type)).toBe(
        true,
        `${prop.column} = ${JSON.stringify(value)} should pass type "${prop.type}"`,
      );
    });
  });

  it("exported edge values pass import validation", () => {
    const { row } = importAndExportEdge({
      "Source ID": "A",
      "Target ID": "B",
      Label: "test",
      Type: "cubic",
      "Line Width": 2,
      "Line Dash": 10,
      Color: "#FF000080",
      "Label Font Size": 14,
      "Label Placement": "start",
      "Label Auto Rotate": true,
      "Label Offset X": 5,
      "Label Offset Y": -3,
      "Label Color": "#112233",
      "Label Background Color": "#AABBCC",
      "Start Arrow": true,
      "Start Arrow Size": 12,
      "Start Arrow Type": "vee",
      "End Arrow": true,
      "End Arrow Size": 10,
      "End Arrow Type": "diamond",
      "Halo Color": "#FF0000",
      "Halo Width": 5,
    });

    EXCEL_EDGE_PROPERTIES.forEach((prop, i) => {
      const value = row[i];
      if (value === null || value === undefined) return;
      if (prop.required) return;
      if (!prop.type) return;

      expect(validateValue(value, prop.type)).toBe(
        true,
        `${prop.column} = ${JSON.stringify(value)} should pass type "${prop.type}"`,
      );
    });
  });

  it("node export → re-import round-trip preserves all values", () => {
    const original = {
      ID: "RT",
      Label: "Round Trip",
      Description: "testing",
      Shape: "star",
      Size: 35,
      "Fill Color": "#ABCDEF",
      "Border Size": 3,
      "Border Color": "#123456",
      "Label Font Size": 20,
      "Label Placement": "right",
      "Label Color": "#654321",
      "Label Background Color": "#FEDCBA",
    };

    // First pass: import → export
    const { row: firstRow } = importAndExportNode(original);

    // Second pass: re-import from exported row, then export again
    const reimported = {};
    EXCEL_NODE_PROPERTIES.forEach((prop, i) => {
      if (firstRow[i] !== null && firstRow[i] !== undefined) {
        reimported[prop.column] = firstRow[i];
      }
    });
    const { row: secondRow } = importAndExportNode(reimported);

    // Compare column-by-column
    EXCEL_NODE_PROPERTIES.forEach((prop, i) => {
      expect(secondRow[i]).toEqual(
        firstRow[i],
        `Round-trip mismatch for ${prop.column}`,
      );
    });
  });

  it("edge export → re-import round-trip preserves all values", () => {
    const original = {
      "Source ID": "A",
      "Target ID": "B",
      Label: "RT edge",
      Description: "round trip",
      Type: "quadratic",
      "Line Width": 1.5,
      "Line Dash": 5,
      Color: "#AABB11",
      "Label Font Size": 10,
      "Label Placement": "end",
      "Label Auto Rotate": true,
      "Label Offset X": 8,
      "Label Offset Y": -2,
      "Label Color": "#334455",
      "Label Background Color": "#EEDDCC",
      "Start Arrow": true,
      "Start Arrow Size": 6,
      "Start Arrow Type": "diamond",
      "End Arrow": true,
      "End Arrow Size": 14,
      "End Arrow Type": "rect",
      "Halo Color": "#AABBCC",
      "Halo Width": 4,
    };

    const { row: firstRow } = importAndExportEdge(original);

    const reimported = {};
    EXCEL_EDGE_PROPERTIES.forEach((prop, i) => {
      if (firstRow[i] !== null && firstRow[i] !== undefined) {
        reimported[prop.column] = firstRow[i];
      }
    });
    const { row: secondRow } = importAndExportEdge(reimported);

    EXCEL_EDGE_PROPERTIES.forEach((prop, i) => {
      expect(secondRow[i]).toEqual(
        firstRow[i],
        `Round-trip mismatch for ${prop.column}`,
      );
    });
  });

  it("node positions survive the round-trip via positions map", () => {
    const original = { ID: "P", "X Coordinate": 150, "Y Coordinate": -75 };
    const node = { id: "P" };
    applyExcelRow(node, original, EXCEL_NODE_PROPERTIES);

    // Simulate import path: positions extracted before getNodeStyleOrDefaults strips them
    const positionsMap = new Map([
      ["P", { style: { x: node.style.x, y: node.style.y } }],
    ]);

    const ref = buildNodeRef(node);
    const row = buildNodeExportRow(ref, positionsMap);

    expect(nodeCol(row, "X Coordinate")).toBe(150);
    expect(nodeCol(row, "Y Coordinate")).toBe(-75);

    // Re-import the exported row
    const reimported = {};
    EXCEL_NODE_PROPERTIES.forEach((prop, i) => {
      if (row[i] !== null && row[i] !== undefined) {
        reimported[prop.column] = row[i];
      }
    });
    const node2 = { id: reimported["ID"] };
    applyExcelRow(node2, reimported, EXCEL_NODE_PROPERTIES);

    expect(node2.style.x).toBe(150);
    expect(node2.style.y).toBe(-75);
  });
});

describe("Excel export: header row", () => {
  it("node header row matches EXCEL_NODE_PROPERTIES column order", () => {
    const headers = EXCEL_NODE_PROPERTIES.map((p) => p.column);
    expect(headers[0]).toBe("ID");
    expect(headers[1]).toBe("Label");
    expect(headers).toContain("Shape");
    expect(headers).toContain("Size");
    expect(headers).toContain("Fill Color");
    expect(headers).toContain("X Coordinate");
    expect(headers).toContain("Y Coordinate");
    // X/Y should be the last built-in columns
    expect(headers.indexOf("X Coordinate")).toBe(headers.length - 2);
    expect(headers.indexOf("Y Coordinate")).toBe(headers.length - 1);
  });

  it("edge header row matches EXCEL_EDGE_PROPERTIES column order", () => {
    const headers = EXCEL_EDGE_PROPERTIES.map((p) => p.column);
    expect(headers[0]).toBe("Source ID");
    expect(headers[1]).toBe("Target ID");
    expect(headers).toContain("Color");
    expect(headers).toContain("Start Arrow");
    expect(headers).toContain("End Arrow");
    expect(headers).toContain("Halo Color");
    expect(headers).toContain("Halo Width");
  });

  it("every non-required EXCEL_NODE_PROPERTIES entry has both apply and get", () => {
    EXCEL_NODE_PROPERTIES.forEach((prop) => {
      if (!prop.required) {
        expect(typeof prop.apply).toBe(
          "function",
          `${prop.column} missing apply`,
        );
        expect(typeof prop.get).toBe("function", `${prop.column} missing get`);
      }
    });
  });

  it("every non-required EXCEL_EDGE_PROPERTIES entry has both apply and get", () => {
    EXCEL_EDGE_PROPERTIES.forEach((prop) => {
      if (!prop.required) {
        expect(typeof prop.apply).toBe(
          "function",
          `${prop.column} missing apply`,
        );
        expect(typeof prop.get).toBe("function", `${prop.column} missing get`);
      }
    });
  });
});

describe("Excel export: defaults-only node values pass validation", () => {
  // A node with ONLY ID — all style columns get defaults.
  // Every non-null default must pass re-import validation.
  it("default-filled node row has valid values for all non-null columns", () => {
    const { row } = importAndExportNode({ ID: "defaults-only" });

    EXCEL_NODE_PROPERTIES.forEach((prop, i) => {
      const value = row[i];
      if (value === null || value === undefined) return;
      if (prop.required) return;
      if (!prop.type) return;

      expect(validateValue(value, prop.type)).toBe(
        true,
        `Default for ${prop.column} = ${JSON.stringify(value)} fails type "${prop.type}"`,
      );
    });
  });

  it("default-filled edge row has valid values for all non-null columns", () => {
    const { row } = importAndExportEdge({ "Source ID": "X", "Target ID": "Y" });

    EXCEL_EDGE_PROPERTIES.forEach((prop, i) => {
      const value = row[i];
      if (value === null || value === undefined) return;
      if (prop.required) return;
      if (!prop.type) return;

      expect(validateValue(value, prop.type)).toBe(
        true,
        `Default for ${prop.column} = ${JSON.stringify(value)} fails type "${prop.type}"`,
      );
    });
  });
});
