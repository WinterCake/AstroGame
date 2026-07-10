import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  emptyAttacksStore,
  getAttackedTodayCoords,
  getTodayKey,
  mergeAttackRecords,
  normalizeAttacksStore,
} from "../src/attacks-history.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = join(__dirname, "fixtures");

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

describe("attacks-history", () => {
  describe("normalizeAttacksStore", () => {
    it("retourne un store vide si null", () => {
      expect(normalizeAttacksStore(null)).toEqual(emptyAttacksStore());
    });

    it("normalise le format version 1", () => {
      const raw = loadFixture("attacks-store-normalized.json");
      const store = normalizeAttacksStore(raw);
      expect(store.version).toBe(1);
      expect(store.attacks).toHaveLength(2);
      expect(store.attacks[0].coords).toBe("1:23:4");
    });

    it("migre le format legacy coords", () => {
      const raw = loadFixture("attacks-store-legacy.json");
      const store = normalizeAttacksStore(raw);
      expect(store.version).toBe(1);
      expect(store.attacks).toHaveLength(2);
      expect(store.attacks.every((a) => a.source === "legacy")).toBe(true);
    });
  });

  describe("getAttackedTodayCoords", () => {
    it("retourne les coords du jour", () => {
      const today = getTodayKey();
      const store = {
        version: 1,
        attacks: [
          { coords: "1:1:1", at: Date.now(), source: "test" },
          { coords: "2:2:2", at: Date.now() - 86_400_000, source: "test" },
        ],
      };
      const coords = getAttackedTodayCoords(store, today);
      expect(coords.has("1:1:1")).toBe(true);
      expect(coords.has("2:2:2")).toBe(false);
    });
  });

  describe("mergeAttackRecords", () => {
    it("ajoute de nouvelles coords sans doublon le même jour", () => {
      const store = emptyAttacksStore();
      const merged = mergeAttackRecords(store, ["1:1:1", "2:2:2"], { source: "test" });
      expect(merged.attacks).toHaveLength(2);

      const again = mergeAttackRecords(merged, ["1:1:1", "3:3:3"], { source: "test" });
      expect(again.attacks).toHaveLength(3);
      expect(again.attacks.filter((a) => a.coords === "1:1:1")).toHaveLength(1);
    });

    it("ignore les coords vides", () => {
      const merged = mergeAttackRecords(emptyAttacksStore(), ["", "  ", "1:1:1"]);
      expect(merged.attacks).toHaveLength(1);
    });
  });
});
