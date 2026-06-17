export const SPY_ELEMENT_LABELS: Record<string, string> = {
  "901": "Métal",
  "902": "Cristal",
  "903": "Deutérium",
  "911": "Énergie",
  "202": "Petit transporteur",
  "203": "Grand transporteur",
  "204": "Chasseur léger",
  "205": "Chasseur lourd",
  "206": "Croiseur",
  "207": "Vaisseau de bataille",
  "208": "Vaisseau de colonisation",
  "209": "Recycleur",
  "210": "Sonde d'espionnage",
  "211": "Bombardier",
  "212": "Satellite solaire",
  "213": "Destructeur",
  "214": "Étoile de la mort",
  "215": "Traqueur",
  "217": "Transporteur ultime",
  "220": "Collectionneur",
  "401": "Lanceur de missiles",
  "402": "Canon laser léger",
  "403": "Canon laser puissant",
  "404": "Canon de Gauss",
  "405": "Artillerie à Ions",
  "406": "Lanceur de Plasma",
  "407": "Petit bouclier",
  "408": "Grand bouclier",
  "409": "Dôme de protection",
  "410": "Canon à gravitons",
  "411": "Plateforme orbitale",
  "502": "Missiles d'interception",
  "503": "Missiles interplanétaires",
};

export type SpyDetailSectionDef = {
  key: string;
  title: string;
  mode: "amount" | "count";
  totalKey: "lootFormatted" | "fleetFormatted" | "defenseFormatted";
};

export const SPY_DETAIL_SECTIONS: SpyDetailSectionDef[] = [
  { key: "900", title: "Ressources", mode: "amount", totalKey: "lootFormatted" },
  { key: "200", title: "Flotte", mode: "count", totalKey: "fleetFormatted" },
  { key: "400", title: "Défense", mode: "count", totalKey: "defenseFormatted" },
];
