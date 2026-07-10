import { describe, expect, it } from "vitest";
import {
  filterSpyReports,
  getEffectiveDefense,
  isGrosButinSansDefense,
  isSansDefense,
  isStaleSpyReport,
  mergeSpyReports,
  parseSpyReportsHtml,
  purgeStaleSpyReports,
  summarizeSpyPayload,
} from "../src/spy-reports.js";
import { readFixture } from "./helpers/test-data-dir.js";

const sansDefenseReport = {
  coords: "1:2:3",
  fleet: 0,
  defense: 0,
  loot: 100_000,
  verdict: "Cible intéressante",
  spyData: { "400": { "401": 0, "502": 5000 } },
};

const withDefenseReport = {
  coords: "2:3:4",
  fleet: 0,
  defense: 10_000,
  loot: 50_000,
  verdict: "Défense légère",
  spyData: { "400": { "401": 10000 } },
};

const grosButinReport = {
  coords: "3:4:5",
  fleet: 0,
  defense: 0,
  loot: 600_000_000,
  verdict: "Gros butin",
};

describe("spy-reports", () => {
  describe("parseSpyReportsHtml", () => {
    it("parse une fixture HTML espionnage", () => {
      const html = readFixture("spy-report-sample.html");
      const reports = parseSpyReportsHtml(html);
      expect(reports).toHaveLength(1);
      expect(reports[0].messageId).toBe("12345");
      expect(reports[0].coords).toBe("1:23:4");
      expect(reports[0].username).toBe("Alpha");
      expect(reports[0].loot).toBe(1_000_000);
      expect(isSansDefense(reports[0])).toBe(true);
    });
  });

  describe("isSansDefense / getEffectiveDefense", () => {
    it("ignore les missiles (502/503) pour la défense effective", () => {
      expect(getEffectiveDefense(sansDefenseReport)).toBe(0);
      expect(isSansDefense(sansDefenseReport)).toBe(true);
    });

    it("détecte une défense réelle", () => {
      expect(getEffectiveDefense(withDefenseReport)).toBe(10000);
      expect(isSansDefense(withDefenseReport)).toBe(false);
    });

    it("rejette si flotte présente", () => {
      const report = { ...sansDefenseReport, fleet: 100 };
      expect(isSansDefense(report)).toBe(false);
    });
  });

  describe("isGrosButinSansDefense", () => {
    it("exige sans défense et loot >= 500M", () => {
      expect(isGrosButinSansDefense(grosButinReport)).toBe(true);
      expect(isGrosButinSansDefense({ ...grosButinReport, loot: 100_000 })).toBe(false);
      expect(isGrosButinSansDefense(withDefenseReport)).toBe(false);
    });
  });

  describe("filterSpyReports", () => {
    const reports = [sansDefenseReport, withDefenseReport, grosButinReport];

    it("filtre sans-defense", () => {
      const filtered = filterSpyReports(reports, "sans-defense");
      expect(filtered.map((r) => r.coords)).toEqual(["1:2:3", "3:4:5"]);
    });

    it("filtre gros-butin", () => {
      const filtered = filterSpyReports(reports, "gros-butin");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].coords).toBe("3:4:5");
    });

    it("filtre gros-butin-sans-defense", () => {
      const filtered = filterSpyReports(reports, "gros-butin-sans-defense");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].coords).toBe("3:4:5");
    });
  });

  describe("summarizeSpyPayload", () => {
    it("calcule verdict et coords", () => {
      const payload = {
        targetPlanet: { galaxy: 1, system: 2, planet: 3, id: 99, name: "P1" },
        targetUsername: "player",
        time: 1700000000,
        spyData: {
          "900": { "901": 1000, "902": 2000, "903": 3000 },
          "200": {},
          "400": {},
          "0": { "1": 10 },
        },
      };
      const summary = summarizeSpyPayload(payload, { messageId: "42" });
      expect(summary.coords).toBe("1:2:3");
      expect(summary.loot).toBe(6000);
      expect(summary.verdict).toBe("Cible intéressante");
      expect(summary.metalMine).toBe(10);
    });
  });

  describe("mergeSpyReports", () => {
    it("conserve spyData si incoming incomplet", () => {
      const existing = [
        { messageId: "1", coords: "1:1:1", timestamp: 100, spyData: { "0": { "1": 5 } } },
      ];
      const incoming = [{ messageId: "1", coords: "1:1:1", timestamp: 200, loot: 999 }];
      const merged = mergeSpyReports(existing, incoming);
      expect(merged).toHaveLength(1);
      expect(merged[0].loot).toBe(999);
      expect(merged[0].spyData).toEqual({ "0": { "1": 5 } });
    });

    it("déduplique par coords en gardant le plus récent", () => {
      const existing = [{ messageId: "1", coords: "1:1:1", timestamp: 100 }];
      const incoming = [{ messageId: "2", coords: "1:1:1", timestamp: 200 }];
      const merged = mergeSpyReports(existing, incoming);
      expect(merged).toHaveLength(1);
      expect(merged[0].messageId).toBe("2");
    });
  });

  describe("isStaleSpyReport / purgeStaleSpyReports", () => {
    it("détecte butin incohérent avec points joueur faibles", () => {
      const report = { coords: "1:1:1", planetId: "10", username: "x", loot: 600_000_000 };
      const galaxyEntry = { coords: "1:1:1", planetId: "10", username: "x", points: "100" };
      expect(isStaleSpyReport(report, galaxyEntry)).toBe(true);
    });

    it("purge les rapports obsolètes", () => {
      const data = {
        meta: { totalReports: 2 },
        reports: [
          { coords: "1:1:1", planetId: "10", username: "a", loot: 600_000_000 },
          { coords: "1:1:2", planetId: "11", username: "b", loot: 1000 },
        ],
      };
      const galaxyEntries = [
        { coords: "1:1:1", planetId: "10", username: "a", points: "100" },
        { coords: "1:1:2", planetId: "11", username: "b", points: "50000" },
      ];
      const { data: next, removed } = purgeStaleSpyReports(data, galaxyEntries);
      expect(removed).toEqual(["1:1:1"]);
      expect(next.reports).toHaveLength(1);
      expect(next.reports[0].coords).toBe("1:1:2");
    });
  });
});
