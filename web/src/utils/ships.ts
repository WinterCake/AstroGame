/** Labels courts alignés sur src/fleet-active.js (flottes en vol). */
const SHIP_LABELS: Record<string, string> = {
  202: "PT",
  203: "GT",
  204: "CL",
  205: "CH",
  206: "Croiseur",
  207: "VB",
  208: "Colo",
  209: "Recycleur",
  210: "Sonde",
  211: "Bombardier",
  212: "Satellite",
  213: "Destructeur",
  214: "Étoile de la mort",
  215: "Traqueur",
  217: "TU",
};

const SHIP_NAMES: Record<string, string> = {
  202: "Petit transporteur",
  203: "Grand transporteur",
  204: "Chasseur léger",
  205: "Chasseur lourd",
  206: "Croiseur",
  207: "Vaisseau de bataille",
  208: "Vaisseau de colonisation",
  209: "Recycleur",
  210: "Sonde d'espionnage",
  211: "Bombardier",
  212: "Satellite solaire",
  213: "Destructeur",
  214: "Étoile de la mort",
  215: "Traqueur",
  217: "Transporteur ultime",
};

export function normalizeShipId(id: string | number): string {
  return String(id).replace(/^ship/i, "");
}

export type PlanetShipItem = { id: string; count: number; shortLabel: string; name: string };

export function parsePlanetShips(ships?: Record<string, number> | null): PlanetShipItem[] {
  if (!ships) return [];
  const items: PlanetShipItem[] = [];
  for (const [rawId, rawCount] of Object.entries(ships)) {
    const count = Number(rawCount) || 0;
    if (count <= 0) continue;
    const id = normalizeShipId(rawId);
    items.push({
      id,
      count,
      shortLabel: SHIP_LABELS[id] ?? `ship${id}`,
      name: SHIP_NAMES[id] ?? SHIP_LABELS[id] ?? `Vaisseau ${id}`,
    });
  }
  return items.sort((a, b) => Number(a.id) - Number(b.id));
}

export function formatPlanetShipsLabel(ships?: Record<string, number> | null): string | null {
  const items = parsePlanetShips(ships);
  if (!items.length) return null;
  return items.map((ship) => `${ship.count.toLocaleString("fr-FR")} ${ship.shortLabel}`).join(" + ");
}

/** Liste détaillée pour tooltip (comme Flottes en vol). */
export function formatPlanetShipsDetail(ships?: Record<string, number> | null): string | null {
  const items = parsePlanetShips(ships);
  if (!items.length) return null;
  return items.map((ship) => `${ship.count.toLocaleString("fr-FR")} ${ship.name}`).join("\n");
}
