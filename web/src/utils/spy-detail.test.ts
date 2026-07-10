import { describe, expect, it } from "vitest";
import type { SpyReport } from "../api/client";
import { formatSpyReportDate, verdictTone } from "./spy-detail";

describe("spy-detail", () => {
  describe("verdictTone", () => {
    it("mappe les verdicts connus", () => {
      expect(verdictTone("Gros butin")).toBe("verdict-loot");
      expect(verdictTone("Cible intéressante")).toBe("verdict-target");
      expect(verdictTone("Flotte présente")).toBe("verdict-fleet");
      expect(verdictTone("Défense lourde")).toBe("verdict-heavy");
      expect(verdictTone("Défense légère")).toBe("verdict-light");
      expect(verdictTone("Peu de ressources")).toBe("verdict-muted");
      expect(verdictTone(undefined)).toBe("verdict-muted");
    });
  });

  describe("formatSpyReportDate", () => {
    it("formate depuis timestamp", () => {
      const report = { timestamp: 1704067200 } as SpyReport;
      const formatted = formatSpyReportDate(report);
      expect(formatted).toMatch(/\d{2}\/\d{2}/);
      expect(formatted).toMatch(/\d{2}:\d{2}/);
    });

    it("utilise dateText en fallback", () => {
      const report = { dateText: "10/03 14:30" } as SpyReport;
      expect(formatSpyReportDate(report)).toBe("10/03 14:30");
    });

    it("retourne tiret si vide", () => {
      expect(formatSpyReportDate({} as SpyReport)).toBe("—");
    });
  });
});
