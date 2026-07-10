function parseCoords(coords) {
  const trimmed = String(coords ?? "").trim();
  const match = trimmed.match(/^(\d+):(\d+):(\d+)$/);
  if (!match) return null;
  return {
    galaxy: Number(match[1]),
    system: Number(match[2]),
    position: Number(match[3]),
  };
}

/** Distance Astrogame/OGame entre deux positions (G:S:P). */
export function calcCoordDistance(from, to) {
  const a = typeof from === "string" ? parseCoords(from) : from;
  const b = typeof to === "string" ? parseCoords(to) : to;
  if (!a || !b) return Infinity;

  if (a.galaxy !== b.galaxy) {
    return Math.abs(a.galaxy - b.galaxy) * 20_000;
  }
  if (a.system !== b.system) {
    return Math.abs(a.system - b.system) * 5 + 2_700;
  }
  return Math.abs(a.position - b.position) * 5 + 1_000;
}

/** Planète empire la plus proche d'une cible (colonises uniquement). */
export function pickNearestPlanet(planets, targetCoords) {
  const target = parseCoords(targetCoords);
  if (!target || !planets?.length) return null;

  let best = null;
  let bestDistance = Infinity;

  for (const planet of planets) {
    if (!planet?.coords || planet.isMoon) continue;
    const distance = calcCoordDistance(planet.coords, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = planet;
    }
  }

  if (!best) return null;
  return { ...best, distance: bestDistance };
}
