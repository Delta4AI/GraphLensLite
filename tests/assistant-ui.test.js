// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  renderMarkdown,
  checkQueryWarnings,
  appendBubble,
  appendStreamingBubble,
  appendWarningBubble,
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
