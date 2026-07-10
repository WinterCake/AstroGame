// Généré par npm run sync:shared — ne pas éditer à la main
var AstrogameVerdict = (function() {
/** Classe CSS pour un verdict espionnage (web + extension). */
function verdictClass(verdict) {
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

const verdictTone = verdictClass;

return { verdictClass, verdictTone };
})();
