// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { validateEndpoint, hostLabel, openSettingsPopup } from "../src/managers/assistant/settings.js";

describe("validateEndpoint", () => {
  it("accepts http URLs and flags localhost as local", () => {
    const r = validateEndpoint("http://localhost:11434");
    expect(r).toMatchObject({ ok: true, isLocal: true, host: "localhost:11434" });
  });

  it("accepts https URLs on public hosts and flags them non-local", () => {
    const r = validateEndpoint("https://example.com/api");
    expect(r.ok).toBe(true);
    expect(r.isLocal).toBe(false);
  });

  it("treats 127.0.0.1 and ::1 and private ranges as local", () => {
    expect(validateEndpoint("http://127.0.0.1:11434").isLocal).toBe(true);
    expect(validateEndpoint("http://[::1]:11434").isLocal).toBe(true);
    expect(validateEndpoint("http://10.0.0.5:11434").isLocal).toBe(true);
    expect(validateEndpoint("http://192.168.1.7:11434").isLocal).toBe(true);
    expect(validateEndpoint("http://172.16.0.1:11434").isLocal).toBe(true);
  });

  it("treats *.local hostnames (mDNS) as local", () => {
    expect(validateEndpoint("http://workstation.local:11434").isLocal).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateEndpoint("file:///etc/passwd").ok).toBe(false);
    expect(validateEndpoint("javascript:alert(1)").ok).toBe(false);
    expect(validateEndpoint("data:text/html,<script>").ok).toBe(false);
    expect(validateEndpoint("ftp://example.com").ok).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(validateEndpoint("not a url").ok).toBe(false);
    expect(validateEndpoint("").ok).toBe(false);
  });

  it("strips trailing slash from normalized value", () => {
    expect(validateEndpoint("http://localhost:11434/").normalized).toBe("http://localhost:11434");
  });
});

describe("hostLabel", () => {
  it("returns host[:port] for valid URLs", () => {
    expect(hostLabel("http://localhost:11434")).toBe("localhost:11434");
    expect(hostLabel("https://example.com/api")).toBe("example.com");
  });

  it("falls back to the input string for invalid URLs", () => {
    expect(hostLabel("not a url")).toBe("not a url");
  });
});

describe("openSettingsPopup", () => {
  function findButton(label) {
    return [...document.querySelectorAll("button")].find(b => b.textContent === label);
  }

  function findEndpointInput() {
    return [...document.querySelectorAll("input[type=text]")][0];
  }

  function findEndpointHint() {
    return document.querySelector("small");
  }

  async function flush() {
    await new Promise(r => setTimeout(r, 0));
  }

  function openFreshPopup(probe, { onSave = vi.fn(), onCancel = vi.fn() } = {}) {
    document.body.innerHTML = "";
    openSettingsPopup({
      endpoint: "http://localhost:11434",
      model: "llama3",
      probe,
      onSave,
      onCancel,
    });
    return { onSave, onCancel };
  }

  it("renders immediately even when probe is pending", () => {
    const probe = vi.fn(() => new Promise(() => {})); // never resolves
    openFreshPopup(probe);
    // Save / Cancel are reachable synchronously — the modal didn't block.
    expect(findButton("Save")).toBeTruthy();
    expect(findButton("Cancel")).toBeTruthy();
    // Filter input + scrollable listbox with size > 1; hint shows loading state.
    const filterInput = [...document.querySelectorAll("input[type=text]")][1];
    expect(filterInput).toBeTruthy();
    const listbox = document.querySelector("select");
    expect(listbox.size).toBeGreaterThan(1);
    const hints = [...document.querySelectorAll('small')].map(s => s.textContent);
    expect(hints).toContain('Loading models…');
  });

  it("calls onSave with normalized endpoint when probe succeeds", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3", "qwen"] }));
    const { onSave } = openFreshPopup(probe);
    await flush();

    findButton("Save").click();
    await flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ endpoint: "http://localhost:11434", model: "llama3" });
  });

  it("keeps modal open and shows inline error when probe fails on save", async () => {
    // First probe (initial population) succeeds; Save-time probe fails.
    const probe = vi.fn()
      .mockResolvedValueOnce({ ok: true, models: ["llama3"] })
      .mockResolvedValueOnce({ ok: false, error: "timed out" });
    const { onSave } = openFreshPopup(probe);
    await flush();

    findButton("Save").click();
    await flush();

    expect(onSave).not.toHaveBeenCalled();
    expect(findEndpointHint().textContent).toMatch(/Cannot reach/);
    expect(findEndpointHint().textContent).toMatch(/timed out/);
    // Save button is restored so the user can retry after editing.
    expect(findButton("Save").disabled).toBe(false);
  });

  it("rejects garbage URLs without calling probe", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: [] }));
    const { onSave } = openFreshPopup(probe);
    await flush();

    findEndpointInput().value = "not a url";
    // Reset the call counter so we only observe the Save-time calls.
    probe.mockClear();
    findButton("Save").click();
    await flush();

    expect(probe).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    expect(findEndpointHint().textContent).toMatch(/valid URL/);
  });

  it("shows 'unreachable' hint and empty listbox when initial probe fails", async () => {
    const probe = vi.fn(async () => ({ ok: false, error: "refused" }));
    openFreshPopup(probe);
    await flush();

    const listbox = document.querySelector("select");
    expect(listbox.options.length).toBe(0);
    const hints = [...document.querySelectorAll('small')].map(s => s.textContent);
    expect(hints.some(t => /unreachable/i.test(t))).toBe(true);
  });

  it("populates the listbox from successful probe", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3", "qwen", "mistral"] }));
    openFreshPopup(probe);
    await flush();

    const listbox = document.querySelector("select");
    const values = [...listbox.options].map(o => o.value);
    expect(values).toEqual(["llama3", "qwen", "mistral"]);
    const hints = [...document.querySelectorAll('small')].map(s => s.textContent);
    expect(hints.some(t => /3 models available/.test(t))).toBe(true);
  });

  it("filters the listbox as the user types in the input", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3", "qwen", "llama-guard"] }));
    openFreshPopup(probe);
    await flush();

    const filterInput = [...document.querySelectorAll("input[type=text]")][1];
    filterInput.value = "llama";
    filterInput.dispatchEvent(new Event("input"));

    const listbox = document.querySelector("select");
    const values = [...listbox.options].map(o => o.value);
    expect(values).toEqual(["llama3", "llama-guard"]);
  });

  it("copies listbox selection into the input on change", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3", "qwen"] }));
    openFreshPopup(probe);
    await flush();

    const listbox = document.querySelector("select");
    listbox.value = "qwen";
    listbox.dispatchEvent(new Event("change"));

    const filterInput = [...document.querySelectorAll("input[type=text]")][1];
    expect(filterInput.value).toBe("qwen");
  });
});
