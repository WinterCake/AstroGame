import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SITE_URL, UNIVERSE } from "./config.js";
import { getClient } from "./client.js";
import { derivePlayerActivity } from "./galaxy-activity.js";
import { createLogger } from "./logger.js";

const log = createLogger("galaxy");

const DELAY_MIN_MS = 250;
const DELAY_MAX_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(min = DELAY_MIN_MS, max = DELAY_MAX_MS) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function parseSystemEntries(galaxy, system, existsPlanets) {
  const entries = [];

  for (const [position, slot] of Object.entries(existsPlanets ?? {})) {
    if (!slot || slot === false || !slot.user?.username || !slot.planet?.id) continue;

    const g = Number(galaxy);
    const s = Number(system);
    const p = Number(position);
    const activity = derivePlayerActivity(slot);

    entries.push({
      coords: `${g}:${s}:${p}`,
      galaxy: g,
      system: s,
      position: p,
      planetId: slot.planet.id,
      planetName: slot.planet.name,
      playerId: slot.user.id,
      username: slot.user.username,
      rank: Number(slot.user.rank) || slot.user.rank,
      points: slot.user.points,
      alliance: slot.alliance
        ? {
            id: slot.alliance.id,
            tag: slot.alliance.tag,
            name: slot.alliance.name,
            rank: slot.alliance.rank,
          }
        : null,
      moon: slot.moon
        ? {
            id: slot.moon.id,
            name: slot.moon.name,
            diameter: slot.moon.diameter,
            tempMin: slot.moon.temp_min,
          }
        : null,
      debris: slot.debris
        ? {
            metal: slot.debris.metal,
            crystal: slot.debris.crystal,
          }
        : null,
      ownPlanet: Boolean(slot.ownPlanet),
      isEnemy: Boolean(slot.user.isEnemy),
      ...activity,
    });
  }

  return entries;
}

export function groupEntriesByPlayer(entries) {
  const players = new Map();

  for (const entry of entries) {
    if (!players.has(entry.playerId)) {
      players.set(entry.playerId, {
        playerId: entry.playerId,
        username: entry.username,
        rank: entry.rank,
        points: entry.points,
        alliance: entry.alliance,
        inactive: entry.inactive,
        onVacation: entry.onVacation,
        activityLabel: entry.activityLabel,
        planets: [],
      });
    }

    const player = players.get(entry.playerId);
    player.planets.push({
      coords: entry.coords,
      galaxy: entry.galaxy,
      system: entry.system,
      position: entry.position,
      planetId: entry.planetId,
      planetName: entry.planetName,
      moon: entry.moon,
      debris: entry.debris,
      activityLabel: entry.activityLabel,
      inactive: entry.inactive,
      onVacation: entry.onVacation,
      lastActivity: entry.lastActivity,
      ownPlanet: entry.ownPlanet,
      isEnemy: entry.isEnemy,
    });
  }

  return [...players.values()].sort((a, b) => a.username.localeCompare(b.username));
}

export async function fetchGalaxySystem(client, galaxy, system) {
  const response = await client.post("game/galaxy/ajax", `galaxy=${galaxy}&system=${system}`, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: `${SITE_URL}game/galaxy`,
      "X-Requested-With": "XMLHttpRequest",
    },
    transformResponse: [(data) => data],
  });

  let payload;
  try {
    payload = JSON.parse(response.data);
  } catch {
    throw new Error(`Réponse galaxie invalide pour ${galaxy}:${system}`);
  }

  if (!payload.status) {
    throw new Error(payload.message || `Échec galaxie ${galaxy}:${system}`);
  }

  return {
    galaxy: Number(payload.galaxy),
    system: Number(payload.system),
    planetCount: payload.planetCountNumber ?? 0,
    entries: parseSystemEntries(payload.galaxy, payload.system, payload.existsPlanets),
  };
}

export async function discoverGalaxyLimits(client) {
  const probe = await fetchGalaxySystem(client, 999, 999);
  return {
    maxGalaxy: probe.galaxy,
    maxSystem: probe.system,
  };
}

