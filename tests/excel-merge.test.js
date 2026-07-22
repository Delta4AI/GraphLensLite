// @vitest-environment jsdom
import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import ExcelJS from "exceljs";
import { IOManager } from "../src/managers/io.js";
import { DataTable } from "../src/utilities/data_editor.js";
import {
  computeMergePlan,
  buildMergePreviewContent,
  showMergePreview,
} from "../src/utilities/excel_merge.js";
import { CFG, DEFAULTS } from "../src/config.js";
import { DropdownChecklist } from "../src/managers/ui_components.js";

// ==========================================================================
// Excel import & merge — the "⤒ Import" data-editor feature. Covers the pure
// merge plan (computeMergePlan), the merge-mode Excel parser options, and the
// preview modal.
// ==========================================================================

beforeAll(() => {
  // Production code references ExcelJS as a global (vendored script tag).
  globalThis.ExcelJS = ExcelJS;
  // Popup schedules a visibility check via rAF; jsdom lacks it.
  globalThis.requestAnimationFrame ??= (cb) => setTimeout(cb, 0);
});

function createMockCache() {
  return {
    CFG,
    DEFAULTS,
    data: { filterDefaults: new Map() },
    bs: {
      traverseBubbleSets: function* () {
        for (const group of Object.keys(DEFAULTS.BUBBLE_GROUP_QUADRANT_POSITIONS)) {
          yield group;
        }
      },
    },
    ui: { warning: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    nodeRef: new Map(),
    edgeRef: new Map(),
  };
}

/** Build an Excel buffer; pass null to omit a sheet entirely. */
async function buildWorkbook(nodeRows, edgeRows) {
  const workbook = new ExcelJS.Workbook();
  const addSheet = (name, rows) => {
    if (rows === null) return;
    const sheet = workbook.addWorksheet(name);
    if (rows.length > 0) {
      const cols = Object.keys(rows[0]);
      sheet.addRow(cols);
      for (const row of rows) sheet.addRow(cols.map((c) => row[c]));
    }
  };
  addSheet("nodes", nodeRows);
  addSheet("edges", edgeRows);
  return workbook.xlsx.writeBuffer();
}

const NODE_HEADER = CFG.EXCEL_NODE_HEADER;
const EDGE_HEADER = CFG.EXCEL_EDGE_HEADER;

function currentGraphFixture() {
  return {
    nodes: [
      {
        id: "A",
        label: "Node A",
        style: { size: 20 },
        D4Data: { [NODE_HEADER]: { "group A": { "Feature X": 1 } } },
      },
      {
        id: "B",
        style: {},
        D4Data: { [NODE_HEADER]: { "group A": { "Feature X": 2 } } },
      },
    ],
    edges: [
      {
        id: "A::B",
        source: "A",
        target: "B",
        style: {},
        D4Data: { [EDGE_HEADER]: { "group X": { Weight: 0.5 } } },
      },
    ],
    nodeDataHeaders: [{ subGroup: "group A", key: "Feature X" }],
    edgeDataHeaders: [{ subGroup: "group X", key: "Weight" }],
  };
}

// --------------------------------------------------------------------------
// computeMergePlan
// --------------------------------------------------------------------------

describe("computeMergePlan", () => {
  it("extends an existing node with a new property column", () => {
    const current = currentGraphFixture();
    const incoming = {
      nodes: [
        {
          id: "A",
          style: {},
          D4Data: { [NODE_HEADER]: { "group A": { "Feature Y": 5 } } },
        },
      ],
      edges: [],
      nodeDataHeaders: [
        { subGroup: "group A", key: "Feature X" },
        { subGroup: "group A", key: "Feature Y" },
      ],
      edgeDataHeaders: [],
    };

    const plan = computeMergePlan(current, incoming);

    expect(plan.stats.nodes.added).toEqual([]);
    expect(plan.stats.nodes.modified).toEqual(["A"]);
    expect(plan.stats.newNodeColumns).toEqual(["Feature Y [group A]"]);
    expect(plan.stats.hasChanges).toBe(true);

    const mergedA = plan.fileData.nodes.find((n) => n.id === "A");
    expect(mergedA.D4Data[NODE_HEADER]["group A"]).toEqual({
      "Feature X": 1,
      "Feature Y": 5,
    });
    // Existing fields survive the overlay
    expect(mergedA.label).toBe("Node A");
    expect(mergedA.style.size).toBe(20);
  });

  it("treats a re-import of identical data as unchanged", () => {
    const current = currentGraphFixture();
    const incoming = {
      nodes: [
        {
          id: "A",
          style: {},
          D4Data: { [NODE_HEADER]: { "group A": { "Feature X": 1 } } },
        },
      ],
      edges: [
        {
          id: "A::B",
          source: "A",
          target: "B",
          style: {},
          D4Data: { [EDGE_HEADER]: { "group X": { Weight: 0.5 } } },
        },
      ],
      nodeDataHeaders: [{ subGroup: "group A", key: "Feature X" }],
      edgeDataHeaders: [{ subGroup: "group X", key: "Weight" }],
    };

    const plan = computeMergePlan(current, incoming);

    expect(plan.stats.nodes.modified).toEqual([]);
    expect(plan.stats.nodes.unchanged).toBe(1);
    expect(plan.stats.edges.unchanged).toBe(1);
    expect(plan.stats.hasChanges).toBe(false);
  });

  it("ignores the empty D4Data scaffolding the parser always emits", () => {
    const current = currentGraphFixture();
    const incoming = {
      nodes: [{ id: "A", style: {}, D4Data: { [NODE_HEADER]: {} } }],
      edges: [],
      nodeDataHeaders: [],
      edgeDataHeaders: [],
    };

    const plan = computeMergePlan(current, incoming);
    expect(plan.stats.nodes.modified).toEqual([]);
    expect(plan.stats.hasChanges).toBe(false);
  });

  it("adds new nodes and edges, including edges onto existing nodes", () => {
    const current = currentGraphFixture();
    const incoming = {
      nodes: [
        {
          id: "C",
          style: {},
          D4Data: { [NODE_HEADER]: { "group B": { "Feature Z": 3 } } },
        },
      ],
      edges: [
        { id: "A::C", source: "A", target: "C", style: {}, D4Data: {} },
      ],
      nodeDataHeaders: [{ subGroup: "group B", key: "Feature Z" }],
      edgeDataHeaders: [],
    };

    const plan = computeMergePlan(current, incoming);

    expect(plan.stats.nodes.added).toEqual(["C"]);
    expect(plan.stats.edges.added).toEqual(["A::C"]);
    expect(plan.fileData.nodes).toHaveLength(3);
    expect(plan.fileData.edges).toHaveLength(2);
    expect(plan.stats.newNodeColumns).toEqual(["Feature Z [group B]"]);
  });

  it("updates label, description and style on existing elements", () => {
    const current = currentGraphFixture();
    const incoming = {
      nodes: [
        {
          id: "B",
          label: "Node B",
          description: "desc",
          style: { fill: "#FF0000" },
          D4Data: {},
        },
      ],
      edges: [],
      nodeDataHeaders: [],
      edgeDataHeaders: [],
    };

    const plan = computeMergePlan(current, incoming);
    const mergedB = plan.fileData.nodes.find((n) => n.id === "B");

    expect(plan.stats.nodes.modified).toEqual(["B"]);
    expect(mergedB.label).toBe("Node B");
    expect(mergedB.description).toBe("desc");
    expect(mergedB.style.fill).toBe("#FF0000");
  });

  it("does not mutate its inputs", () => {
    const current = currentGraphFixture();
    const incoming = {
      nodes: [
        {
          id: "A",
          style: { size: 99 },
          D4Data: { [NODE_HEADER]: { "group A": { "Feature Y": 5 } } },
        },
      ],
      edges: [],
      nodeDataHeaders: [{ subGroup: "group A", key: "Feature Y" }],
      edgeDataHeaders: [],
    };
    const currentBefore = JSON.stringify(current);
    const incomingBefore = JSON.stringify(incoming);

    computeMergePlan(current, incoming);

    expect(JSON.stringify(current)).toBe(currentBefore);
    expect(JSON.stringify(incoming)).toBe(incomingBefore);
  });

  it("matches ids across string/number representations", () => {
    const current = {
      nodes: [{ id: "1", style: {}, D4Data: {} }],
      edges: [],
      nodeDataHeaders: [],
      edgeDataHeaders: [],
    };
    const incoming = {
      nodes: [
        { id: 1, style: {}, D4Data: { [NODE_HEADER]: { g: { p: 7 } } } },
      ],
      edges: [],
      nodeDataHeaders: [{ subGroup: "g", key: "p" }],
      edgeDataHeaders: [],
    };

    const plan = computeMergePlan(current, incoming);
    expect(plan.stats.nodes.added).toEqual([]);
    expect(plan.stats.nodes.modified).toEqual(["1"]);
    expect(plan.fileData.nodes).toHaveLength(1);
  });

  it("keeps new columns contiguous with their group", () => {
    const current = {
      nodes: [],
      edges: [],
      nodeDataHeaders: [
        { subGroup: "g1", key: "a" },
        { subGroup: "g2", key: "b" },
      ],
      edgeDataHeaders: [],
    };
    const incoming = {
      nodes: [],
      edges: [],
      nodeDataHeaders: [{ subGroup: "g1", key: "c" }],
      edgeDataHeaders: [],
    };

    const plan = computeMergePlan(current, incoming);
    expect(plan.fileData.nodeDataHeaders).toEqual([
      { subGroup: "g1", key: "a" },
      { subGroup: "g1", key: "c" },
      { subGroup: "g2", key: "b" },
    ]);
  });

  it("labels uncategorized columns without a group suffix", () => {
    const current = { nodes: [], edges: [], nodeDataHeaders: [], edgeDataHeaders: [] };
    const incoming = {
      nodes: [],
      edges: [],
      nodeDataHeaders: [
        { subGroup: CFG.EXCEL_UNCATEGORIZED_SUBHEADER, key: "Plain" },
      ],
      edgeDataHeaders: [],
    };

    const plan = computeMergePlan(current, incoming);
    expect(plan.stats.newNodeColumns).toEqual(["Plain"]);
  });
});

// --------------------------------------------------------------------------
// parseExcelToJson merge mode
// --------------------------------------------------------------------------

describe("parseExcelToJson merge mode", () => {
  let cache;
  let io;

  beforeEach(() => {
    cache = createMockCache();
    io = new IOManager(cache);
  });

  it("accepts a nodes-only workbook in merge mode", async () => {
    const buffer = await buildWorkbook(
      [{ ID: "A", "Feature X [group A]": 1 }],
      null
    );

    const result = await io.parseExcelToJson(buffer, { merge: true });

    expect(cache.ui.error).not.toHaveBeenCalled();
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toEqual([]);
    expect(result.nodeDataHeaders).toEqual([{ subGroup: "group A", key: "Feature X" }]);
  });

  it("still requires both sheets outside merge mode", async () => {
    const buffer = await buildWorkbook([{ ID: "A" }], null);

    const result = await io.parseExcelToJson(buffer);

    expect(result).toBeUndefined();
    expect(cache.ui.error).toHaveBeenCalledWith(
      'The Excel file must contain a "nodes" and "edges" sheet.'
    );
  });

  it("validates edge endpoints against known graph nodes", async () => {
    const buffer = await buildWorkbook(null, [
      { "Source ID": "A", "Target ID": "B", "Weight [group X]": 1 },
      { "Source ID": "A", "Target ID": "MISSING", "Weight [group X]": 2 },
    ]);

    const result = await io.parseExcelToJson(buffer, {
      merge: true,
      knownNodeIDs: new Set(["A", "B"]),
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].id).toBe("A::B");
    expect(result.skippedEdgeRows).toBe(1);
    expect(cache.ui.warning).toHaveBeenCalledWith(
      expect.stringContaining("MISSING")
    );
  });

  it("normalizes rich cell values (richText, hyperlink, formula) to primitives", async () => {
    // A workbook re-saved by Excel/LibreOffice can turn plain cells into rich
    // values. Raw objects in D4Data make every matched row look "modified"
    // and later crash the category filters (val.toLowerCase).
    const wb = new ExcelJS.Workbook();
    const ns = wb.addWorksheet("nodes");
    ns.addRow(["ID", "Feat [g]"]);
    ns.addRow(["A", 1]);
    const es = wb.addWorksheet("edges");
    es.addRow(["Source ID", "Target ID", "Cat [g]", "Link [g]", "Calc [g]"]);
    es.getCell("A2").value = "A";
    es.getCell("B2").value = "A";
    es.getCell("C2").value = { richText: [{ text: "Dummy " }, { text: "Category 1" }] };
    es.getCell("D2").value = { text: "example", hyperlink: "https://example.org" };
    es.getCell("E2").value = { formula: "1+1", result: 2 };
    const buffer = await wb.xlsx.writeBuffer();

    const result = await io.parseExcelToJson(buffer);

    const data = result.edges[0].D4Data[EDGE_HEADER]["g"];
    expect(data["Cat"]).toBe("Dummy Category 1");
    expect(data["Link"]).toBe("example");
    expect(data["Calc"]).toBe(2);
  });

  it("re-importing the source file of a graph reports no changes", async () => {
    const buffer = await buildWorkbook(
      [
        { ID: "A", Label: "Node A", "Feat [g]": 1 },
        { ID: "B", Label: "Node B", "Feat [g]": 2 },
      ],
      [{ "Source ID": "A", "Target ID": "B", Label: "rel", "Cat [g]": "x" }]
    );

    const current = await io.parseExcelToJson(buffer);
    const incoming = await io.parseExcelToJson(buffer, { merge: true });
    const plan = computeMergePlan(current, incoming);

    expect(plan.stats.hasChanges).toBe(false);
    expect(plan.stats.nodes.unchanged).toBe(2);
    expect(plan.stats.edges.unchanged).toBe(1);
  });

  it("is idempotent: a second merge of the same file reports no changes", async () => {
    const buffer = await buildWorkbook(
      [{ ID: "A", Label: "Node A", "Feat [g]": 1 }],
      [{ "Source ID": "A", "Target ID": "A", Label: "self", "Cat [g]": "x" }]
    );
    // Existing graph state as a JSON load would have it: full default styles
    // that differ from what the parser emits (label flag, label styling keys).
    const current = {
      nodes: [{ id: "A", label: "old", style: { label: true, size: 20 }, D4Data: {} }],
      edges: [
        { id: "A::A", source: "A", target: "A", style: { label: true }, D4Data: {} },
      ],
      nodeDataHeaders: [],
      edgeDataHeaders: [],
    };

    const incoming1 = await io.parseExcelToJson(buffer, { merge: true });
    const plan1 = computeMergePlan(current, incoming1);
    expect(plan1.stats.hasChanges).toBe(true); // first merge legitimately updates

    const incoming2 = await io.parseExcelToJson(buffer, { merge: true });
    const plan2 = computeMergePlan(plan1.fileData, incoming2);
    expect(plan2.stats.hasChanges).toBe(false);
    expect(plan2.stats.nodes.modified).toEqual([]);
    expect(plan2.stats.edges.modified).toEqual([]);
  });

  it("rejects a merge workbook with no rows at all", async () => {
    const buffer = await buildWorkbook([], []);

    const result = await io.parseExcelToJson(buffer, { merge: true });

    expect(result).toBeUndefined();
    expect(cache.ui.error).toHaveBeenCalledWith(
      "The Excel file contains no node or edge rows."
    );
  });
});

// --------------------------------------------------------------------------
// Preview modal
// --------------------------------------------------------------------------

describe("merge preview modal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function planFixture(hasChanges = true) {
    return {
      fileData: { nodes: [], edges: [], nodeDataHeaders: [], edgeDataHeaders: [] },
      stats: {
        nodes: {
          added: hasChanges ? ["C", "D"] : [],
          modified: hasChanges ? ["A"] : [],
          unchanged: 1,
        },
        edges: { added: [], modified: [], unchanged: 2 },
        newNodeColumns: hasChanges ? ["Feature Y [group A]"] : [],
        newEdgeColumns: [],
        skippedNodeRows: 0,
        skippedEdgeRows: 1,
        hasChanges,
      },
    };
  }

  it("renders counts, columns, notes and id lists", () => {
    const content = buildMergePreviewContent(planFixture().stats, "extra.xlsx");

    expect(content.querySelector(".merge-preview-file").textContent).toContain("extra.xlsx");
    const nums = [...content.querySelectorAll(".merge-stat-num")].map((n) => n.textContent);
    expect(nums).toEqual(["+2", "~1", "0", "0"]);
    expect(content.querySelector(".merge-preview-col-badge").textContent).toBe(
      "Feature Y [group A] (nodes)"
    );
    const notes = [...content.querySelectorAll(".merge-preview-note")].map((n) => n.textContent);
    expect(notes.some((t) => t.includes("stay unchanged"))).toBe(true);
    expect(notes.some((t) => t.includes("skipped"))).toBe(true);
    const details = [...content.querySelectorAll(".merge-preview-details summary")].map(
      (s) => s.textContent
    );
    expect(details).toEqual(["New nodes (2)", "Updated nodes (1)"]);
    expect(content.querySelector(".alert-warning")).not.toBeNull();
  });

  it("resolves true on Import and false on Cancel", async () => {
    let promise = showMergePreview(planFixture(), "a.xlsx");
    document.querySelector(".p-footer .p-button-primary").click();
    await expect(promise).resolves.toBe(true);

    promise = showMergePreview(planFixture(), "a.xlsx");
    document.querySelector(".p-footer .p-button-secondary").click();
    await expect(promise).resolves.toBe(false);
  });

  it("disables Import and shows a notice when nothing changes", () => {
    showMergePreview(planFixture(false), "same.xlsx");

    const importBtn = document.querySelector(".p-footer .p-button-primary");
    expect(importBtn.disabled).toBe(true);
    expect(document.querySelector(".alert-info").textContent).toContain("No changes detected");
    expect(document.querySelector(".alert-warning")).toBeNull();
    document.querySelector(".p-footer .p-button-secondary").click();
  });
});

