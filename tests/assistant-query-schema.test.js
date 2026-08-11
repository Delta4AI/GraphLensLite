import { describe, it, expect } from "vitest";
import {
  QUERY_RESPONSE_SCHEMA,
  buildQuerySchema,
  flattenHierarchy,
  renderAst,
  renderQueries,
  QueryShapeError,
  scopesOf,
  effectiveScope,
} from "../src/managers/assistant/query_schema.js";

describe("QUERY_RESPONSE_SCHEMA", () => {
  it("requires queries array at the top level", () => {
    expect(QUERY_RESPONSE_SCHEMA.required).toContain("queries");
  });

  it("constrains field to Section::Group::Name via pattern", () => {
    const fieldSchema = QUERY_RESPONSE_SCHEMA.$defs.Expr.properties.field;
    const re = new RegExp(fieldSchema.pattern);
    expect(re.test("Node filters::Group A::score")).toBe(true);
    expect(re.test("Edge filters::G::prop")).toBe(true);
    expect(re.test("Foo::bar::baz")).toBe(false);
    expect(re.test("Node filters::only_two")).toBe(false);
  });

  it("enumerates only the five permitted operators", () => {
    expect(QUERY_RESPONSE_SCHEMA.$defs.Expr.properties.op.enum)
      .toEqual(["BETWEEN", "LT_OR_GT", "IN", "IS_TRUE", "IS_FALSE"]);
  });

  it("enumerates only the three permitted binary connectors", () => {
    expect(QUERY_RESPONSE_SCHEMA.$defs.Expr.properties.bop.enum)
      .toEqual(["AND", "OR", "NOT"]);
  });
});

describe("renderAst — single conditions", () => {
  it("renders BETWEEN with integer bounds", () => {
    const out = renderAst({
      scope: "node",
      expr: { kind: "condition", field: "Node filters::G::score", op: "BETWEEN", min: 0, max: 10 },
    });
    expect(out).toBe("(Node filters::G::score BETWEEN 0 AND 10)");
  });

  it("renders BETWEEN with float bounds", () => {
    const out = renderAst({
      scope: "node",
      expr: { kind: "condition", field: "Node filters::G::score", op: "BETWEEN", min: 0.5, max: 1.3 },
    });
    expect(out).toBe("(Node filters::G::score BETWEEN 0.5 AND 1.3)");
  });

  it("renders LT_OR_GT as LOWER THAN … OR GREATER THAN", () => {
    const out = renderAst({
      scope: "node",
      expr: { kind: "condition", field: "Node filters::G::degree", op: "LT_OR_GT", lt: 5, gt: 50 },
    });
    expect(out).toBe("(Node filters::G::degree LOWER THAN 5 OR GREATER THAN 50)");
  });

  it("renders IN with unquoted values separated by comma-space", () => {
    const out = renderAst({
      scope: "node",
      expr: {
        kind: "condition",
        field: "Node filters::G::mechanism",
        op: "IN",
        values: ["angiogenesis", "fibrosis"],
      },
    });
    expect(out).toBe("(Node filters::G::mechanism IN [angiogenesis, fibrosis])");
  });

  it("rejects IN values that contain reserved characters", () => {
    expect(() =>
      renderAst({
        scope: "node",
        expr: {
          kind: "condition",
          field: "Node filters::G::x",
          op: "IN",
          values: ["a, b"],
        },
      })
    ).toThrow(QueryShapeError);
  });

  it("accepts either scope prefix on a leaf — scope is per-field, not per-query", () => {
    // Scope is no longer a query-level field; the generator can emit any
    // leaf and the lint only kicks in on cross-scope AND/NOT.
    expect(
      renderAst({
        expr: { kind: "condition", field: "Edge filters::G::x", op: "IN", values: ["a"] },
      })
    ).toBe("(Edge filters::G::x IN [a])");
  });

  it("rejects non-finite numeric bounds", () => {
    expect(() =>
      renderAst({
        scope: "node",
        expr: { kind: "condition", field: "Node filters::G::x", op: "BETWEEN", min: 0, max: Infinity },
      })
    ).toThrow(QueryShapeError);
  });

  it("rejects empty IN values", () => {
    expect(() =>
      renderAst({
        scope: "node",
        expr: { kind: "condition", field: "Node filters::G::x", op: "IN", values: [] },
      })
    ).toThrow(QueryShapeError);
  });
});

