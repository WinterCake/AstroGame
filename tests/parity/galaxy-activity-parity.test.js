import { describe, expect, it } from "vitest";
import { derivePlayerActivity as srcActivity } from "../../shared/galaxy-activity.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadExtensionGalaxyActivity() {
  const code = readFileSync(join(__dirname, "../../chrome-extension/lib/galaxy-activity.js"), "utf8");
  const context = {};
  runInNewContext(code, context);
  return context.AstrogameGalaxyActivity;
}

describe("parity: galaxy-activity", () => {
  const ext = loadExtensionGalaxyActivity();

  it("derivePlayerActivity — inactif et vacances", () => {
    const slot = { user: { class: ["inactive"] }, lastActivity: "" };
    expect(ext.derivePlayerActivity(slot)).toEqual(srcActivity(slot));
  });

  it("derivePlayerActivity — en ligne", () => {
    const slot = { user: { class: [] }, lastActivity: "(*)", lastActivityNum: 0 };
    expect(ext.derivePlayerActivity(slot)).toEqual(srcActivity(slot));
  });
});
