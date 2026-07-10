import { describe, expect, it } from "vitest";
import { classifyAttackFailure, summarizeAttackLootResults } from "../src/attack-loot-send.js";

describe("classifyAttackFailure", () => {
  it("détecte la protection des joueurs faibles", () => {
    expect(
      classifyAttackFailure(
        "Vous ne pouvez pas attaquer cette planète, la protection des joueurs faibles vous en empêche !"
      )
    ).toBe("weak_player");
  });

  it("détecte les variantes accentuées ou tronquées", () => {
    expect(
      classifyAttackFailure(
        "Erreur, Le joueur ne peut etre attaque a cause de la protection des joueurs tres faibles."
      )
    ).toBe("weak_player");
  });

  it("détecte le message Astrogame protection noob", () => {
    expect(classifyAttackFailure("Le joueur est dans la protection Noob! Retour")).toBe("weak_player");
  });

  it("ignore les autres erreurs", () => {
    expect(classifyAttackFailure("PT insuffisants sur Main")).toBeNull();
    expect(classifyAttackFailure("")).toBeNull();
  });
});

describe("summarizeAttackLootResults", () => {
  it("compte les joueurs trop faibles séparément", () => {
    expect(
      summarizeAttackLootResults([
        { ok: true },
        { ok: false, reason: "weak_player" },
        { ok: false, reason: null },
      ])
    ).toEqual({
      total: 3,
      ok: 1,
      failed: 2,
      weakPlayer: 1,
      otherFailed: 1,
    });
  });
});
