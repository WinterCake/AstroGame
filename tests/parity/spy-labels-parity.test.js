import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { SPY_ELEMENT_LABELS, SPY_DETAIL_SECTIONS } from "../../shared/spy-labels.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadExtensionSpyLabels() {
  const code = readFileSync(join(__dirname, "../../chrome-extension/spy-labels.js"), "utf8");
  const context = {};
  runInNewContext(code, context);
  return context;
}

describe("parity: spy-labels", () => {
  it("SPY_ELEMENT_LABELS — aligné extension", () => {
    const ext = loadExtensionSpyLabels();
    expect(Object.keys(ext.SPY_ELEMENT_LABELS).length).toBe(Object.keys(SPY_ELEMENT_LABELS).length);
    for (const [id, label] of Object.entries(SPY_ELEMENT_LABELS)) {
      expect(ext.SPY_ELEMENT_LABELS[id]).toBe(label);
    }
  });

  it("SPY_DETAIL_SECTIONS — structure alignée", () => {
    const ext = loadExtensionSpyLabels();
    expect(ext.SPY_DETAIL_SECTIONS).toEqual(SPY_DETAIL_SECTIONS);
  });
});
