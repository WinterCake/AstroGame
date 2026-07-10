import { describe, expect, it } from "vitest";
import { calcCoordDistance, pickNearestPlanet } from "../shared/coord-distance.js";

describe("coord-distance", () => {
  const planets = [
    { cp: 1, coords: "1:100:8", label: "Colonie A", isMoon: false },
    { cp: 2, coords: "1:200:8", label: "Colonie B", isMoon: false },
    { cp: 3, coords: "2:100:8", label: "Colonie C", isMoon: false },
    { cp: 4, coords: "1:100:9", label: "Lune", isMoon: true },
  ];

  it("calcCoordDistance — même système", () => {
    expect(calcCoordDistance("1:100:8", "1:100:12")).toBe(1_020);
  });

  it("calcCoordDistance — galaxie différente", () => {
    expect(calcCoordDistance("1:100:8", "2:100:8")).toBe(20_000);
  });

  it("pickNearestPlanet — ignore les lunes", () => {
    const nearest = pickNearestPlanet(planets, "1:100:10");
    expect(nearest?.cp).toBe(1);
    expect(nearest?.coords).toBe("1:100:8");
  });

  it("pickNearestPlanet — système le plus proche", () => {
    const nearest = pickNearestPlanet(planets, "1:150:8");
    expect(nearest?.cp).toBe(1);
  });
});
