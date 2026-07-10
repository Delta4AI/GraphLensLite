import { describe, it, expect } from "vitest";
import { DEFAULTS, CFG } from "../src/config.js";
import { EXCEL_NODE_PROPERTIES, EXCEL_EDGE_PROPERTIES } from "../src/managers/io.js";
import { StaticUtilities } from "../src/utilities/static.js";
import { GraphStyleManager } from "../src/graph/style.js";
import { nodeAttributesFromStyle, edgeAttributesFromStyle } from "../src/graph/graph_model.js";

// ==========================================================================
// Excel style round-trip (MIGRATION.md risk #4): a node/edge styled through
// the style pipeline must export to the Excel column set and re-import to an
// identical nodeRef style AND identical sigma attributes via the graph_model
// mapping. Uses the REAL GraphStyleManager and io.js column definitions.
// ==========================================================================

const styleManager = new GraphStyleManager({ cache: null });
styleManager.cache = { DEFAULTS, CFG };

/** Export: run every column getter against the styled element. */
function exportToRow(element, propertyMap) {
  const row = {};
  for (const { column, get } of propertyMap) {
    const value = get(element);
    if (value !== undefined && value !== null) row[column] = value;
  }
  return row;
}

/** Import: mirrors addNodeOrEdgeStyle (validate → coerce → apply). */
function importFromRow(element, row, propertyMap) {
  element.style = {};
  for (const { column, type, required, apply } of propertyMap) {
    if (required || !type || !apply) continue;
    const rawValue = row[column];
    if (rawValue === null || rawValue === undefined) continue;
    if (rawValue.toString().trim() === "") continue;

    let localType = type;
    let listValues = null;
    if (localType.startsWith("oneOf:")) {
      listValues = localType.split(":")[1].split("|");
      localType = "list";
    }

    let validated = false;
    switch (localType) {
      case "str": validated = true; break;
      case "num": validated = StaticUtilities.isNumber(rawValue); break;
      case "bool": validated = StaticUtilities.isBoolean(rawValue); break;
      case "rgba": validated = StaticUtilities.isHexColor(rawValue); break;
      case "list": validated = StaticUtilities.isInList(rawValue, listValues); break;
    }
    if (!validated) continue;

    let coerced = rawValue;
    if (localType === "num") coerced = parseFloat(rawValue);
    else if (localType === "bool") {
      coerced =
        typeof rawValue === "string" ? rawValue.trim().toLowerCase() === "true" : !!rawValue;
    }
    apply(element, coerced);
  }
}

function importNode(row) {
  const node = { id: row["ID"] ?? "n1" };
  importFromRow(node, row, EXCEL_NODE_PROPERTIES);
  const processed = styleManager.getNodeStyleOrDefaults(node);
  // getNodeStyleOrDefaults omits x/y: at runtime coordinates flow through the
  // layout positions Map and are synced back onto nodeRef.style by
  // SigmaAdapter.getNodeData before any export. Mirror that here.
  const style = { ...processed.style };
  if (node.style.x !== undefined) style.x = node.style.x;
  if (node.style.y !== undefined) style.y = node.style.y;
  return { ...node, type: processed.type, style };
}

function importEdge(row) {
  const edge = {
    id: `${row["Source ID"] ?? "A"}::${row["Target ID"] ?? "B"}`,
    source: row["Source ID"] ?? "A",
    target: row["Target ID"] ?? "B",
  };
  importFromRow(edge, row, EXCEL_EDGE_PROPERTIES);
  const processed = styleManager.getEdgeStyleOrDefaults(edge);
  return { ...edge, type: processed.type, style: processed.style };
}

describe("Excel style round-trip — nodes", () => {
  const FULLY_STYLED_ROW = {
    "ID": "n1",
    "Label": "Full Node",
    "Description": "Round-trip test",
    "Shape": "star",
    "Size": "35",
    "Fill Color": "#ABCDEF",
    "Border Size": "2",
    "Border Color": "#123456",
    "Label Font Size": "16",
    "Label Placement": "right",
    "Label Color": "#654321",
    "Label Background Color": "#FEDCBA",
    "X Coordinate": "120",
    "Y Coordinate": "-45",
  };

  it("styled node → export → re-import yields an identical type and style", () => {
    const original = importNode(FULLY_STYLED_ROW);
    const row = exportToRow(original, EXCEL_NODE_PROPERTIES);
    const reimported = importNode(row);

    expect(reimported.type).toEqual(original.type);
    expect(reimported.style).toEqual(original.style);
  });

  it("styled node → export → re-import yields identical sigma attributes", () => {
    const original = importNode(FULLY_STYLED_ROW);
    const row = exportToRow(original, EXCEL_NODE_PROPERTIES);
    const reimported = importNode(row);

    const attrsBefore = nodeAttributesFromStyle(original.style, original.type);
    const attrsAfter = nodeAttributesFromStyle(reimported.style, reimported.type);

    expect(attrsAfter).toEqual(attrsBefore);
    // Sanity: the styling actually reached the sigma attrs.
    expect(attrsBefore.type).toBe("shape"); // star → texture program
    expect(attrsBefore.image).toContain(encodeURIComponent("#ABCDEF"));
    expect(attrsBefore.borderColor).toBe("#123456");
    expect(attrsBefore.labelSize).toBe(16);
    expect(attrsBefore.y).toBe(45); // y-down Excel value → y-up sigma space
  });

  it("every shape survives the round-trip", () => {
    for (const shape of ["circle", "diamond", "hexagon", "rect", "triangle", "star"]) {
      const original = importNode({ "ID": "n1", "Shape": shape });
      const reimported = importNode(exportToRow(original, EXCEL_NODE_PROPERTIES));

      expect(reimported.type).toBe(shape);
      expect(nodeAttributesFromStyle(reimported.style, reimported.type)).toEqual(
        nodeAttributesFromStyle(original.style, original.type),
      );
    }
  });

  it("a default (column-less) node round-trips to the default style", () => {
    const original = importNode({ "ID": "n1" });
    const reimported = importNode(exportToRow(original, EXCEL_NODE_PROPERTIES));

    expect(reimported.type).toBe(DEFAULTS.NODE.TYPE);
    expect(reimported.style).toEqual(original.style);
  });

  it("a column-less node defaults opacity to fully opaque", () => {
    expect(importNode({ "ID": "n1" }).style.opacity).toBe(DEFAULTS.NODE.OPACITY);
  });

  it("Opacity column survives the round-trip and fades the sigma fill", () => {
    const original = importNode({ "ID": "n1", "Shape": "circle", "Fill Color": "#403C53", "Opacity": "0.5" });
    const row = exportToRow(original, EXCEL_NODE_PROPERTIES);

    expect(row["Opacity"]).toBe(0.5);
    const reimported = importNode(row);
    expect(reimported.style.opacity).toBe(0.5);
    expect(nodeAttributesFromStyle(reimported.style, reimported.type).color).toBe("#403c5380");
  });
});