function parseRangeArg(value, fallback) {
  if (!value) return fallback;
  const [from, to] = value.split("-").map((part) => Number(part.trim()));
  if (!Number.isInteger(from)) return fallback;
  if (!Number.isInteger(to)) return { from, to: from };
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

function parseCoordsArg(value) {
  const match = value?.match(/^(\d+):(\d+)$/);
  if (!match) return null;
  return { galaxy: Number(match[1]), system: Number(match[2]) };
}

function systemKey(galaxy, system) {
  return `${galaxy}:${system}`;
}

function countStoredSystems(entries) {
  return new Set(entries.map((entry) => systemKey(entry.galaxy, entry.system))).size;
}

function loadExistingPayload(output) {
  if (!existsSync(output)) return null;

  try {
    const data = JSON.parse(readFileSync(output, "utf8"));
    if (!Array.isArray(data?.entries)) return null;
    return data;
  } catch {
    return null;
  }
}

function prepareMergedEntries(existingEntries, targets) {
  const rescannedSystems = new Set(targets.map((target) => systemKey(target.galaxy, target.system)));
  return existingEntries.filter((entry) => !rescannedSystems.has(systemKey(entry.galaxy, entry.system)));
}

function replaceSystemEntries(entries, galaxy, system, newEntries) {
  const kept = entries.filter((entry) => !(entry.galaxy === galaxy && entry.system === system));
  return [...kept, ...newEntries];
}

export function parseGalaxyScrapeOptions(args) {
  const options = {
    all: false,
    merge: false,
    coords: null,
    galaxy: null,
    system: null,
    output: "galaxy-players.json",
    delayMinMs: Number(process.env.GALAXY_SCRAPE_DELAY_MIN_MS) || DELAY_MIN_MS,
    delayMaxMs: Number(process.env.GALAXY_SCRAPE_DELAY_MAX_MS) || DELAY_MAX_MS,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") options.all = true;
    else if (arg === "--merge") options.merge = true;
    else if (arg === "--system") options.coords = parseCoordsArg(args[++i]);
    else if (arg === "--galaxy") options.galaxy = parseRangeArg(args[++i], null);
    else if (arg === "--systems") options.system = parseRangeArg(args[++i], null);
    else if (arg === "--output") options.output = args[++i];
  }

  return options;
}

function buildGalaxyPayload(entries, { limits, targets, scanned, lastTarget, complete, error, merge }) {
  const players = groupEntriesByPlayer(entries);
  const meta = {
    universe: UNIVERSE,
    scrapedAt: new Date().toISOString(),
    limits,
    planetEntries: entries.length,
    uniquePlayers: players.length,
    systemsStored: countStoredSystems(entries),
  };

  if (merge) {
    meta.merged = true;
    meta.systemsInRun = targets.length;
    meta.systemsScannedThisRun = scanned;
    meta.runComplete = complete;
  } else {
    meta.systemsTotal = targets.length;
    meta.systemsScanned = scanned;
    meta.complete = complete;
  }

  if (lastTarget) {
    meta.lastScanned = `${lastTarget.galaxy}:${lastTarget.system}`;
  }
  if (error) {
    meta.error = error;
  }

  return { meta, entries, players };
}

function saveGalaxyPayload(output, payload) {
  writeFileSync(output, JSON.stringify(payload, null, 2), "utf8");
}

export async function scrapeGalaxy(options = {}, client) {
  const http = client ?? (await getClient());
  const limits = await discoverGalaxyLimits(http);
  const targets = [];

  if (options.coords) {
    targets.push(options.coords);
  } else if (options.galaxy || options.system || !options.all) {
    const galaxyRange = options.galaxy ?? { from: 1, to: limits.maxGalaxy };
    const systemRange = options.system ?? { from: 1, to: limits.maxSystem };
    for (let g = galaxyRange.from; g <= galaxyRange.to; g++) {
      for (let s = systemRange.from; s <= systemRange.to; s++) {
        targets.push({ galaxy: g, system: s });
      }
    }
  } else {
    for (let g = 1; g <= limits.maxGalaxy; g++) {
      for (let s = 1; s <= limits.maxSystem; s++) {
        targets.push({ galaxy: g, system: s });
      }
    }
  }

  let entries = [];
  if (options.merge) {
    const existing = loadExistingPayload(options.output);
    if (existing) {
      entries = prepareMergedEntries(existing.entries, targets);
      log.info(`Merge activé`, {
        output: options.output,
        keptEntries: entries.length,
        rescannedSystems: targets.length,
        previousEntries: existing.entries.length,
      });
    } else {
      log.info(`Merge activé — aucun fichier existant, création`, { output: options.output });
    }
  }

  log.info(`Scan galaxie démarré`, {
    universe: UNIVERSE,
    limits,
    systems: targets.length,
    merge: options.merge,
    delayMs: `${options.delayMinMs}-${options.delayMaxMs} (aléatoire)`,
  });

  let scanned = 0;
  let lastTarget = null;

  const persist = (complete, error) => {
    saveGalaxyPayload(
      options.output,
      buildGalaxyPayload(entries, {
        limits,
        targets,
        scanned,
        lastTarget,
        complete,
        error,
        merge: options.merge,
      })
    );
  };

  try {
    for (const target of targets) {
      const result = await fetchGalaxySystem(http, target.galaxy, target.system);
      entries = replaceSystemEntries(entries, target.galaxy, target.system, result.entries);
      scanned++;
      lastTarget = target;
      persist(scanned === targets.length);

      if (scanned % 25 === 0 || scanned === targets.length) {
        log.info(`Progression ${scanned}/${targets.length} — ${entries.length} planètes joueurs au total`);
      }

      if (scanned < targets.length) {
        await sleep(randomDelayMs(options.delayMinMs, options.delayMaxMs));
      }
    }
  } catch (error) {
    persist(false, error.message);
    log.warn(`Scan interrompu — sauvegarde partielle`, {
      output: options.output,
      scanned,
      entries: entries.length,
      lastScanned: lastTarget ? `${lastTarget.galaxy}:${lastTarget.system}` : null,
    });
    throw error;
  }

  log.info(`JSON exporté`, {
    output: options.output,
    entries: entries.length,
    players: groupEntriesByPlayer(entries).length,
  });

  return buildGalaxyPayload(entries, {
    limits,
    targets,
    scanned,
    lastTarget,
    complete: true,
    merge: options.merge,
  });
}