// --------------------------------------------------------------------------
// Category dropdown resilience (crash path of the merge bug report)
// --------------------------------------------------------------------------

describe("DropdownChecklist.sortCategories", () => {
  it("tolerates non-string category values instead of crashing", () => {
    const propID = "p";
    const cache = {
      data: {
        filterDefaults: new Map([[propID, { categories: new Set(["high", 5, "alpha"]) }]]),
        layouts: { L: { filters: new Map([[propID, { categories: new Set() }]]) } },
        selectedLayout: "L",
      },
      propIDToDropdownChecklists: new Map(),
    };

    const checklist = new DropdownChecklist(propID, cache);
    // "high" is a priority keyword and sorts last; others alphabetical
    expect([...checklist.categories]).toEqual([5, "alpha", "high"]);
  });
});

// --------------------------------------------------------------------------
// DataTable import entry points
// --------------------------------------------------------------------------

describe("DataTable import guards and position seeding", () => {
  let cache;
  let table;

  beforeEach(() => {
    cache = createMockCache();
    table = new DataTable(cache);
  });

  it("refuses to import before a graph is loaded", () => {
    table.fileData = null;
    table.importExcel();
    expect(cache.ui.error).toHaveBeenCalledWith("Load a graph before importing.");
  });

  it("refuses to import while data editor changes are pending", () => {
    table.fileData = { nodes: [], edges: [] };
    table.pendingChanges.set("A", { type: "Node" });
    table.importExcel();
    expect(cache.ui.error).toHaveBeenCalledWith(
      "Apply or reset the pending data editor changes before importing."
    );
  });

  it("seeds current-workspace positions only for NEW nodes with coordinates", () => {
    const positions = new Map([["A", { style: { x: 1, y: 2 } }]]);
    cache.data.layouts = { Default: { positions } };
    cache.data.selectedLayout = "Default";

    const plan = {
      stats: { nodes: { added: ["C", "D"] } },
      fileData: {
        nodes: [
          { id: "A", style: { x: 99, y: 99 } }, // existing — never touched
          { id: "C", style: { x: 10, y: 20 } }, // new with coordinates — seeded
          { id: "D", style: {} }, // new without coordinates — placeholder ring
        ],
      },
    };

    table.seedImportedPositions(plan);

    expect(positions.get("A")).toEqual({ style: { x: 1, y: 2 } });
    expect(positions.get("C")).toEqual({ style: { x: 10, y: 20 } });
    expect(positions.has("D")).toBe(false);
  });
});
