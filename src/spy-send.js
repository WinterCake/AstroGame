import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { getClient, refreshClient } from "./client.js";
import { fetchGalaxySystem } from "./galaxy.js";
import { createLogger } from "./logger.js";

const log = createLogger("spy-send");
const SPY_MISSION = 6;
const DEFAULT_SLOT_POLL_MS = 3000;
const DEFAULT_SLOT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_STALE_SPY_MS = 90 * 1000;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function randomDelayMs(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function encodePlanetCoords(galaxy, system, position) {
  const p = Number(position);
  const g = Number(galaxy);
  const s = Number(system);
  if (p >= 10) return g * 100_000 + s * 100 + p;
  return g * 10_000 + s * 10 + p;
}

export function formatCoords(target) {
  return `${target.galaxy}:${target.system}:${target.position}`;
}

export function parseCoordLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const colonMatch = trimmed.match(/^(\d+):(\d+):(\d+)$/);
  if (colonMatch) {
    return {
      galaxy: Number(colonMatch[1]),
      system: Number(colonMatch[2]),
      position: Number(colonMatch[3]),
    };
  }

  const parts = trimmed.split(/[\s,;]+/).filter(Boolean);
  if (parts.length >= 3) {
    return {
      galaxy: Number(parts[0]),
      system: Number(parts[1]),
      position: Number(parts[2]),
    };
  }

  return null;
}

export function loadSpyTargets(filePath) {
  const content = readFileSync(filePath, "utf8");
  const targets = [];

  for (const line of content.split(/\r?\n/)) {
    const target = parseCoordLine(line);
    if (target) targets.push(target);
  }

  return targets;
}

export function parseSpySendOptions(args) {
  const options = {
    file: "spy-targets.txt",
    coords: [],
    dryRun: false,
    parallel: Number(process.env.SPY_SEND_PARALLEL) || 13,
    reserveSlots: 0,
    slotPollMs: Number(process.env.SPY_SEND_SLOT_POLL_MS) || DEFAULT_SLOT_POLL_MS,
    slotTimeoutMs: Number(process.env.SPY_SEND_SLOT_TIMEOUT_MS) || DEFAULT_SLOT_TIMEOUT_MS,
    staleSpyMs: Number(process.env.SPY_SEND_STALE_SPY_MS) || DEFAULT_STALE_SPY_MS,
    delayMinMs: Number(process.env.SPY_SEND_DELAY_MIN_MS) || 200,
    delayMaxMs: Number(process.env.SPY_SEND_DELAY_MAX_MS) || 500,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file") options.file = args[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--parallel") options.parallel = Number(args[++i]);
    else if (arg === "--reserve-slots") options.reserveSlots = Number(args[++i]);
    else if (arg === "--slot-poll") options.slotPollMs = Number(args[++i]);
    else if (arg === "--slot-timeout") options.slotTimeoutMs = Number(args[++i]);
    else if (arg === "--stale-spy") options.staleSpyMs = Number(args[++i]);
    else if (arg === "--delay-min") options.delayMinMs = Number(args[++i]);
    else if (arg === "--delay-max") options.delayMaxMs = Number(args[++i]);
    else if (/^\d+:\d+:\d+$/.test(arg)) {
      const target = parseCoordLine(arg);
      if (target) options.coords.push(target);
    }
  }

  if (!Number.isInteger(options.parallel) || options.parallel < 1) {
    throw new Error("--parallel doit être un entier >= 1");
  }
  if (!Number.isInteger(options.reserveSlots) || options.reserveSlots < 0) {
    throw new Error("--reserve-slots doit être un entier >= 0");
  }

  return options;
}