describe("Excel style round-trip — edges", () => {
  const FULLY_STYLED_ROW = {
    "Source ID": "A",
    "Target ID": "B",
    "Label": "Full Edge",
    "Description": "Round-trip test",
    "Type": "cubic",
    "Line Width": "2",
    "Line Dash": "10",
    "Color": "#FF000080",
    "Label Font Size": "14",
    "Label Placement": "start",
    "Label Auto Rotate": "true",
    "Label Offset X": "5",
    "Label Offset Y": "-3",
    "Label Color": "#112233",
    "Label Background Color": "#AABBCC",
    "Start Arrow": "true",
    "Start Arrow Size": "12",
    "Start Arrow Type": "vee",
    "Start Arrow Color": "#C33D35",
    "Start Arrow Border Color": "#000000",
    "Start Arrow Border Size": "4",
    "End Arrow": "true",
    "End Arrow Size": "10",
    "End Arrow Type": "diamond",
    "End Arrow Color": "#8CA6D9",
    "End Arrow Border Color": "#00000000",
    "End Arrow Border Size": "2",
    "Halo Color": "#FF0000",
    "Halo Width": "5",
  };

  it("styled edge → export → re-import yields an identical type and style", () => {
    const original = importEdge(FULLY_STYLED_ROW);
    const row = exportToRow(original, EXCEL_EDGE_PROPERTIES);
    const reimported = importEdge(row);

    expect(reimported.type).toEqual(original.type);
    expect(reimported.style).toEqual(original.style);
  });

  it("styled edge → export → re-import yields identical sigma attributes", () => {
    const original = importEdge(FULLY_STYLED_ROW);
    const row = exportToRow(original, EXCEL_EDGE_PROPERTIES);
    const reimported = importEdge(row);

    const attrsBefore = edgeAttributesFromStyle(original.style, original.type);
    const attrsAfter = edgeAttributesFromStyle(reimported.style, reimported.type);

    expect(attrsAfter).toEqual(attrsBefore);
    expect(attrsBefore.type).toBe("styledCurve"); // cubic + both arrows
    expect(attrsBefore.size).toBe(2);
    expect(attrsBefore.labelSize).toBe(14);
    expect(attrsBefore.labelAutoRotate).toBe(true);
  });

  it("each edge type × arrow combination round-trips to the same program", () => {
    for (const type of ["line", "cubic", "quadratic", "polyline"]) {
      for (const arrows of [{}, { "End Arrow": "true" }, { "Start Arrow": "true" }]) {
        const original = importEdge({ "Source ID": "A", "Target ID": "B", "Type": type, ...arrows });
        const reimported = importEdge(exportToRow(original, EXCEL_EDGE_PROPERTIES));

        expect(edgeAttributesFromStyle(reimported.style, reimported.type).type).toBe(
          edgeAttributesFromStyle(original.style, original.type).type,
        );
      }
    }
  });

  it("a default edge round-trips to the default style", () => {
    const original = importEdge({ "Source ID": "A", "Target ID": "B" });
    const reimported = importEdge(exportToRow(original, EXCEL_EDGE_PROPERTIES));

    expect(reimported.type).toBe(DEFAULTS.EDGE.TYPE);
    expect(reimported.style).toEqual(original.style);
  });

  it("a column-less edge defaults opacity to fully opaque", () => {
    expect(importEdge({ "Source ID": "A", "Target ID": "B" }).style.opacity).toBe(DEFAULTS.EDGE.OPACITY);
  });

  it("Opacity column survives the round-trip and composes with the color alpha", () => {
    const original = importEdge({ "Source ID": "A", "Target ID": "B", "Color": "#403C5390", "Opacity": "0.5" });
    const row = exportToRow(original, EXCEL_EDGE_PROPERTIES);

    expect(row["Opacity"]).toBe(0.5);
    const reimported = importEdge(row);
    expect(reimported.style.opacity).toBe(0.5);
    // 0x90 (144) × 0.5 = 72 = 0x48.
    expect(edgeAttributesFromStyle(reimported.style, reimported.type).color).toBe("#403c5348");
  });
});
