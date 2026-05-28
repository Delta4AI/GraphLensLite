// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateEndpoint,
  hostLabel,
  isConfigured,
  loadSettings,
  saveSettings,
  SETTINGS_KEY,
  DEFAULTS,
  openSettingsPopup,
} from "../src/managers/assistant/settings.js";

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

describe("isConfigured", () => {
  it("is false when endpoint or model is empty", () => {
    expect(isConfigured({ endpoint: "", model: "" })).toBe(false);
    expect(isConfigured({ endpoint: "http://localhost:11434", model: "" })).toBe(false);
    expect(isConfigured({ endpoint: "", model: "llama3" })).toBe(false);
  });

  it("is false when endpoint is not a valid http(s) URL", () => {
    expect(isConfigured({ endpoint: "not a url", model: "llama3" })).toBe(false);
    expect(isConfigured({ endpoint: "file:///x", model: "llama3" })).toBe(false);
  });

  it("is true when both are present and endpoint is a valid URL", () => {
    expect(isConfigured({ endpoint: "http://localhost:11434", model: "llama3" })).toBe(true);
  });
});

describe("loadSettings / saveSettings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the DEFAULTS object when nothing is stored", () => {
    expect(loadSettings()).toEqual({ ...DEFAULTS });
  });

  it("round-trips endpoint/model/numCtx through localStorage", () => {
    saveSettings({
      endpoint: "http://example.com",
      model: "llama3",
      numCtx: 8192,
    });
    expect(loadSettings()).toEqual({
      endpoint: "http://example.com",
      model: "llama3",
      numCtx: 8192,
    });
  });

  it("ignores malformed JSON and returns the DEFAULTS object", () => {
    localStorage.setItem(SETTINGS_KEY, "{not-json");
    expect(loadSettings()).toEqual({ ...DEFAULTS });
  });

  it("drops legacy fields like maxSnapshotChars silently", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      endpoint: "http://example.com",
      model: "llama3",
      numCtx: 4096,
      maxSnapshotChars: 9999,
      maxHistoryMessages: 50,
      maxStatusLogLines: 99,
    }));
    const s = loadSettings();
    expect(s).toEqual({ endpoint: "http://example.com", model: "llama3", numCtx: 4096 });
    expect(s.maxSnapshotChars).toBeUndefined();
    expect(s.maxHistoryMessages).toBeUndefined();
    expect(s.maxStatusLogLines).toBeUndefined();
  });

  it("falls back to defaults for missing or invalid numCtx", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      endpoint: "http://example.com",
      model: "llama3",
      numCtx: "not a number",
    }));
    const s = loadSettings();
    expect(s.numCtx).toBe(DEFAULTS.numCtx);
  });

  it("coerces a stringified positive integer for numCtx on save", () => {
    saveSettings({
      endpoint: "http://example.com",
      model: "llama3",
      numCtx: "4096",
    });
    expect(loadSettings().numCtx).toBe(4096);
  });
});