function parseActiveFleetActs(html) {
  const marker = "activeFleetActs = ";
  const start = html.indexOf(marker);
  if (start < 0) return [];

  const jsonStart = start + marker.length;
  if (html[jsonStart] !== "[") return [];

  let depth = 0;
  for (let index = jsonStart; index < html.length; index++) {
    const char = html[index];
    if (char === "[") depth++;
    else if (char === "]") {
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

function parseFleetSlotsFromHtml(html) {
  const text = String(html);
  let used = null;
  let max = null;

  const fleetMatch = text.match(/Flottes\s+(\d+)\s*\/\s*(\d+)/i);
  if (fleetMatch) {
    used = Number(fleetMatch[1]);
    max = Number(fleetMatch[2]);
  }

  const $ = cheerio.load(text);
  if (max == null) {
    const slotsText = $("#slots").parent().text().replace(/\s+/g, " ");
    const match = slotsText.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      used = Number(match[1]);
      max = Number(match[2]);
    }
  }

  if (max == null) {
    const slotsValue = Number($("#slots").text());
    if (Number.isFinite(slotsValue)) {
      used = slotsValue;
    }
  }

  return {
    used: used ?? 0,
    max: max ?? 0,
    free: Math.max(0, (max ?? 0) - (used ?? 0)),
    slotsKnown: max != null && max > 0,
  };
}

function isSpyFleetInFlight(fleet) {
  if (!fleet?.is_own || String(fleet.mission) !== String(SPY_MISSION)) {
    return false;
  }

  const restTime = Number(fleet.rest_time);
  if (Number.isFinite(restTime) && restTime > 0) {
    return true;
  }

  const status = String(fleet.status ?? "").toLowerCase();
  return status === "attacking" || status === "flying" || status === "outward";
}

function countOwnSpiesInFlight(activeFleetActs) {
  return activeFleetActs.filter(isSpyFleetInFlight).length;
}

function isLoggedInHtml(html) {
  return /loggedIn\s*=\s*parseInt\(['"]1['"]\)/.test(html) || html.includes("game/logout");
}

export async function fetchFleetSlotStatus(client) {
  const response = await client.get("game/fleetTable", {
    headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
  });
  const html = String(response.data);

  if (!isLoggedInHtml(html)) {
    const error = new Error("Session expirée pendant l'attente des slots de flotte");
    error.code = "SESSION_EXPIRED";
    throw error;
  }

  const slots = parseFleetSlotsFromHtml(html);
  const ownSpies = countOwnSpiesInFlight(parseActiveFleetActs(html));

  return {
    ...slots,
    ownSpies,
    loggedIn: true,
  };
}

function isRetryableFleetError(payload) {
  const message = String(payload?.mess ?? "").toLowerCase();
  return /slot|flotte(s)?\s*(pleine|occup)|plus de slot|no free fleet|fleet slot/i.test(message);
}

function checkSlotTimeout(startedAt, options, message) {
  if (options.slotTimeoutMs > 0 && Date.now() - startedAt >= options.slotTimeoutMs) {
    throw new Error(message);
  }
}

async function waitUntilReadyToSend(getClientFn, options) {
  const startedAt = Date.now();
  let lastOwnSpies = -1;
  let stuckSince = Date.now();
  let client = await getClientFn();

  while (true) {
    let status;
    try {
      status = await fetchFleetSlotStatus(client);
    } catch (error) {
      if (error.code === "SESSION_EXPIRED") {
        log.warn("Session expirée — reconnexion automatique…");
        client = await refreshClient();
        stuckSince = Date.now();
        lastOwnSpies = -1;
        continue;
      }
      throw error;
    }

    const freeAfterReserve = status.free - options.reserveSlots;
    const slotOk = !status.slotsKnown || freeAfterReserve > 0;
    const spyOk = status.ownSpies < options.parallel;

    if (slotOk && spyOk) {
      return { client, status };
    }

    if (!spyOk && status.ownSpies === lastOwnSpies) {
      if (Date.now() - stuckSince >= options.staleSpyMs) {
        log.warn(
          `Compteur espion bloqué à ${status.ownSpies} — on continue après ${Math.round(options.staleSpyMs / 1000)}s`
        );
        if (slotOk || !status.slotsKnown) {
          return { client, status };
        }
      }
    } else {
      lastOwnSpies = status.ownSpies;
      stuckSince = Date.now();
    }

    checkSlotTimeout(
      startedAt,
      options,
      `Timeout en attente (${status.used}/${status.max} flottes, ${status.ownSpies} espion(s) en vol)`
    );

    if (!spyOk) {
      const fleetLabel = status.slotsKnown
        ? `flottes ${status.used}/${status.max}`
        : "flottes inconnues";
      log.info(
        `Attente retour espion — ${status.ownSpies}/${options.parallel} en vol, ${fleetLabel}`
      );
    } else {
      log.info(
        `Attente slot libre — ${status.used}/${status.max} flottes, ${Math.max(0, freeAfterReserve)} slot(s) utilisables`
      );
    }

    await sleep(options.slotPollMs);
  }
}

function systemKey(galaxy, system) {
  return `${galaxy}:${system}`;
}

async function loadPlanetIds(client, targets) {
  const bySystem = new Map();

  for (const target of targets) {
    const key = systemKey(target.galaxy, target.system);
    if (!bySystem.has(key)) bySystem.set(key, []);
    bySystem.get(key).push(target);
  }

  const planetIds = new Map();

  for (const [key, systemTargets] of bySystem) {
    const [galaxy, system] = key.split(":").map(Number);
    log.info(`Galaxie ${key}`, { positions: systemTargets.length });
    const result = await fetchGalaxySystem(client, galaxy, system);

    for (const target of systemTargets) {
      const coords = formatCoords(target);
      const entry = result.entries.find((item) => item.position === target.position);
      if (!entry?.planetId) {
        planetIds.set(coords, null);
        continue;
      }
      planetIds.set(coords, {
        planetId: entry.planetId,
        planetName: entry.planetName,
        username: entry.username,
      });
    }
  }

  return planetIds;
}

export async function sendSpyMission(client, target, planetId) {
  const planetCoords = encodePlanetCoords(target.galaxy, target.system, target.position);
  const response = await client.get(
    `game/fleetAjax?ajax=1&mission=${SPY_MISSION}&planetID=${planetId}&planetCoords=${planetCoords}`,
    {
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: `https://play.astrogame.org/uni24/game/galaxy?galaxy=${target.galaxy}&system=${target.system}`,
        "X-Requested-With": "XMLHttpRequest",
      },
      transformResponse: [(data) => data],
    }
  );

  return JSON.parse(response.data);
}

export async function sendSpyMissions(options = {}, client) {
  let http = client ?? (await getClient());
  const getHttp = () => http;
  let targets = [...(options.coords ?? [])];

  if (!targets.length) {
    const filePath = resolve(options.file);
    if (!existsSync(filePath)) {
      throw new Error(`Fichier introuvable : ${filePath}`);
    }
    targets = loadSpyTargets(filePath);
  }

  if (!targets.length) {
    throw new Error("Aucune coordonnée à espionner.");
  }

  const unique = new Map();
  for (const target of targets) {
    unique.set(formatCoords(target), target);
  }
  targets = [...unique.values()];

  const planetMeta = await loadPlanetIds(http, targets);
  const results = [];
  let slotStatus = null;

  if (!options.dryRun) {
    slotStatus = await fetchFleetSlotStatus(http);
    log.info(
      `Flottes ${slotStatus.used}/${slotStatus.max} — ${slotStatus.ownSpies} espion(s) en vol — envoi max ${options.parallel} à la fois`
    );
  }

  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const coords = formatCoords(target);
    const meta = planetMeta.get(coords);

    if (!meta?.planetId) {
      results.push({
        coords,
        ok: false,
        error: "Planète introuvable sur la galaxie (colonie vide ou coords invalides)",
      });
      log.warn(`Skip ${coords}`, { reason: "planète introuvable" });
      continue;
    }

    if (options.dryRun) {
      results.push({
        coords,
        ok: true,
        dryRun: true,
        planetId: meta.planetId,
        planetName: meta.planetName,
        username: meta.username,
        planetCoords: encodePlanetCoords(target.galaxy, target.system, target.position),
      });
      log.info(`[dry-run] ${coords} → ${meta.planetName} (${meta.username})`);
      continue;
    }

    try {
      let payload = null;
      let ok = false;

      for (let attempt = 0; attempt < 8; attempt++) {
        const ready = await waitUntilReadyToSend(getHttp, options);
        http = ready.client;
        slotStatus = ready.status;
        payload = await sendSpyMission(http, target, meta.planetId);
        ok = Number(payload.code) === 600;

        if (ok || !isRetryableFleetError(payload)) {
          break;
        }

        log.warn(`Retry ${coords}`, { message: payload.mess, code: payload.code, attempt: attempt + 1 });
        await sleep(options.slotPollMs);
      }

      results.push({
        coords,
        ok,
        code: payload?.code,
        message: payload?.mess,
        slots: payload?.slots,
        fleetSlots: slotStatus ? `${slotStatus.used}/${slotStatus.max}` : null,
        planetName: meta.planetName,
        username: meta.username,
      });

      if (ok) {
        log.info(`OK ${coords}`, { message: payload.mess, slots: slotStatus ? `${slotStatus.used}/${slotStatus.max}` : "?" });
      } else {
        log.warn(`Échec ${coords}`, { message: payload?.mess, code: payload?.code });
      }
    } catch (error) {
      results.push({
        coords,
        ok: false,
        error: error.message,
        planetName: meta.planetName,
        username: meta.username,
      });
      log.warn(`Erreur ${coords}`, { error: error.message });
    }

    if (!options.dryRun && index < targets.length - 1) {
      const delay = randomDelayMs(options.delayMinMs, options.delayMaxMs);
      await sleep(delay);
    }
  }

  return {
    meta: {
      total: targets.length,
      sentAt: new Date().toISOString(),
      dryRun: Boolean(options.dryRun),
      parallel: options.parallel,
      reserveSlots: options.reserveSlots,
      fleetSlots: slotStatus ? `${slotStatus.used}/${slotStatus.max}` : null,
    },
    results,
  };
}

export function printSpySendSummary(payload) {
  const okCount = payload.results.filter((result) => result.ok).length;
  const failCount = payload.results.length - okCount;
  const mode = payload.meta.dryRun ? "simulation" : "envoi";

  const slotInfo = payload.meta.fleetSlots ? ` — flottes ${payload.meta.fleetSlots}` : "";
  const parallelInfo = payload.meta.parallel ? ` — max ${payload.meta.parallel} espion(s) en parallèle` : "";
  console.log(
    `\nEspionnage (${mode}) — ${okCount} OK / ${failCount} échec(s) sur ${payload.meta.total} cible(s)${slotInfo}${parallelInfo}\n`
  );

  for (const [index, result] of payload.results.entries()) {
    const label = result.planetName
      ? `${result.coords} ${result.planetName} (${result.username ?? "?"})`
      : result.coords;
    const status = result.ok ? "OK" : "KO";
    const detail = result.message ?? result.error ?? (result.dryRun ? "prêt" : "—");
    console.log(`${String(index + 1).padStart(2)}. [${status}] ${label} — ${detail}`);
  }
}
