// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  renderMarkdown,
  ensureTableSeparators,
  checkQueryWarnings,
  appendBubble,
  appendStreamingBubble,
  appendWarningBubble,
  appendQueriesPanel,
  renderQueriesIntoPanel,
  renderQueriesError,
  formatInvalidQueryError,
} from "../src/managers/assistant/ui.js";

describe("renderMarkdown", () => {
  it("renders basic markdown to HTML", () => {
    const html = renderMarkdown("**hi** `x`\n\n- a\n- b");
    expect(html).toMatch(/<strong>hi<\/strong>/);
    expect(html).toMatch(/<code[^>]*>x<\/code>/);
    expect(html).toMatch(/<li>a<\/li>/);
  });

  it("strips <script> tags from LLM output", () => {
    const html = renderMarkdown("Hello <script>alert(1)</script> world");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/alert\(1\)/);
  });

  it("strips inline event handlers", () => {
    const html = renderMarkdown('<a href="https://x" onclick="alert(1)">go</a>');
    expect(html).not.toMatch(/onclick/i);
  });

  it("rejects javascript: URLs", () => {
    const html = renderMarkdown('<a href="javascript:alert(1)">go</a>');
    expect(html).not.toMatch(/javascript:/i);
  });

  it("adds rel=noopener and target=_blank to anchors", () => {
    const html = renderMarkdown('[go](https://example.com)');
    expect(html).toMatch(/rel="noopener noreferrer"/);
    expect(html).toMatch(/target="_blank"/);
  });

  it("returns empty string for null/undefined", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown(null)).toBe("");
    expect(renderMarkdown(undefined)).toBe("");
  });

  it("wraps every fenced code block and injects a Copy button", () => {
    const html = renderMarkdown("see below\n\n```\necho hi\n```\n\nand also\n\n```js\nconst x = 1\n```");
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const blocks = holder.querySelectorAll("div.assistant-code-block");
    expect(blocks.length).toBe(2);
    // Each wrapper contains exactly one <pre> and one copy button, and the
    // button is a sibling of the <pre> (not inside it) so horizontal scroll
    // of the pre doesn't drag the button with it.
    for (const block of blocks) {
      expect(block.querySelectorAll("pre").length).toBe(1);
      const btn = block.querySelector(":scope > .assistant-copy-btn");
      expect(btn).toBeTruthy();
      expect(btn.querySelector(".assistant-copy-btn-label").textContent).toBe("Copy");
    }
  });

  it("marks inline code as click-to-copy without adding a button", () => {
    const html = renderMarkdown("try `inline` code");
    const holder = document.createElement("div");
    holder.innerHTML = html;
    expect(holder.querySelectorAll(".assistant-copy-btn").length).toBe(0);
    const inline = holder.querySelector("code.assistant-inline-copy");
    expect(inline).toBeTruthy();
    expect(inline.getAttribute("title")).toBe("Click to copy");
  });

  it("does not mark code inside a fenced block as inline-copy", () => {
    const html = renderMarkdown("```\necho hi\n```");
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const inline = holder.querySelector("code.assistant-inline-copy");
    expect(inline).toBeNull();
  });
});

describe("checkQueryWarnings", () => {
  it("returns no warnings when no code blocks are present", () => {
    expect(checkQueryWarnings("just prose, no code")).toEqual([]);
  });

  it("flags queries that mix Node and Edge filters", () => {
    const resp = "```\nNode filters::G::a IN [x] AND Edge filters::G::b IN [y]\n```";
    const w = checkQueryWarnings(resp);
    expect(w.some(m => m.includes("Node filters and Edge filters"))).toBe(true);
  });

  it("flags quoted values inside IN [...]", () => {
    const resp = "```\nNode filters::G::a IN ['x']\n```";
    const w = checkQueryWarnings(resp);
    expect(w.some(m => m.includes("Quoted values"))).toBe(true);
  });

  it("flags forbidden comparison operators", () => {
    const resp = "```\nNode filters::G::a = x\n```";
    const w = checkQueryWarnings(resp);
    expect(w.some(m => m.includes("Unsupported operator"))).toBe(true);
  });

  it("deduplicates warnings across multiple blocks", () => {
    const resp = "```\nX IN ['a']\n```\n```\nY IN ['b']\n```";
    const w = checkQueryWarnings(resp);
    expect(w.filter(m => m.includes("Quoted values"))).toHaveLength(1);
  });

  it("handles non-string input safely", () => {
    expect(checkQueryWarnings(null)).toEqual([]);
    expect(checkQueryWarnings(undefined)).toEqual([]);
  });
});

