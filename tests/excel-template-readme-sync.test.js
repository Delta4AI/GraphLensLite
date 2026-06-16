import { describe, it, expect, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  EXCEL_NODE_PROPERTIES,
  EXCEL_EDGE_PROPERTIES,
} from "../src/managers/io.js";

// The simple-template.xlsx "readme" tab is the user-facing catalog of every
// optional styling column the Excel importer understands. It must stay in sync
// with EXCEL_NODE_PROPERTIES / EXCEL_EDGE_PROPERTIES — a column the importer
// parses but the readme omits is invisible to users; a column the readme
// advertises but the importer ignores is a lie. This test guards both
// directions so the catalog cannot silently drift again.

const TEMPLATE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../templates/simple-template.xlsx",
);

// Section headers in the readme tab, and the user-defined placeholder row that
// is documentation-only (not an importer column).
const NODE_HEADER = "Node Properties Explained";
const EDGE_HEADER = "Edge Properties Explained";
const USER_DEFINED_PREFIX = "property A";

function collectDocumentedColumns(ws) {
  const colA = [];
  ws.eachRow((row) => {
    const v = row.getCell(1).value;
    colA.push(typeof v === "string" ? v.trim() : v);
  });
  const nodeStart = colA.indexOf(NODE_HEADER);
  const edgeStart = colA.indexOf(EDGE_HEADER);
  expect(nodeStart, `"${NODE_HEADER}" section`).toBeGreaterThanOrEqual(0);
  expect(edgeStart, `"${EDGE_HEADER}" section`).toBeGreaterThan(nodeStart);

  const slice = (from, to) =>
    colA
      .slice(from + 1, to)
      .filter(
        (v) =>
          typeof v === "string" &&
          v !== "" &&
          !v.startsWith(USER_DEFINED_PREFIX),
      );

  return {
    nodes: slice(nodeStart, edgeStart),
    edges: slice(edgeStart, colA.length),
  };
}

describe("simple-template.xlsx readme tab stays in sync with the importer", () => {
  let documented;

  beforeAll(async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(TEMPLATE);
    const readme = wb.getWorksheet("readme");
    expect(readme, "readme worksheet").toBeTruthy();
    documented = collectDocumentedColumns(readme);
  });

  it("documents exactly the node columns the importer parses, in order", () => {
    const importer = EXCEL_NODE_PROPERTIES.map((p) => p.column);
    expect(documented.nodes).toEqual(importer);
  });

  it("documents exactly the edge columns the importer parses, in order", () => {
    const importer = EXCEL_EDGE_PROPERTIES.map((p) => p.column);
    expect(documented.edges).toEqual(importer);
  });
});
