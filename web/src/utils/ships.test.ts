import { describe, expect, it } from "vitest";
import {
  formatPlanetShipsDetail,
  formatPlanetShipsLabel,
  normalizeShipId,
  parsePlanetShips,
} from "./ships";

describe("ships", () => {
  it("normalise les ids shipXXX", () => {
    expect(normalizeShipId("ship202")).toBe("202");
    expect(normalizeShipId(210)).toBe("210");
  });

  it("parse et trie les vaisseaux planète", () => {
    expect(parsePlanetShips({ ship210: 5, ship202: 2000, ship207: 0 })).toEqual([
      { id: "202", count: 2000, shortLabel: "PT", name: "Petit transporteur" },
      { id: "210", count: 5, shortLabel: "Sonde", name: "Sonde d'espionnage" },
    ]);
  });

  it("formate le label court et le détail tooltip", () => {
    const ships = { ship202: 2000, ship210: 12 };
    expect(formatPlanetShipsLabel(ships)).toBe("2 000 PT + 12 Sonde");
    expect(formatPlanetShipsDetail(ships)).toBe(
      "2 000 Petit transporteur\n12 Sonde d'espionnage"
    );
  });

  it("retourne null si aucun vaisseau", () => {
    expect(formatPlanetShipsLabel({})).toBeNull();
    expect(formatPlanetShipsLabel(undefined)).toBeNull();
    expect(formatPlanetShipsDetail(null)).toBeNull();
  });
});