describe("bubble helpers", () => {
  it("appendBubble uses textContent (never innerHTML) for user text", () => {
    const container = document.createElement("div");
    const el = appendBubble("user", "<img src=x onerror=alert(1)>", container);
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("appendStreamingBubble creates an empty markdown-capable bubble", () => {
    const container = document.createElement("div");
    const el = appendStreamingBubble(container);
    expect(el.classList.contains("assistant-bubble-streaming")).toBe(true);
    expect(el.classList.contains("assistant-bubble-markdown")).toBe(true);
  });

  it("appendWarningBubble joins warnings and returns null when empty", () => {
    const container = document.createElement("div");
    expect(appendWarningBubble([], container)).toBeNull();
    const el = appendWarningBubble(["a", "b"], container);
    expect(el.textContent).toBe("a\nb");
  });
});

describe("suggested queries panel", () => {
  it("appendQueriesPanel starts with a Generating placeholder", () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    expect(panel.classList.contains("assistant-bubble-queries")).toBe(true);
    expect(panel.querySelector(".assistant-queries-placeholder")).toBeTruthy();
    expect(panel.textContent).toMatch(/Generating query/);
  });

  it("renderQueriesIntoPanel replaces the placeholder with cards per valid entry", () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    renderQueriesIntoPanel(panel, [
      { title: "High-score nodes", scope: "node", text: "(Node filters::M::score BETWEEN 0.5 AND 1)" },
      { title: "Strong edges", scope: "edge", text: "(Edge filters::M::weight BETWEEN 0.5 AND 1)" },
      { title: "Anything relevant", scope: "mixed", text: "(Node filters::M::a IN [x]) OR (Edge filters::M::b IN [y])" },
    ], { onOpen: () => {} });

    expect(panel.querySelector(".assistant-queries-placeholder")).toBeNull();
    const cards = panel.querySelectorAll(".assistant-query-card");
    expect(cards.length).toBe(3);
    expect(cards[0].querySelector(".assistant-query-title").textContent).toBe("High-score nodes (nodes)");
    expect(cards[1].querySelector(".assistant-query-title").textContent).toBe("Strong edges (edges)");
    expect(cards[2].querySelector(".assistant-query-title").textContent).toBe("Anything relevant (nodes + edges)");
    expect(cards[0].querySelector(".assistant-query-text code").textContent)
      .toBe("(Node filters::M::score BETWEEN 0.5 AND 1)");
  });

  it("renderQueriesIntoPanel fires onOpen with the entry text when clicked", () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    const opened = [];
    renderQueriesIntoPanel(panel, [
      { title: "t", scope: "node", text: "(X)" },
    ], { onOpen: (entry) => opened.push(entry.text) });

    const openBtn = panel.querySelector(".assistant-query-open");
    openBtn.click();
    expect(opened).toEqual(["(X)"]);
  });

  it("renderQueriesIntoPanel fires onSelect with the entry text when clicked", async () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    const selected = [];
    renderQueriesIntoPanel(panel, [
      { title: "t", scope: "node", text: "(Y)" },
    ], { onSelect: (entry) => { selected.push(entry.text); } });

    const selectBtn = panel.querySelector(".assistant-query-select");
    expect(selectBtn).toBeTruthy();
    selectBtn.click();
    // click handler is async; drain the microtask queue
    await Promise.resolve();
    await Promise.resolve();
    expect(selected).toEqual(["(Y)"]);
  });

  it("renderQueriesIntoPanel omits optional buttons when callbacks are not supplied", () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    renderQueriesIntoPanel(panel, [
      { title: "t", scope: "node", text: "(X)" },
    ], {});
    expect(panel.querySelector(".assistant-query-open")).toBeNull();
    expect(panel.querySelector(".assistant-query-select")).toBeNull();
    expect(panel.querySelector(".assistant-query-copy")).toBeTruthy();
  });

  it("renders Select and Open side-by-side when both callbacks are supplied", () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    renderQueriesIntoPanel(panel, [
      { title: "t", scope: "node", text: "(X)" },
    ], { onOpen: () => {}, onSelect: () => {} });
    const card = panel.querySelector(".assistant-query-card");
    const btns = card.querySelectorAll(".assistant-query-btn");
    // Order: Copy, Select, Open
    expect(btns.length).toBe(3);
    expect(btns[0].classList.contains("assistant-query-copy")).toBe(true);
    expect(btns[1].classList.contains("assistant-query-select")).toBe(true);
    expect(btns[2].classList.contains("assistant-query-open")).toBe(true);
  });

  it("renderQueriesIntoPanel shows an error when every entry failed to render", () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    renderQueriesIntoPanel(panel, [
      { title: "t", scope: "node", text: null, error: "something broke" },
    ], { onOpen: () => {} });

    expect(panel.querySelector(".assistant-query-card")).toBeNull();
    const errEl = panel.querySelector(".assistant-queries-error");
    expect(errEl.textContent).toMatch(/something broke/);
  });

  it("renderQueriesIntoPanel removes the panel entirely when the generator returned zero entries", () => {
    // This happens when the chat model wrongly emitted a sentinel on a
    // descriptive follow-up ("tell me more about them") — call 2 correctly
    // returns {queries: []}, and we don't want a noisy "No queries produced"
    // bubble hanging around.
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    expect(container.contains(panel)).toBe(true);

    renderQueriesIntoPanel(panel, [], { onOpen: () => {} });

    expect(container.contains(panel)).toBe(false);
  });

  it("renderQueriesIntoPanel appends a note when some entries dropped alongside valid ones", () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    renderQueriesIntoPanel(panel, [
      { title: "ok", scope: "node", text: "(X)" },
      { title: "bad", scope: "node", text: null, error: "nope" },
    ], { onOpen: () => {} });
    expect(panel.querySelector(".assistant-query-card")).toBeTruthy();
    expect(panel.querySelector(".assistant-queries-note")).toBeTruthy();
    expect(panel.querySelector(".assistant-queries-note").textContent).toMatch(/1 additional suggestion/);
  });

  it("renderQueriesError replaces the panel body with the error message", () => {
    const container = document.createElement("div");
    const panel = appendQueriesPanel(container);
    renderQueriesError(panel, "Backend unreachable.");
    expect(panel.querySelector(".assistant-queries-placeholder")).toBeNull();
    expect(panel.querySelector(".assistant-queries-error").textContent)
      .toBe("Backend unreachable.");
  });
});

