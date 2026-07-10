import { describe, expect, it } from "vitest";
import { getOutgoingAttackTargetCoords } from "../src/fleet-active.js";

describe("getOutgoingAttackTargetCoords", () => {
  it("retourne les coords cibles d'attaques en vol", () => {
    const coords = getOutgoingAttackTargetCoords([
      {
        is_own: true,
        mission: "1",
        status: "outward",
        start: { galaxy: 1, system: 1, position: 1 },
        end: { galaxy: 2, system: 2, position: 3 },
      },
      {
        is_own: true,
        mission: "6",
        status: "outward",
        start: { galaxy: 1, system: 1, position: 1 },
        end: { galaxy: 3, system: 3, position: 3 },
      },
    ]);
    expect([...coords]).toEqual(["2:2:3"]);
  });
});