describe("openSettingsPopup", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  function findButton(label) {
    return [...document.querySelectorAll("button")].find(b => b.textContent === label);
  }
  function saveButton() {
    // Works in both 'setup' and 'edit' modes.
    return findButton("Finish setup") || findButton("Save");
  }
  function endpointInput() {
    return document.querySelectorAll("input[type=text]")[0];
  }
  function modelInput() {
    return document.querySelectorAll("input[type=text]")[1];
  }
  function statusEl() {
    return document.querySelector(".assistant-settings-status");
  }
  function listbox() {
    return document.querySelector("select");
  }
  async function flush() {
    await new Promise(r => setTimeout(r, 0));
  }

  function open({ endpoint = "http://localhost:11434", model = "llama3", mode = "edit", probe, onSave = vi.fn(), onCancel = vi.fn() } = {}) {
    openSettingsPopup({ endpoint, model, mode, probe, onSave, onCancel });
    return { onSave, onCancel };
  }

  it("renders immediately even when the initial probe is pending", () => {
    const probe = vi.fn(() => new Promise(() => {})); // never resolves
    open({ probe });
    expect(saveButton()).toBeTruthy();
    expect(findButton("Cancel")).toBeTruthy();
    expect(findButton("Verify")).toBeTruthy();
    expect(listbox()).toBeTruthy();
    // Save is disabled until we have both a green verification AND a model.
    expect(saveButton().disabled).toBe(true);
  });

  it("unlocks model picker and enables Save after a successful initial probe", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3", "qwen"] }));
    open({ probe });
    await flush();

    expect(statusEl().dataset.kind).toBe("ok");
    expect(statusEl().textContent).toMatch(/Connected to localhost:11434/);
    expect(modelInput().disabled).toBe(false);
    expect(listbox().disabled).toBe(false);
    const values = [...listbox().options].map(o => o.value);
    expect(values).toEqual(["llama3", "qwen"]);
    // Pre-filled model + green probe → Save is ready.
    expect(saveButton().disabled).toBe(false);
  });

  it("shows error state and keeps model picker disabled when initial probe fails", async () => {
    const probe = vi.fn(async () => ({ ok: false, error: "refused" }));
    open({ probe });
    await flush();

    expect(statusEl().dataset.kind).toBe("error");
    expect(statusEl().textContent).toMatch(/Cannot reach/);
    expect(statusEl().textContent).toMatch(/refused/);
    expect(modelInput().disabled).toBe(true);
    expect(listbox().disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
  });

  it("onSave receives the normalized endpoint, model, and default numCtx when untouched", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3"] }));
    const { onSave } = open({ endpoint: "http://localhost:11434/", probe });
    await flush();

    saveButton().click();
    await flush();

    expect(onSave).toHaveBeenCalledWith({
      endpoint: "http://localhost:11434",
      model: "llama3",
      numCtx: DEFAULTS.numCtx,
    });
  });

  it("onSave carries an edited numCtx", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3"] }));
    const { onSave } = open({ probe });
    await flush();

    const numInputs = [...document.querySelectorAll('input[type="number"]')];
    expect(numInputs).toHaveLength(1);
    numInputs[0].value = "8192";

    saveButton().click();
    await flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].numCtx).toBe(8192);
  });

  it("onSave silently normalises an invalid numCtx back to the default", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3"] }));
    const { onSave } = open({ probe });
    await flush();

    const numInputs = [...document.querySelectorAll('input[type="number"]')];
    numInputs[0].value = "-5";

    saveButton().click();
    await flush();

    expect(onSave.mock.calls[0][0].numCtx).toBe(DEFAULTS.numCtx);
  });

  it("editing the URL invalidates the verification and disables Save", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3"] }));
    open({ probe });
    await flush();
    expect(saveButton().disabled).toBe(false);

    endpointInput().value = "http://other:1234";
    endpointInput().dispatchEvent(new Event("input"));

    expect(saveButton().disabled).toBe(true);
    expect(modelInput().disabled).toBe(true);
  });

  it("explicit Verify click re-probes and re-enables the model picker on success", async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "refused" })
      .mockResolvedValueOnce({ ok: true, models: ["llama3"] });
    open({ probe });
    await flush();
    expect(modelInput().disabled).toBe(true);

    findButton("Verify").click();
    await flush();

    expect(modelInput().disabled).toBe(false);
    expect(statusEl().dataset.kind).toBe("ok");
  });

  it("flags a syntactically invalid URL without calling probe", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: [] }));
    open({ probe });
    await flush();
    probe.mockClear();

    endpointInput().value = "not a url";
    endpointInput().dispatchEvent(new Event("input"));
    findButton("Verify").click();
    await flush();

    expect(probe).not.toHaveBeenCalled();
    expect(statusEl().dataset.kind).toBe("error");
    expect(statusEl().textContent).toMatch(/valid URL/);
    expect(saveButton().disabled).toBe(true);
  });

  it("filters the listbox as the user types in the model input", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3", "qwen", "llama-guard"] }));
    open({ probe });
    await flush();

    modelInput().value = "llama";
    modelInput().dispatchEvent(new Event("input"));

    const values = [...listbox().options].map(o => o.value);
    expect(values).toEqual(["llama3", "llama-guard"]);
  });

  it("copies listbox selection into the model input on change", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3", "qwen"] }));
    open({ probe });
    await flush();

    listbox().value = "qwen";
    listbox().dispatchEvent(new Event("change"));

    expect(modelInput().value).toBe("qwen");
    expect(saveButton().disabled).toBe(false);
  });

  it("setup mode shows intro copy and a distinct primary label", async () => {
    const probe = vi.fn(() => new Promise(() => {}));
    open({ endpoint: "", model: "", mode: "setup", probe });
    expect(document.querySelector(".assistant-settings-intro")).toBeTruthy();
    expect(findButton("Finish setup")).toBeTruthy();
    expect(findButton("Save")).toBeFalsy();
  });

  it("edit mode has no intro copy and uses the default Save label", async () => {
    const probe = vi.fn(() => new Promise(() => {}));
    open({ mode: "edit", probe });
    expect(document.querySelector(".assistant-settings-intro")).toBeFalsy();
    expect(findButton("Save")).toBeTruthy();
    expect(findButton("Finish setup")).toBeFalsy();
  });

  it("Cancel invokes onCancel and does not call onSave", async () => {
    const probe = vi.fn(async () => ({ ok: true, models: ["llama3"] }));
    const { onSave, onCancel } = open({ probe });
    await flush();

    findButton("Cancel").click();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});
