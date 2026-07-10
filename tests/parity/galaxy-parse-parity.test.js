import { describe, expect, it } from "vitest";
import * as src from "../../shared/galaxy-parse.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { readFixture } from "../helpers/test-data-dir.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadExtensionGalaxyParse() {
  const code = readFileSync(join(__dirname, "../../chrome-extension/lib/galaxy-parse.js"), "utf8");
  const context = {};
  runInNewContext(code, context);
  return context.AstrogameGalaxyParse;
}

const existsPlanets = JSON.parse(readFixture("galaxy-system-sample.json"));

describe("parity: galaxy-parse", () => {
  const ext = loadExtensionGalaxyParse();

  it("parseSystemEntries — aligné", () => {
    const srcEntries = src.parseSystemEntries(1, 23, existsPlanets);
    const extEntries = ext.parseSystemEntries(1, 23, existsPlanets);
    expect(extEntries).toEqual(srcEntries);
  });

  it("groupEntriesByPlayer — aligné", () => {
    const entries = src.parseSystemEntries(1, 23, existsPlanets);
    expect(ext.groupEntriesByPlayer(entries)).toEqual(src.groupEntriesByPlayer(entries));
  });

  it("buildGalaxyPayload — meta cohérente", () => {
    const entries = src.parseSystemEntries(1, 23, existsPlanets);
    const srcPayload = src.buildGalaxyPayload(entries, { source: "test" });
    const extPayload = ext.buildGalaxyPayload(entries, { source: "test" });
    expect(extPayload.meta.planetEntries).toBe(srcPayload.meta.planetEntries);
    expect(extPayload.entries).toEqual(srcPayload.entries);
  });
});
