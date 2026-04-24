import { describe, it, expect, vi } from "vitest";
import {
  generateQueries,
  extractPropertyTokens,
  findUnknownProperties,
} from "../src/managers/assistant/query_generator.js";

function makeClient(responses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async generateJson(messages, schema) {
      calls.push({ messages, schema });
      const r = responses[i++];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

function validResponse() {
  return {
    queries: [
      {
        title: "t",
        expr: {
          kind: "condition",
          field: "Node filters::M::a",
          op: "IN",
          values: ["x"],
        },
      },
    ],
  };
}

const baseArgs = {
  graphJson: '{"some":"context"}',
  userQuestion: "show me strong nodes",
  intent: { summary: "nodes with high score", scope: "node" },
};

describe("generateQueries", () => {
  it("returns rendered queries on the first attempt when the AST is valid", async () => {
    const client = makeClient([
      {
        queries: [
          {
            title: "High-score nodes",
            scope: "node",
            expr: {
              kind: "condition",
              field: "Node filters::M::score",
              op: "BETWEEN",
              min: 0.8,
              max: 1,
            },
          },
        ],
      },
    ]);

    const out = await generateQueries({ client, ...baseArgs });
    expect(client.calls).toHaveLength(1);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("(Node filters::M::score BETWEEN 0.8 AND 1)");
    expect(out[0].error).toBeUndefined();
  });

  it("retries once with a repair hint when the first AST is malformed", async () => {
    // Cross-scope AND — guaranteed-empty per GLL, caught by the lint.
    const badResponse = {
      queries: [
        {
          title: "Bad — cross-scope AND",
          expr: {
            kind: "binary",
            bop: "AND",
            left: { kind: "condition", field: "Node filters::M::score", op: "BETWEEN", min: 0, max: 1 },
            right: { kind: "condition", field: "Edge filters::M::weight", op: "BETWEEN", min: 0, max: 1 },
          },
        },
      ],
    };
    const goodResponse = {
      queries: [
        {
          title: "Fixed — OR instead of AND",
          expr: {
            kind: "binary",
            bop: "OR",
            left: { kind: "condition", field: "Node filters::M::score", op: "BETWEEN", min: 0, max: 1 },
            right: { kind: "condition", field: "Edge filters::M::weight", op: "BETWEEN", min: 0, max: 1 },
          },
        },
      ],
    };

    const client = makeClient([badResponse, goodResponse]);
    const out = await generateQueries({ client, ...baseArgs });

    expect(client.calls).toHaveLength(2);
    // The repair call includes the repair_hint block naming the scope problem.
    expect(client.calls[1].messages[1].content).toMatch(/repair_hint/);
    expect(client.calls[1].messages[1].content).toMatch(/disjoint scopes/);
    expect(out[0].text).toBe(
      "(Node filters::M::score BETWEEN 0 AND 1) OR (Edge filters::M::weight BETWEEN 0 AND 1)"
    );
  });

  it("prefers the retry only when it has strictly more valid queries", async () => {
    const firstResponse = {
      queries: [
        {
          title: "ok",
          scope: "node",
          expr: {
            kind: "condition",
            field: "Node filters::M::a",
            op: "IN",
            values: ["x"],
          },
        },
        {
          title: "bad",
          scope: "node",
          expr: {
            kind: "condition",
            field: "Bogus::path",
            op: "IN",
            values: ["x"],
          },
        },
      ],
    };
    // Retry ends up worse (0 valid) — caller should keep the first (1 valid).
    const worseRetry = {
      queries: [
        {
          title: "also bad",
          scope: "node",
          expr: {
            kind: "condition",
            field: "Not::valid",
            op: "IN",
            values: ["x"],
          },
        },
      ],
    };

    const client = makeClient([firstResponse, worseRetry]);
    const out = await generateQueries({ client, ...baseArgs });
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("(Node filters::M::a IN [x])");
    expect(out[1].error).toBeTruthy();
  });

  it("injects previous queries as a refinement hint when provided", async () => {
    const client = makeClient([
      {
        queries: [
          {
            title: "Stricter",
            expr: {
              kind: "condition",
              field: "Node filters::M::score",
              op: "BETWEEN",
              min: 0.9,
              max: 1,
            },
          },
        ],
      },
    ]);
    const out = await generateQueries({
      client,
      ...baseArgs,
      previousQueries: [
        {
          title: "High-score nodes",
          scope: "node",
          text: "(Node filters::M::score BETWEEN 0.5 AND 1)",
        },
      ],
    });
    const userContent = client.calls[0].messages[1].content;
    expect(userContent).toMatch(/<previous_queries>/);
    expect(userContent).toMatch(/Node filters::M::score BETWEEN 0\.5 AND 1/);
    expect(userContent).toMatch(/High-score nodes/);
    expect(out[0].text).toBe("(Node filters::M::score BETWEEN 0.9 AND 1)");
  });

  it("omits the previous_queries block when the list is empty", async () => {
    const client = makeClient([
      {
        queries: [
          {
            title: "t",
            expr: {
              kind: "condition",
              field: "Node filters::M::a",
              op: "IN",
              values: ["x"],
            },
          },
        ],
      },
    ]);
    await generateQueries({ client, ...baseArgs, previousQueries: [] });
    expect(client.calls[0].messages[1].content).not.toMatch(/<previous_queries>/);
  });

  it("drops invalid entries from previous_queries before injecting", async () => {
    const client = makeClient([
      {
        queries: [
          {
            title: "t",
            expr: { kind: "condition", field: "Node filters::M::a", op: "IN", values: ["x"] },
          },
        ],
      },
    ]);
    await generateQueries({
      client,
      ...baseArgs,
      previousQueries: [
        { title: "ok", scope: "node", text: "(A)" },
        { title: "errored", scope: "node", text: null, error: "bad" },
      ],
    });
    const content = client.calls[0].messages[1].content;
    expect(content).toMatch(/ok/);
    expect(content).not.toMatch(/errored/);
  });

  it("retries once silently when the first call throws a transient error", async () => {
    const transient = new Error("Ollama error 502: bad gateway");
    const client = makeClient([transient, validResponse()]);
    const out = await generateQueries({ client, ...baseArgs });
    expect(client.calls).toHaveLength(2);
    expect(out[0].text).toBe("(Node filters::M::a IN [x])");
  });

  it("propagates AbortError without retrying", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const client = makeClient([abort, validResponse()]);
    await expect(generateQueries({ client, ...baseArgs })).rejects.toThrow(/aborted/);
    expect(client.calls).toHaveLength(1);
  });

  it("bubbles the second error when both attempts throw", async () => {
    const client = makeClient([
      new Error("boom 1"),
      new Error("boom 2"),
    ]);
    await expect(generateQueries({ client, ...baseArgs })).rejects.toThrow(/boom 2/);
    expect(client.calls).toHaveLength(2);
  });

  it("passes the schema and system prompt on every call", async () => {
    const client = makeClient([
      {
        queries: [
          {
            title: "t",
            scope: "node",
            expr: {
              kind: "condition",
              field: "Node filters::M::a",
              op: "IN",
              values: ["x"],
            },
          },
        ],
      },
    ]);
    await generateQueries({ client, ...baseArgs });
    const call = client.calls[0];
    expect(call.schema).toBeDefined();
    expect(call.schema.required).toContain("queries");
    expect(call.messages[0].role).toBe("system");
    expect(call.messages[0].content).toMatch(/Query language/i);
    // Intent summary flows through into the user message.
    expect(call.messages[1].content).toMatch(/nodes with high score/);
  });
});

describe("extractPropertyTokens", () => {
  it("finds every Node filters / Edge filters Section::Sub::Name token", () => {
    const text = "(Node filters::Biology::mechanism IN [angiogenesis]) AND (Edge filters::Interaction::Score BETWEEN 0.5 AND 1)";
    const tokens = extractPropertyTokens(text);
    expect(tokens.map(t => t.full)).toEqual([
      "Node filters::Biology::mechanism",
      "Edge filters::Interaction::Score",
    ]);
    expect(tokens[0]).toMatchObject({ section: "Node filters", sub: "Biology", name: "mechanism" });
  });

  it("deduplicates repeated tokens", () => {
    const text = "(Node filters::M::a IN [x]) OR (Node filters::M::a IN [y])";
    expect(extractPropertyTokens(text)).toHaveLength(1);
  });

  it("does not match anything else that happens to contain :: — prefix is locked", () => {
    const text = "Some::Bare::Thing and Other::Thing::Here are not filters";
    expect(extractPropertyTokens(text)).toHaveLength(0);
  });

  it("handles empty / nullish input", () => {
    expect(extractPropertyTokens("")).toEqual([]);
    expect(extractPropertyTokens(null)).toEqual([]);
    expect(extractPropertyTokens(undefined)).toEqual([]);
  });
});

describe("findUnknownProperties", () => {
  const hierarchy = {
    "Node filters": {
      M: { a: { type: "categorical" }, b: { type: "numeric" } },
      Lit: { CAKUT: { type: "numeric" } },
    },
    "Edge filters": {
      Interaction: { Score: { type: "numeric" } },
    },
  };

  it("returns nothing when every token is in the hierarchy", () => {
    const text = "(Node filters::M::a IN [x]) AND (Edge filters::Interaction::Score BETWEEN 0 AND 1)";
    expect(findUnknownProperties(text, hierarchy)).toEqual([]);
  });

  it("flags each token that isn't in the hierarchy", () => {
    const text = "(Node filters::Biology::mechanism IN [ang]) AND (Node filters::Metrics::score BETWEEN 0.62 AND 0.89)";
    const unknown = findUnknownProperties(text, hierarchy);
    expect(unknown).toEqual([
      "Node filters::Biology::mechanism",
      "Node filters::Metrics::score",
    ]);
  });

  it("returns empty when hierarchy is missing — validation disabled", () => {
    const text = "(Node filters::Biology::mechanism IN [ang])";
    expect(findUnknownProperties(text, null)).toEqual([]);
    expect(findUnknownProperties(text, undefined)).toEqual([]);
  });
});

describe("generateQueries hierarchy validation", () => {
  const graphJson = JSON.stringify({
    properties: {
      hierarchy: {
        "Node filters": {
          M: { a: { type: "categorical" } },
        },
      },
    },
  });

  it("errors entries that reference properties outside the hierarchy", async () => {
    const phantomResponse = {
      queries: [
        {
          title: "Phantom",
          expr: {
            kind: "condition",
            field: "Node filters::Biology::mechanism",
            op: "IN",
            values: ["angiogenesis"],
          },
        },
      ],
    };
    // Retry stays phantom so we observe the error surfacing.
    const client = makeClient([phantomResponse, phantomResponse]);

    const out = await generateQueries({
      client,
      graphJson,
      userQuestion: "describe selection",
      intent: { summary: "describe selection", scope: "node" },
    });

    expect(out).toHaveLength(1);
    expect(out[0].text).toBeNull();
    expect(out[0].error).toMatch(/referenced unknown property/);
    expect(out[0].error).toMatch(/Node filters::Biology::mechanism/);
    // Validator error stays terse — the user-facing copy is built by the
    // UI layer from this fact. Policy advisories are not mixed in here.
    expect(out[0].error).not.toMatch(/graph_state\.properties/);
  });

  it("sends a targeted repair hint when unknown properties are detected", async () => {
    const phantomResponse = {
      queries: [
        {
          title: "Phantom",
          expr: {
            kind: "condition",
            field: "Node filters::Biology::mechanism",
            op: "IN",
            values: ["x"],
          },
        },
      ],
    };
    const cleanResponse = {
      queries: [
        {
          title: "Clean",
          expr: {
            kind: "condition",
            field: "Node filters::M::a",
            op: "IN",
            values: ["x"],
          },
        },
      ],
    };
    const client = makeClient([phantomResponse, cleanResponse]);

    const out = await generateQueries({
      client,
      graphJson,
      userQuestion: "describe selection",
      intent: { summary: "describe selection", scope: "node" },
    });

    expect(client.calls).toHaveLength(2);
    const repairCall = client.calls[1].messages[1].content;
    expect(repairCall).toMatch(/repair_hint/);
    expect(repairCall).toMatch(/referenced unknown property/);
    expect(repairCall).toMatch(/REMINDER/);
    expect(out[0].text).toBe("(Node filters::M::a IN [x])");
  });

  it("lets queries through untouched when the graph_state has no hierarchy yet", async () => {
    const phantomResponse = {
      queries: [
        {
          title: "Unverified",
          expr: {
            kind: "condition",
            field: "Node filters::Whatever::field",
            op: "IN",
            values: ["x"],
          },
        },
      ],
    };
    const client = makeClient([phantomResponse]);
    const out = await generateQueries({
      client,
      graphJson: '{"no":"hierarchy"}',
      userQuestion: "q",
      intent: { summary: "q", scope: "node" },
    });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("(Node filters::Whatever::field IN [x])");
    expect(out[0].error).toBeUndefined();
  });
});