describe("renderAst — binary expressions", () => {
  it("parenthesises AND of two conditions", () => {
    const out = renderAst({
      scope: "node",
      expr: {
        kind: "binary",
        bop: "AND",
        left: { kind: "condition", field: "Node filters::G::a", op: "IN", values: ["x"] },
        right: { kind: "condition", field: "Node filters::G::b", op: "BETWEEN", min: 0, max: 1 },
      },
    });
    expect(out).toBe("(Node filters::G::a IN [x]) AND (Node filters::G::b BETWEEN 0 AND 1)");
  });

  it("renders NOT as a binary operator (not unary prefix)", () => {
    const out = renderAst({
      scope: "node",
      expr: {
        kind: "binary",
        bop: "NOT",
        left: { kind: "condition", field: "Node filters::G::a", op: "IN", values: ["x"] },
        right: { kind: "condition", field: "Node filters::G::b", op: "IN", values: ["y"] },
      },
    });
    expect(out).toBe("(Node filters::G::a IN [x]) NOT (Node filters::G::b IN [y])");
  });

  it("nests binaries by re-parenthesising sub-expressions", () => {
    const out = renderAst({
      scope: "node",
      expr: {
        kind: "binary",
        bop: "AND",
        left: {
          kind: "binary",
          bop: "OR",
          left: { kind: "condition", field: "Node filters::G::a", op: "IN", values: ["x"] },
          right: { kind: "condition", field: "Node filters::G::b", op: "IN", values: ["y"] },
        },
        right: { kind: "condition", field: "Node filters::G::c", op: "BETWEEN", min: 0, max: 1 },
      },
    });
    expect(out).toBe(
      "((Node filters::G::a IN [x]) OR (Node filters::G::b IN [y])) AND (Node filters::G::c BETWEEN 0 AND 1)"
    );
  });

  it("rejects unknown binary operators", () => {
    expect(() =>
      renderAst({
        scope: "node",
        expr: {
          kind: "binary",
          bop: "XOR",
          left: { kind: "condition", field: "Node filters::G::a", op: "IN", values: ["x"] },
          right: { kind: "condition", field: "Node filters::G::b", op: "IN", values: ["y"] },
        },
      })
    ).toThrow(QueryShapeError);
  });
});

describe("scope analysis and cross-scope lint", () => {
  const nodeCond = { kind: "condition", field: "Node filters::G::a", op: "IN", values: ["x"] };
  const edgeCond = { kind: "condition", field: "Edge filters::G::b", op: "IN", values: ["y"] };

  it("scopesOf returns a singleton for a condition leaf", () => {
    expect([...scopesOf(nodeCond)]).toEqual(["node"]);
    expect([...scopesOf(edgeCond)]).toEqual(["edge"]);
  });

  it("scopesOf unions scopes across a binary tree", () => {
    const expr = { kind: "binary", bop: "OR", left: nodeCond, right: edgeCond };
    expect(scopesOf(expr)).toEqual(new Set(["node", "edge"]));
  });

  it("effectiveScope reports mixed for a cross-scope OR", () => {
    const expr = { kind: "binary", bop: "OR", left: nodeCond, right: edgeCond };
    expect(effectiveScope(expr)).toBe("mixed");
  });

  it("renders a cross-scope OR without lint complaints", () => {
    const out = renderAst({
      expr: { kind: "binary", bop: "OR", left: nodeCond, right: edgeCond },
    });
    expect(out).toBe("(Node filters::G::a IN [x]) OR (Edge filters::G::b IN [y])");
  });

  it("rejects cross-scope AND as guaranteed-empty", () => {
    expect(() =>
      renderAst({ expr: { kind: "binary", bop: "AND", left: nodeCond, right: edgeCond } })
    ).toThrow(/disjoint scopes/);
  });

  it("rejects cross-scope NOT (degenerate, silently drops the other scope)", () => {
    expect(() =>
      renderAst({ expr: { kind: "binary", bop: "NOT", left: nodeCond, right: edgeCond } })
    ).toThrow(/disjoint scopes/);
  });

  it("allows same-scope AND/NOT freely", () => {
    const nodeCond2 = { kind: "condition", field: "Node filters::G::c", op: "IN", values: ["z"] };
    expect(() =>
      renderAst({ expr: { kind: "binary", bop: "AND", left: nodeCond, right: nodeCond2 } })
    ).not.toThrow();
    expect(() =>
      renderAst({ expr: { kind: "binary", bop: "NOT", left: nodeCond, right: nodeCond2 } })
    ).not.toThrow();
  });

  it("allows AND/NOT when scopes overlap even if one side is mixed", () => {
    // ((node OR edge) AND node) — scopes overlap on node, so nodes can match.
    // Not "always zero" — the user may have meant this. We allow; if they
    // wanted a stricter check it would belong at a higher lint layer.
    const mixedOr = { kind: "binary", bop: "OR", left: nodeCond, right: edgeCond };
    const nodeC = { kind: "condition", field: "Node filters::G::c", op: "IN", values: ["z"] };
    expect(() =>
      renderAst({ expr: { kind: "binary", bop: "AND", left: mixedOr, right: nodeC } })
    ).not.toThrow();
  });
});

