import { describe, expect, it } from "vitest";
import { cn, formatAmount, formatMissionTime } from "./format";

describe("format", () => {
  describe("formatAmount", () => {
    it("formate les grandes valeurs", () => {
      expect(formatAmount(1_500_000_000)).toBe("1.5 Md");
      expect(formatAmount(2_500_000)).toBe("2.5 M");
      expect(formatAmount(12_000)).toBe("12.0 k");
    });

    it("formate les petites valeurs en locale fr", () => {
      expect(formatAmount(999)).toBe("999");
      expect(formatAmount(null)).toBe("0");
    });
  });

  describe("formatMissionTime", () => {
    it("retourne tiret si absent", () => {
      expect(formatMissionTime(null)).toBe("—");
      expect(formatMissionTime(undefined)).toBe("—");
    });

    it("formate une date", () => {
      const formatted = formatMissionTime(1704067200000);
      expect(formatted).toMatch(/\d{2}\/\d{2}/);
    });
  });

  describe("cn", () => {
    it("joint les classes truthy", () => {
      expect(cn("a", false, null, "b", undefined, "c")).toBe("a b c");
    });
  });
});
