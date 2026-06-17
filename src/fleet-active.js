import * as cheerio from "cheerio";

export const MISSION_LABELS = {
  1: "Attaque",
  2: "ACS",
  3: "Transport",
  4: "Déployer",
  5: "Défendre",
  6: "Espionnage",
  7: "Coloniser",
  8: "Recycler",
  9: "Détruire",
  15: "Expédition",
};

const SHIP_LABELS = {
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
  217: "Transporteur ultime",
};

const SHIP_NAMES = {
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

export function parseActiveFleetActs(html) {
  const marker = "activeFleetActs = ";
  const start = html.indexOf(marker);
  if (start < 0) return [];

  const jsonStart = start + marker.length;
  if (html[jsonStart] !== "[") return [];

  let depth = 0;
  for (let index = jsonStart; index < html.length; index++) {
    if (html[index] === "[") depth++;
    else if (html[index] === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1));
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

export function coordsFromPlace(place) {
  if (place?.galaxy == null || place?.system == null || place?.position == null) return null;
  return `${place.galaxy}:${place.system}:${place.position}`;
}

export function parsePlanetByCp(html, cp) {
  const $ = cheerio.load(html);
  for (const selector of ["#planetSelector option", "#planetSelectorMobile option"]) {
    const opt = $(selector)
      .filter((_, el) => Number($(el).attr("value")) === Number(cp))
      .first();
    if (!opt.length) continue;
    const label = opt.text().replace(/\s+/g, " ").trim();
    return {
      cp: Number(cp),
      label,
      coords: label.match(/\[(\d+:\d+:\d+)\]/)?.[1] ?? null,
    };
  }
  return { cp: Number(cp), label: String(cp), coords: null };
}

export function parseFlightDurationFromStep2(html) {
  const text = String(html);
  const patterns = [
    /var\s+duration\s*=\s*(\d+)/i,
    /"duration"\s*:\s*"?(\d+)"?/,
    /name="duration"\s+[^>]*value="(\d+)"/i,
    /id="duration"\s+[^>]*value="(\d+)"/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number(match[1]) || null;
  }
  return null;
}

export function formatShipsLabel(ships = 0, battleShips = 0) {
  const parts = [];
  if (ships > 0) parts.push(`${ships.toLocaleString("fr-FR")} PT`);
  if (battleShips > 0) parts.push(`${battleShips.toLocaleString("fr-FR")} VB`);
  return parts.length ? parts.join(" + ") : "—";
}

export function parseFleetShips(fleetData) {
  if (!fleetData) return [];

  const items = [];

  if (Array.isArray(fleetData)) {
    for (const entry of fleetData) {
      if (entry == null || typeof entry !== "object") continue;
      const id = entry.ship_id ?? entry.id ?? entry.shipId;
      const count = Number(entry.quantity ?? entry.count ?? entry.amount) || 0;
      if (id != null && count > 0) items.push({ id: String(id), count });
    }
  } else if (typeof fleetData === "object") {
    for (const [id, count] of Object.entries(fleetData)) {
      const n = Number(count) || 0;
      if (n > 0) items.push({ id: String(id), count: n });
    }
  } else if (typeof fleetData === "string" && fleetData.trim()) {
    const parts = fleetData.split(",").map((part) => part.trim());
    for (let index = 0; index + 1 < parts.length; index += 2) {
      const id = parts[index];
      const count = Number(parts[index + 1]) || 0;
      if (count > 0) items.push({ id, count });
    }
  }

  return items.sort((a, b) => Number(a.id) - Number(b.id));
}

function shipShortLabel(id) {
  return SHIP_LABELS[id] ?? `ship${id}`;
}

function shipFullName(id) {
  return SHIP_NAMES[id] ?? SHIP_LABELS[id] ?? `Vaisseau ${id}`;
}

function formatShipParts(items, { fullNames = false } = {}) {
  return items.map(({ id, count }) => {
    const label = fullNames ? shipFullName(id) : shipShortLabel(id);
    return `${count.toLocaleString("fr-FR")} ${label}`;
  });
}

function formatFleetArrayShips(fleetData, { fullNames = false } = {}) {
  const items = parseFleetShips(fleetData);
  if (!items.length) return null;
  return formatShipParts(items, { fullNames }).join(" + ");
}

export function formatFleetShipsDetail(fleetData) {
  return formatFleetArrayShips(fleetData, { fullNames: true });
}

export function formatDurationSec(sec) {
  if (sec == null || !Number.isFinite(sec)) return null;
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function fleetStatusLabel(fleet) {
  const status = String(fleet?.status ?? "").toLowerCase();
  if (status === "returning" || status === "return" || status === "1") return "Retour";
  if (status === "attacking" || status === "outward" || status === "flying" || status === "0") return "Aller";
  if (status === "holding" || status === "2") return "Sur place";
  const rest = Number(fleet?.rest_time);
  if (Number.isFinite(rest) && rest > 0) return "En vol";
  return status || "En vol";
}

function isFleetInFlight(fleet) {
  if (!fleet?.is_own) return false;
  const rest = Number(fleet.rest_time);
  if (Number.isFinite(rest) && rest > 0) return true;
  const status = String(fleet.status ?? "").toLowerCase();
  return ["outward", "return", "holding", "attacking", "flying", "0", "1", "2"].includes(status);
}

export function extractFleetTiming(fleet, fallbackDurationSec = null) {
  const now = Date.now();
  const startAt = (Number(fleet?.start_time) || 0) * 1000 || null;
  const arrivalAt = (Number(fleet?.end_time) || 0) * 1000 || null;
  const returnAt = (Number(fleet?.fleet_end_time) || 0) * 1000 || null;
  const restSec = Number(fleet?.rest_time) || 0;
  const status = String(fleet?.status ?? "");

  let durationOutSec =
    startAt && arrivalAt ? Math.max(0, Math.round((arrivalAt - startAt) / 1000)) : fallbackDurationSec;

  let computedReturnAt = returnAt;
  if (!computedReturnAt && arrivalAt && durationOutSec) {
    computedReturnAt = arrivalAt + durationOutSec * 1000;
  }

  const isReturn = ["1", "return", "returning"].includes(status.toLowerCase());
  const homeAtMs = (Number(fleet?.fleet_end_time) || Number(fleet?.end_time) || 0) * 1000 || null;

  const arrivalInSec = isReturn
    ? null
    : restSec || (arrivalAt ? Math.max(0, Math.round((arrivalAt - now) / 1000)) : durationOutSec);
  const returnInSec = isReturn
    ? restSec || (homeAtMs ? Math.max(0, Math.round((homeAtMs - now) / 1000)) : null)
    : computedReturnAt
      ? Math.max(0, Math.round((computedReturnAt - now) / 1000))
      : durationOutSec != null
        ? durationOutSec * 2
        : null;

  const finalReturnAt = isReturn
    ? homeAtMs || (returnInSec ? now + returnInSec * 1000 : null)
    : computedReturnAt || (durationOutSec ? now + durationOutSec * 2 * 1000 : null);

  return {
    durationOutSec,
    durationReturnSec: durationOutSec,
    arrivalAt: isReturn ? null : arrivalAt || (durationOutSec ? now + durationOutSec * 1000 : null),
    returnAt: finalReturnAt,
    arrivalInSec,
    returnInSec,
    status,
    statusLabel: fleetStatusLabel(fleet),
  };
}

export function findOwnAttackFleet(fleets, targetCoords, sourceCoords = null) {
  const matches = fleets.filter((fleet) => {
    if (!fleet?.is_own || String(fleet.mission) !== "1") return false;
    if (coordsFromPlace(fleet.end) !== targetCoords) return false;
    if (sourceCoords && coordsFromPlace(fleet.start) !== sourceCoords) return false;
    const start = fleet.start;
    if (
      start?.galaxy &&
      String(start.galaxy) === String(fleet.end?.galaxy) &&
      String(start.system) === String(fleet.end?.system) &&
      String(start.position) === String(fleet.end?.position)
    ) {
      return false;
    }
    return true;
  });

  return matches.sort((a, b) => (Number(b.start_time) || 0) - (Number(a.start_time) || 0))[0] ?? null;
}

function isReturnLeg(fleet) {
  const status = String(fleet?.status ?? "").toLowerCase();
  return status === "returning" || status === "return" || status === "1";
}

function missionKind(mission) {
  const id = String(mission ?? "");
  if (id === "1") return "attack";
  if (id === "3") return "transport";
  return "other";
}

function fleetLegKey(fleet) {
  const id = fleet.fleet_id ?? fleet.id;
  if (id != null && id !== "") return `id:${id}`;
  return `${fleet.mission}|${coordsFromPlace(fleet.start)}|${coordsFromPlace(fleet.end)}|${fleet.start_time}`;
}

/** Astrogame liste aller + retour planifié : une ligne, timings fusionnés. */
export function mergeFleetLegs(fleets) {
  const groups = new Map();
  for (const fleet of fleets) {
    const key = fleetLegKey(fleet);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fleet);
  }

  return [...groups.values()].map((legs) => {
    const active = legs.reduce((best, fleet) => {
      const rest = Number(fleet.rest_time);
      const bestRest = Number(best.rest_time);
      if (!Number.isFinite(bestRest) || (Number.isFinite(rest) && rest < bestRest)) return fleet;
      return best;
    });
    const returnLeg = legs.find(isReturnLeg) ?? null;
    const outboundLeg = legs.find((fleet) => !isReturnLeg(fleet)) ?? active;
    return { active, returnLeg, outboundLeg };
  });
}

/** @deprecated Utiliser mergeFleetLegs */
export function dedupeFleetLegs(fleets) {
  return mergeFleetLegs(fleets).map((group) => group.active);
}

function applyReturnLegTiming(timing, active, returnLeg, outboundLeg) {
  if (!returnLeg || isReturnLeg(active)) return timing;

  const outboundTiming = extractFleetTiming(outboundLeg);
  timing.arrivalAt = outboundTiming.arrivalAt;
  timing.arrivalInSec = outboundTiming.arrivalInSec;
  timing.durationOutSec = outboundTiming.durationOutSec;

  const returnEndMs =
    (Number(returnLeg.fleet_end_time) || Number(returnLeg.end_time) || 0) * 1000 || null;
  const returnRest = Number(returnLeg.rest_time) || 0;
  if (returnEndMs) timing.returnAt = returnEndMs;
  else if (returnRest) timing.returnAt = Date.now() + returnRest * 1000;

  timing.returnInSec =
    returnRest ||
    (timing.returnAt ? Math.max(0, Math.round((timing.returnAt - Date.now()) / 1000)) : null);

  const returnStartMs = (Number(returnLeg.start_time) || 0) * 1000;
  if (returnStartMs && timing.returnAt) {
    timing.durationReturnSec = Math.max(0, Math.round((timing.returnAt - returnStartMs) / 1000));
  } else if (outboundTiming.durationOutSec) {
    timing.durationReturnSec = outboundTiming.durationOutSec;
  }

  return timing;
}

export function normalizeActiveFleet(fleet, legs = {}) {
  const { returnLeg = null, outboundLeg = fleet } = legs;
  const coordFleet = isReturnLeg(fleet) ? fleet : outboundLeg;
  const sourceCoords = coordsFromPlace(coordFleet.start);
  const targetCoords = coordsFromPlace(coordFleet.end);
  let timing = extractFleetTiming(fleet);
  timing = applyReturnLegTiming(timing, fleet, returnLeg, outboundLeg);
  const fleetData = coordFleet.fleet_array ?? coordFleet.fleet ?? null;
  const ships = parseFleetShips(fleetData).map(({ id, count }) => ({
    id,
    count,
    shortLabel: shipShortLabel(id),
    name: shipFullName(id),
  }));
  const shipsLabel =
    formatFleetArrayShips(fleetData) ??
    (coordFleet.amount ? `${Number(coordFleet.amount).toLocaleString("fr-FR")} vaisseaux` : null);
  const shipsDetail = ships.length
    ? ships.map((ship) => `${ship.count.toLocaleString("fr-FR")} ${ship.name}`).join("\n")
    : shipsLabel;

  return {
    fleetId: fleet.fleet_id ?? fleet.id ?? null,
    mission: String(fleet.mission ?? ""),
    missionLabel: MISSION_LABELS[fleet.mission] ?? `Mission ${fleet.mission}`,
    missionKind: missionKind(fleet.mission),
    status: timing.status,
    statusLabel: timing.statusLabel,
    sourceCoords,
    targetCoords,
    homeCoords: isReturnLeg(fleet)
      ? targetCoords
      : (returnLeg ? coordsFromPlace(returnLeg.end) : sourceCoords),
    sourceName: coordFleet.start?.planet ?? coordFleet.start?.name ?? null,
    targetName: coordFleet.end?.planet ?? coordFleet.end?.name ?? null,
    targetPlayer: coordFleet.target_username ?? null,
    shipsLabel,
    shipsDetail,
    ships,
    restSec: Number(fleet.rest_time) || 0,
    ...timing,
    durationOutFormatted: formatDurationSec(timing.durationOutSec),
    durationReturnFormatted: formatDurationSec(timing.durationReturnSec),
    arrivalInFormatted: formatDurationSec(timing.arrivalInSec),
    returnInFormatted: formatDurationSec(timing.returnInSec),
  };
}

export async function fetchActiveFleets(client, cp = null) {
  const url = cp ? `game/fleetTable?cp=${cp}` : "game/fleetTable";
  const response = await client.get(url, {
    headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
  });
  const html = String(response.data);
  const inFlight = parseActiveFleetActs(html).filter(isFleetInFlight);
  const fleets = mergeFleetLegs(inFlight)
    .map((group) => normalizeActiveFleet(group.active, group))
    .sort((a, b) => (a.arrivalAt ?? 0) - (b.arrivalAt ?? 0));

  return { fleets, count: fleets.length };
}
