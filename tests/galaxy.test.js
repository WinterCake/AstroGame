import { describe, expect, it } from "vitest";
import { groupEntriesByPlayer, parseSystemEntries } from "../src/galaxy.js";
import { readFixture } from "./helpers/test-data-dir.js";

const existsPlanets = JSON.parse(readFixture("galaxy-system-sample.json"));

describe("galaxy", () => {
  describe("parseSystemEntries", () => {
    it("parse les slots valides", () => {
      const entries = parseSystemEntries(1, 23, existsPlanets);
      expect(entries).toHaveLength(2);

      const first = entries.find((e) => e.position === 1);
      expect(first.coords).toBe("1:23:1");
      expect(first.username).toBe("Alpha");
      expect(first.activityLabel).toBe("Actif 30m");
      expect(first.planetId).toBe(1001);
    });

    it("inclut alliance et inactif", () => {
      const inactive = parseSystemEntries(1, 23, existsPlanets).find((e) => e.position === 4);
      expect(inactive.inactive).toBe(true);
      expect(inactive.alliance?.tag).toBe("TAG");
      expect(inactive.isAttackableInactive).toBe(true);
    });
  });

  describe("groupEntriesByPlayer", () => {
    it("regroupe les planètes par joueur", () => {
      const entries = parseSystemEntries(1, 23, existsPlanets);
      const players = groupEntriesByPlayer(entries);
      expect(players).toHaveLength(2);
    });
  });
});