describe("formatInvalidQueryError", () => {
  it("singular hallucinated property — names it and points to the sidebar", () => {
    const out = formatInvalidQueryError("referenced unknown property: Node filters::Biology::mechanism");
    expect(out).toMatch(/invented a property name/i);
    expect(out).toMatch(/Node filters::Biology::mechanism/);
    expect(out).toMatch(/sidebar|Query Editor/);
    // Does not leak model-facing policy jargon.
    expect(out).not.toMatch(/graph_state\.properties/);
  });

  it("plural hallucinated properties — pluralises noun and keeps all names", () => {
    const out = formatInvalidQueryError(
      "referenced unknown properties: Node filters::Biology::mechanism, Node filters::Metrics::score"
    );
    expect(out).toMatch(/invented property names/i);
    expect(out).toMatch(/Node filters::Biology::mechanism/);
    expect(out).toMatch(/Node filters::Metrics::score/);
  });

  it("non-hallucination errors fall back to a friendly wrapper that keeps the fact", () => {
    const out = formatInvalidQueryError("cross-scope AND is forbidden (returns zero results)");
    expect(out).toMatch(/Couldn’t generate a valid query/);
    expect(out).toMatch(/cross-scope AND is forbidden/);
    expect(out).toMatch(/rephrasing/);
  });

  it("empty / missing error yields a generic but actionable message", () => {
    for (const v of [null, undefined, "", "   "]) {
      const out = formatInvalidQueryError(v);
      expect(out).toMatch(/Couldn’t generate a valid query/);
      expect(out).toMatch(/rephrasing/);
    }
  });
});

describe("ensureTableSeparators", () => {
  it("inserts a separator row when the model forgot it", () => {
    const input = [
      "| Node | Score |",
      "| IL6 | 350 |",
      "| PAX2 | 25 |",
    ].join("\n");
    const out = ensureTableSeparators(input);
    const lines = out.split("\n");
    expect(lines[0]).toBe("| Node | Score |");
    expect(lines[1]).toMatch(/^\|\s*-{3,}\s*\|\s*-{3,}\s*\|$/);
    expect(lines[2]).toBe("| IL6 | 350 |");
  });

  it("leaves well-formed tables untouched", () => {
    const input = [
      "| Node | Score |",
      "| ---- | ----- |",
      "| IL6  | 350   |",
    ].join("\n");
    expect(ensureTableSeparators(input)).toBe(input);
  });

  it("end-to-end: missing-separator tables render as <table> after patch", () => {
    const html = renderMarkdown("| Node | Score |\n| IL6 | 350 |\n| PAX2 | 25 |");
    expect(html).toMatch(/<table/i);
    expect(html).toMatch(/<th[^>]*>\s*Node\s*<\/th>/i);
    expect(html).toMatch(/<td[^>]*>\s*IL6\s*<\/td>/i);
  });

  it("doesn't inject a separator into prose that happens to contain pipes", () => {
    const input = "Use `a | b` to denote alternatives.\nNext sentence here.";
    expect(ensureTableSeparators(input)).toBe(input);
  });

  it("handles a single blank line between header and body", () => {
    const input = "| Node | Score |\n\n| IL6 | 350 |";
    const out = ensureTableSeparators(input);
    expect(out.split("\n").some(l => /^\|\s*-{3,}\s*\|\s*-{3,}\s*\|$/.test(l))).toBe(true);
  });

  it("is a no-op for empty or nullish input", () => {
    expect(ensureTableSeparators("")).toBe("");
    expect(ensureTableSeparators(null)).toBe(null);
    expect(ensureTableSeparators(undefined)).toBe(undefined);
  });
});
