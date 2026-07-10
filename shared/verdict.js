/** Classe CSS pour un verdict espionnage (web + extension). */
export function verdictClass(verdict) {
  switch (verdict) {
    case "Gros butin":
      return "verdict-loot";
    case "Cible intéressante":
      return "verdict-target";
    case "Flotte présente":
      return "verdict-fleet";
    case "Défense lourde":
      return "verdict-heavy";
    case "Défense légère":
      return "verdict-light";
    default:
      return "verdict-muted";
  }
}

export const verdictTone = verdictClass;