describe("renderQueries — envelope", () => {
  it("renders multiple queries with titles", () => {
    const out = renderQueries({
      queries: [
        {
          title: "High-score nodes",
          scope: "node",
          expr: { kind: "condition", field: "Node filters::G::score", op: "BETWEEN", min: 0.8, max: 1 },
        },
        {
          title: "Strong edges",
          scope: "edge",
          expr: { kind: "condition", field: "Edge filters::G::weight", op: "BETWEEN", min: 0.5, max: 1 },
        },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("(Node filters::G::score BETWEEN 0.8 AND 1)");
    expect(out[0].scope).toBe("node");
    expect(out[1].text).toBe("(Edge filters::G::weight BETWEEN 0.5 AND 1)");
    expect(out[1].scope).toBe("edge");
  });

  it("isolates per-query errors instead of failing the whole batch", () => {
    const out = renderQueries({
      queries: [
        {
          title: "Good",
          expr: { kind: "condition", field: "Node filters::G::a", op: "IN", values: ["x"] },
        },
        {
          title: "Bad — cross-scope AND",
          expr: {
            kind: "binary",
            bop: "AND",
            left: { kind: "condition", field: "Node filters::G::a", op: "IN", values: ["x"] },
            right: { kind: "condition", field: "Edge filters::G::a", op: "IN", values: ["x"] },
          },
        },
      ],
    });
    expect(out[0].text).toBe("(Node filters::G::a IN [x])");
    expect(out[0].error).toBeUndefined();
    expect(out[1].text).toBeNull();
    expect(out[1].error).toMatch(/disjoint scopes/);
  });

  it("fills in a default title when missing or blank", () => {
    const out = renderQueries({
      queries: [
        {
          scope: "node",
          expr: { kind: "condition", field: "Node filters::G::a", op: "IN", values: ["x"] },
        },
      ],
    });
    expect(out[0].title).toBe("Query 1");
  });

  it("throws when the envelope is missing queries array", () => {
    expect(() => renderQueries({})).toThrow(QueryShapeError);
    expect(() => renderQueries(null)).toThrow(QueryShapeError);
  });
});

describe("flattenHierarchy", () => {
  it("returns Section::Group::Name paths in encounter order", () => {
    const hierarchy = {
      "Node filters": {
        Annotation: { "Expression level": {}, Confidence: {} },
        Metrics: { degree: {} },
      },
      "Edge filters": {
        Interaction: { Score: {} },
      },
    };
    expect(flattenHierarchy(hierarchy)).toEqual([
      "Node filters::Annotation::Expression level",
      "Node filters::Annotation::Confidence",
      "Node filters::Metrics::degree",
      "Edge filters::Interaction::Score",
    ]);
  });

  it("ignores unknown top-level sections", () => {
    expect(
      flattenHierarchy({
        "Node filters": { G: { a: {} } },
        Bogus: { Other: { b: {} } },
      })
    ).toEqual(["Node filters::G::a"]);
  });

  it("returns [] for missing or empty hierarchy", () => {
    expect(flattenHierarchy(null)).toEqual([]);
    expect(flattenHierarchy(undefined)).toEqual([]);
    expect(flattenHierarchy({})).toEqual([]);
  });
});

describe("buildQuerySchema", () => {
  it("constrains field to an enum of real hierarchy paths when given a hierarchy", () => {
    const schema = buildQuerySchema({
      "Node filters": { Annotation: { "Expression level": {}, Confidence: {} } },
      "Edge filters": { Interaction: { Score: {} } },
    });
    const field = schema.$defs.Expr.properties.field;
    expect(field.pattern).toBeUndefined();
    expect(field.enum).toEqual([
      "Node filters::Annotation::Expression level",
      "Node filters::Annotation::Confidence",
      "Edge filters::Interaction::Score",
    ]);
  });

  it("falls back to the static pattern-only schema when the hierarchy is missing or empty", () => {
    expect(buildQuerySchema(null)).toBe(QUERY_RESPONSE_SCHEMA);
    expect(buildQuerySchema({})).toBe(QUERY_RESPONSE_SCHEMA);
  });

  it("does not mutate the static schema", () => {
    const before = JSON.stringify(QUERY_RESPONSE_SCHEMA);
    buildQuerySchema({ "Node filters": { G: { a: {} } } });
    expect(JSON.stringify(QUERY_RESPONSE_SCHEMA)).toBe(before);
  });
});
