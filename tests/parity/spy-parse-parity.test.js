import { describe, expect, it } from "vitest";
import * as srcSpy from "../../shared/spy-core.js";
import { loadExtensionSpyCore } from "../helpers/load-extension-spy-parse.js";
import { verdictClass } from "../../shared/verdict.js";

const sampleReports = [
  {
    coords: "1:2:3",
    fleet: 0,
    defense: 0,
    loot: 600_000_000,
    verdict: "Gros butin",
    spyData: { "400": { "502": 1000 } },
  },
  {
    coords: "2:3:4",
    fleet: 0,
    defense: 5000,
    loot: 100_000,
    verdict: "Défense légère",
    spyData: { "400": { "401": 5000 } },
  },
  {
    coords: "3:4:5",
    fleet: 100,
    defense: 0,
    loot: 50_000,
    verdict: "Flotte présente",
  },
];

const samplePayload = {
  targetPlanet: { galaxy: 7, system: 89, planet: 12, id: 555, name: "Target" },
  targetUsername: "enemy",
  time: 1700000000,
  spyData: {
    "900": { "901": 100_000_000, "902": 200_000_000, "903": 200_000_000 },
    "200": {},
    "400": { "502": 9999 },
    "0": { "1": 20, "2": 15 },
  },
};

describe("parity: shared vs extension lib (spy-core)", () => {
  const ext = loadExtensionSpyCore();

  it("isSansDefense — même résultat", () => {
    for (const report of sampleReports) {
      expect(ext.isSansDefense(report)).toBe(srcSpy.isSansDefense(report));
    }
  });

  it("filterSpyReports — mêmes coords", () => {
    const filters = ["sans-defense", "gros-butin", "gros-butin-sans-defense"];
    for (const filter of filters) {
      const srcCoords = srcSpy.filterSpyReports(sampleReports, filter).map((r) => r.coords).sort();
      const extCoords = ext.filterSpyReports(sampleReports, filter).map((r) => r.coords).sort();
      expect(extCoords).toEqual(srcCoords);
    }
  });

  it("summarizeSpyPayload — aligné", () => {
    const srcSummary = srcSpy.summarizeSpyPayload(samplePayload, { messageId: "99" });
    const extSummary = ext.summarizeSpyPayload(samplePayload, { messageId: "99" });
    expect(extSummary.coords).toBe(srcSummary.coords);
    expect(extSummary.loot).toBe(srcSummary.loot);
    expect(extSummary.verdict).toBe(srcSummary.verdict);
  });

  it("mergeSpyReports — même déduplication", () => {
    const existing = [{ messageId: "1", coords: "1:1:1", timestamp: 100 }];
    const incoming = [{ messageId: "2", coords: "1:1:1", timestamp: 200 }];
    const srcMerged = srcSpy.mergeSpyReports(existing, incoming);
    const extMerged = ext.mergeSpyReports(existing, incoming);
    expect(extMerged[0].messageId).toBe(srcMerged[0].messageId);
  });

  it("verdictClass — classes CSS cohérentes", () => {
    for (const verdict of ["Gros butin", "Défense légère", "Peu de ressources"]) {
      expect(verdictClass(verdict)).toMatch(/^verdict-/);
    }
  });
});
