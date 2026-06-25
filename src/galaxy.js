import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { SITE_URL, UNIVERSE } from "./config.js";
import { getClient, refreshClient } from "./client.js";
import { derivePlayerActivity } from "./galaxy-activity.js";
import { ensureDataDirs, paths } from "./paths.js";
import { createLogger } from "./logger.js";

const log = createLogger("galaxy");

const DELAY_MIN_MS = 250;
const DELAY_MAX_MS = 2000;
const DEFAULT_RETRIES = Number(process.env.GALAXY_SCRAPE_RETRIES) || 4;
const RETRY_BASE_MS = Number(process.env.GALAXY_SCRAPE_RETRY_BASE_MS) || 5000;

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

function previewResponse(raw) {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function isSessionLikeResponse(raw) {
  const text = String(raw ?? "");
  return (
    /session|expir|login|connexion/i.test(text) &&
    (text.includes("<html") || text.includes("loginAjax") || text.includes("game/logout") === false)
  );
}

export function isRetryableGalaxyError(error, raw = "") {
  const message = String(error?.message ?? error ?? "");
  if (/session|expir|invalid|JSON|timeout|ECONNRESET|429|503|502|rate|limit|captcha|too many/i.test(message)) {
    return true;
  }
  const body = String(raw ?? "");
  if (body && !body.trim().startsWith("{")) return true;
  return isSessionLikeResponse(body);
}

function parseGalaxyResponse(raw, galaxy, system) {
  const body = String(raw ?? "").trim();
  if (!body.startsWith("{")) {
    if (isSessionLikeResponse(body)) {
      throw new Error(`Session expirée ou page HTML reçue pour ${galaxy}:${system}`);
    }
    throw new Error(
      `Réponse galaxie invalide pour ${galaxy}:${system} — ${previewResponse(body) || "corps vide"}`
    );
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error(`JSON invalide pour ${galaxy}:${system} — ${previewResponse(body)}`);
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

export async function fetchGalaxySystem(client, galaxy, system) {
  const response = await client.post("game/galaxy/ajax", `galaxy=${galaxy}&system=${system}`, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: `${SITE_URL}game/galaxy?galaxy=${galaxy}&system=${system}`,
      "X-Requested-With": "XMLHttpRequest",
    },
    transformResponse: [(data) => data],
  });

  return parseGalaxyResponse(response.data, galaxy, system);
}

async function fetchGalaxySystemWithRetry(galaxy, system, options) {
  let lastError = null;
  let lastRaw = "";

  for (let attempt = 1; attempt <= options.retries; attempt++) {
    try {
      const client = await getClient();
      const response = await client.post("game/galaxy/ajax", `galaxy=${galaxy}&system=${system}`, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json, text/javascript, */*; q=0.01",
          Referer: `${SITE_URL}game/galaxy?galaxy=${galaxy}&system=${system}`,
          "X-Requested-With": "XMLHttpRequest",
        },
        transformResponse: [(data) => data],
      });
      lastRaw = response.data;
      return parseGalaxyResponse(response.data, galaxy, system);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableGalaxyError(error, lastRaw);
      if (!retryable || attempt >= options.retries) {
        throw error;
      }

      const delay = options.retryBaseMs * attempt;
      log.warn(`Retry ${galaxy}:${system}`, {
        attempt,
        max: options.retries,
        delayMs: delay,
        message: error.message,
      });

      if (/session|expir|HTML/i.test(error.message)) {
        await refreshClient();
      }

      await sleep(delay);
    }
  }

  throw lastError ?? new Error(`Échec galaxie ${galaxy}:${system}`);
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

function storedSystemKeys(entries) {
  return new Set(entries.map((entry) => systemKey(entry.galaxy, entry.system)));
}

function processedSystemKeys(entries, meta = {}) {
  const keys = storedSystemKeys(entries);
  for (const item of meta.failedSystems ?? []) {
    keys.add(systemKey(item.galaxy, item.system));
  }
  for (const key of meta.scannedSystemKeys ?? []) {
    keys.add(key);
  }
  return keys;
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
    refresh: false,
    coords: null,
    galaxy: null,
    system: null,
    output: null,
    delayMinMs: Number(process.env.GALAXY_SCRAPE_DELAY_MIN_MS) || DELAY_MIN_MS,
    delayMaxMs: Number(process.env.GALAXY_SCRAPE_DELAY_MAX_MS) || DELAY_MAX_MS,
    retries: DEFAULT_RETRIES,
    retryBaseMs: RETRY_BASE_MS,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") options.all = true;
    else if (arg === "--refresh") options.refresh = true;
    else if (arg === "--merge" || arg === "--resume") {
      log.warn(`Option ${arg} ignorée — fusion et reprise sont activées par défaut`);
    } else if (arg === "--system") options.coords = parseCoordsArg(args[++i]);
    else if (arg === "--galaxy") options.galaxy = parseRangeArg(args[++i], null);
    else if (arg === "--systems") options.system = parseRangeArg(args[++i], null);
    else if (arg === "--output") options.output = args[++i];
  }

  return options;
}

function buildGalaxyPayload(entries, { limits, targets, scanned, skipped, lastTarget, complete, error, refresh, failedSystems, scannedSystemKeys }) {
  const players = groupEntriesByPlayer(entries);
  const meta = {
    universe: UNIVERSE,
    scrapedAt: new Date().toISOString(),
    limits,
    planetEntries: entries.length,
    uniquePlayers: players.length,
    systemsStored: countStoredSystems(entries),
    systemsInRun: targets.length,
    systemsScannedThisRun: scanned,
    systemsSkippedExisting: skipped ?? 0,
    systemsFailed: failedSystems?.length ?? 0,
    runComplete: complete,
    refresh: Boolean(refresh),
  };

  if (lastTarget) {
    meta.lastScanned = `${lastTarget.galaxy}:${lastTarget.system}`;
  }
  if (error) {
    meta.error = error;
  }
  if (failedSystems?.length) {
    meta.failedSystems = failedSystems;
  }
  if (scannedSystemKeys?.length) {
    meta.scannedSystemKeys = scannedSystemKeys;
  }

  return { meta, entries, players };
}

function saveGalaxyPayload(output, payload) {
  writeFileSync(output, JSON.stringify(payload, null, 2), "utf8");
}

/** Retire des planètes absentes du jeu (coords G:S:P) du cache galaxie local. */
export function removeGalaxyEntriesByCoords(coords) {
  const removeSet = new Set(
    (coords ?? []).map((c) => String(c).trim()).filter((c) => /^\d+:\d+:\d+$/.test(c))
  );
  if (!removeSet.size) return { removed: 0, coords: [] };

  const output = paths.galaxy.global();
  const existing = loadExistingPayload(output);
  if (!existing) return { removed: 0, coords: [] };

  const removedCoords = existing.entries
    .filter((entry) => removeSet.has(entry.coords))
    .map((entry) => entry.coords);
  if (!removedCoords.length) return { removed: 0, coords: [] };

  const entries = existing.entries.filter((entry) => !removeSet.has(entry.coords));
  const payload = {
    ...existing,
    meta: {
      ...existing.meta,
      planetEntries: entries.length,
      uniquePlayers: groupEntriesByPlayer(entries).length,
      systemsStored: countStoredSystems(entries),
      prunedAt: new Date().toISOString(),
    },
    entries,
    players: groupEntriesByPlayer(entries),
  };

  saveGalaxyPayload(output, payload);
  log.warn(`Planètes retirées du cache galaxie`, { removed: removedCoords.length, coords: removedCoords });
  return { removed: removedCoords.length, coords: removedCoords };
}

export async function scrapeGalaxy(options = {}, client) {
  if (!options.output) {
    ensureDataDirs();
    options.output = paths.galaxy.defaultScrape();
  }
  const http = client ?? (await getClient());
  const limits = await discoverGalaxyLimits(http);
  let targets = [];

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

  const existing = loadExistingPayload(options.output);
  const requestedTargets = targets.length;
  let entries = existing?.entries ?? [];
  let skippedExisting = 0;

  if (existing) {
    if (options.refresh) {
      entries = prepareMergedEntries(existing.entries, targets);
      log.info(`Fichier existant — re-scan forcé de la plage demandée`, {
        output: options.output,
        keptEntries: entries.length,
        rescannedSystems: targets.length,
        previousEntries: existing.entries.length,
      });
    } else {
      const done = processedSystemKeys(entries, existing.meta);
      const pending = targets.filter((target) => !done.has(systemKey(target.galaxy, target.system)));
      skippedExisting = targets.length - pending.length;
      targets = pending;
      log.info(`Fichier existant — fusion + reprise automatiques`, {
        output: options.output,
        skippedSystems: skippedExisting,
        pendingSystems: targets.length,
        systemsStored: countStoredSystems(entries),
        previousEntries: existing.entries.length,
      });
    }
  }

  if (!targets.length) {
    log.info(`Rien à scanner — tous les systèmes demandés sont déjà présents`, {
      output: options.output,
      systemsStored: countStoredSystems(entries),
    });
    return buildGalaxyPayload(entries, {
      limits,
      targets: [],
      scanned: 0,
      skipped: skippedExisting,
      lastTarget: existing?.meta?.lastScanned
        ? parseCoordsArg(existing.meta.lastScanned)
        : null,
      complete: true,
      refresh: options.refresh,
    });
  }

  log.info(`Scan galaxie démarré`, {
    universe: UNIVERSE,
    limits,
    requestedSystems: requestedTargets,
    pendingSystems: targets.length,
    refresh: options.refresh,
    retries: options.retries,
    delayMs: `${options.delayMinMs}-${options.delayMaxMs} (aléatoire)`,
  });

  let scanned = 0;
  let lastTarget = null;
  const failedSystems = [...(existing?.meta?.failedSystems ?? [])];
  const scannedSystemKeys = new Set(existing?.meta?.scannedSystemKeys ?? []);

  const persist = (complete, error) => {
    saveGalaxyPayload(
      options.output,
      buildGalaxyPayload(entries, {
        limits,
        targets,
        scanned,
        skipped: skippedExisting,
        lastTarget,
        complete,
        error,
        refresh: options.refresh,
        failedSystems,
        scannedSystemKeys: [...scannedSystemKeys],
      })
    );
  };

  for (const target of targets) {
    const targetKey = systemKey(target.galaxy, target.system);
    try {
      const result = await fetchGalaxySystemWithRetry(target.galaxy, target.system, options);
      entries = replaceSystemEntries(entries, target.galaxy, target.system, result.entries);
    } catch (error) {
      failedSystems.push({
        galaxy: target.galaxy,
        system: target.system,
        error: error.message,
      });
      entries = replaceSystemEntries(entries, target.galaxy, target.system, []);
      log.warn(`Skip ${targetKey} — poursuite du scan`, {
        error: error.message,
      });
    }

    scannedSystemKeys.add(targetKey);

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

  if (failedSystems.length) {
    log.warn(`Scan terminé avec ${failedSystems.length} système(s) ignoré(s)`, {
      lastFailed: failedSystems[failedSystems.length - 1],
    });
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
    skipped: skippedExisting,
    lastTarget,
    complete: true,
    refresh: options.refresh,
  });
}
