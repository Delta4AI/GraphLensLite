import { describe, it, expect } from "vitest";
import { stripSentinelForDisplay, parseIntent, detectProtocolDrift } from "../src/managers/assistant/intent.js";

describe("stripSentinelForDisplay", () => {
  it("returns the text unchanged when no sentinel is present", () => {
    expect(stripSentinelForDisplay("Hello, here is my advice.")).toBe(
      "Hello, here is my advice."
    );
  });

  it("removes a completed sentinel block", () => {
    const input =
      'Filter to high-score nodes.\n<<<QUERY_INTENT>>>{"summary": "s", "scope": "node"}<<<END>>>';
    expect(stripSentinelForDisplay(input)).toBe("Filter to high-score nodes.");
  });

  it("hides a partial sentinel (opening only) during streaming", () => {
    const input = 'Filter to high-score nodes.\n<<<QUERY_INTENT>>>{"sum';
    expect(stripSentinelForDisplay(input)).toBe("Filter to high-score nodes.");
  });

  it("returns empty string for null/undefined", () => {
    expect(stripSentinelForDisplay(null)).toBe("");
    expect(stripSentinelForDisplay(undefined)).toBe("");
  });

  it("removes the empty fenced code block left behind when the model wrapped the sentinel", () => {
    const input =
      'Here is my advice.\n\n```\n<<<QUERY_INTENT>>>{"summary": "x", "scope": "node"}<<<END>>>\n```';
    const stripped = stripSentinelForDisplay(input);
    expect(stripped).toBe("Here is my advice.");
    expect(stripped).not.toMatch(/```/);
  });

  it("tolerates language-tagged fences wrapping the sentinel", () => {
    const input =
      'prose\n\n```json\n<<<QUERY_INTENT>>>{"summary": "x"}<<<END>>>\n```';
    expect(stripSentinelForDisplay(input)).toBe("prose");
  });

  it("tolerates multiple sentinels by stripping the first match", () => {
    const input =
      'prose <<<QUERY_INTENT>>>{"summary": "a"}<<<END>>> more <<<QUERY_INTENT>>>{"summary": "b"}<<<END>>>';
    const stripped = stripSentinelForDisplay(input);
    expect(stripped).not.toContain("<<<QUERY_INTENT>>>");
    expect(stripped).toContain("more");
  });
});

describe("detectProtocolDrift", () => {
  it("returns false when the reply contains a sentinel", () => {
    const input = 'I will do that.\n<<<QUERY_INTENT>>>{"summary":"x"}<<<END>>>';
    expect(detectProtocolDrift(input)).toBe(false);
  });

  it("returns false for a plain conversational reply", () => {
    expect(detectProtocolDrift("Here is how the degree metric works. It counts ..."))
      .toBe(false);
  });

  it("detects a fabricated JSON filter envelope", () => {
    const input = 'Here you go:\n```\n{\n  "filters": ["Node filters::X::Y"]\n}\n```';
    expect(detectProtocolDrift(input)).toBe(true);
  });

  it("detects a JSON query block", () => {
    const input = 'Try this:\n```json\n{\n  "query": { "keywords": ["CAKUT"] }\n}\n```';
    expect(detectProtocolDrift(input)).toBe(true);
  });

  it("detects Mongo-style operator keys", () => {
    const input = '```\n{ "score": { "$gte": 0.5 } }\n```';
    expect(detectProtocolDrift(input)).toBe(true);
  });

  it("detects bare operator keys (gte/lte) as JSON fields", () => {
    const input = '```\n{ "CAKUT": { "gte": 10, "lte": 500 } }\n```';
    expect(detectProtocolDrift(input)).toBe(true);
  });

  it("detects Cytoscape selectors", () => {
    const input = 'Use this:\n```\ncy.nodes(":matches[Pathway:CAKUT]")\n```';
    expect(detectProtocolDrift(input)).toBe(true);
  });

  it("detects SQL-like WHERE clauses against GLL namespaces", () => {
    const input = '```sql\nSELECT * FROM nodes WHERE Node filters::X = 1\n```';
    expect(detectProtocolDrift(input)).toBe(true);
  });

  it("returns false for non-string input", () => {
    expect(detectProtocolDrift(null)).toBe(false);
    expect(detectProtocolDrift(undefined)).toBe(false);
    expect(detectProtocolDrift(123)).toBe(false);
  });
});

describe("parseIntent", () => {
  it("returns null when no sentinel is present", () => {
    expect(parseIntent("just prose, no intent")).toBeNull();
  });

  it("parses a well-formed JSON intent block", () => {
    const input =
      'prose\n<<<QUERY_INTENT>>>{"summary": "nodes where score is high", "scope": "node"}<<<END>>>';
    expect(parseIntent(input)).toEqual({
      summary: "nodes where score is high",
      scope: "node",
    });
  });

  it("accepts summary-only blocks with no scope field", () => {
    const input =
      '<<<QUERY_INTENT>>>{"summary": "something"}<<<END>>>';
    expect(parseIntent(input)).toEqual({
      summary: "something",
      scope: null,
    });
  });

  it("accepts 'mixed' as a scope hint for cross-scope intents", () => {
    const input =
      '<<<QUERY_INTENT>>>{"summary": "nodes of type X or edges of type Y", "scope": "mixed"}<<<END>>>';
    expect(parseIntent(input)).toEqual({ summary: "nodes of type X or edges of type Y", scope: "mixed" });
  });

  it("rejects invalid scope values and falls back to null scope", () => {
    const input =
      '<<<QUERY_INTENT>>>{"summary": "x", "scope": "both"}<<<END>>>';
    expect(parseIntent(input)).toEqual({ summary: "x", scope: null });
  });

  it("tolerates malformed JSON by using the raw body as summary", () => {
    const input = "<<<QUERY_INTENT>>>this is not json<<<END>>>";
    expect(parseIntent(input)).toEqual({
      summary: "this is not json",
      scope: null,
    });
  });

  it("handles an empty sentinel body", () => {
    expect(parseIntent("<<<QUERY_INTENT>>><<<END>>>")).toEqual({
      summary: "",
      scope: null,
    });
  });

  it("returns null for non-strings", () => {
    expect(parseIntent(null)).toBeNull();
    expect(parseIntent(123)).toBeNull();
  });
});
