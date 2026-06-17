import { readFileSync, existsSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import { getClient, postForm } from "./client.js";
import { paths } from "./paths.js";
import { isSansDefense } from "./spy-reports.js";
import {
  extractFleetTiming,
  findOwnAttackFleet,
  formatDurationSec,
  formatShipsLabel,
  parseActiveFleetActs,
  parseFlightDurationFromStep2,
  parsePlanetByCp,
} from "./fleet-active.js";
import { formatCoords, loadSpyTargets, parseCoordLine } from "./spy-send.js";
import { createLogger } from "./logger.js";
import {
  getAttackedTodayCoords,
  mergeAttackRecords,
  normalizeAttacksStore,
  serializeAttacksStore,
} from "./attacks-history.js";

const log = createLogger("attack-loot");
const SHIP_SMALL_CARGO = "ship202";
const SHIP_BATTLE = "ship207";
const ATTACK_MISSION = "1";
const LOOT_FRACTION = 0.5;
const CARGO_PER_TRANSPORT = Number(process.env.ATTACK_LOOT_CARGO_PT) || 10_000_000;
const BASE_TRANSPORT_COUNT = Number(process.env.ATTACK_LOOT_BASE_PT) || 2000;
const TRANSPORT_STEP = Number(process.env.ATTACK_LOOT_STEP_PT) || 500;
const LOOT_TIER_SIZE = Number(process.env.ATTACK_LOOT_TIER_MD) || 1_000_000_000;
const DEFAULT_SPEED = "10";
const DEFAULT_SLOT_POLL_MS = 3000;
const DEFAULT_SLOT_TIMEOUT_MS = 15 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function readFormField($, el) {
  const $el = $(el);
  const tag = $el.prop("tagName")?.toLowerCase();
  if (tag === "select") {
    const selected = $el.find("option[selected], option[selected='selected']").first();
    if (selected.length) return selected.attr("value") ?? "";
    return $el.find("option").first().attr("value") ?? "";
  }
  if ($el.attr("type") === "radio" || $el.attr("type") === "checkbox") {
    if ($el.attr("checked")) return $el.attr("value") ?? "on";
    return undefined;
  }
  return $el.attr("value") ?? "";
}

function parseFleetSlotsFromHtml(html) {
  const text = String(html);
  const fleetMatch = text.match(/Flottes\s+(\d+)\s*\/\s*(\d+)/i);
  if (!fleetMatch) return { used: 0, max: 0, free: 0, slotsKnown: false };
  const used = Number(fleetMatch[1]);
  const max = Number(fleetMatch[2]);
  return { used, max, free: Math.max(0, max - used), slotsKnown: true };
}

function parseMainPlanetCp(html) {
  const $ = cheerio.load(html);
  const selectors = ["#planetSelector option", "#planetSelectorMobile option"];
  for (const selector of selectors) {
    const main = $(selector)
      .filter((_, el) => /main\s*plan[eè]te/i.test($(el).text()))
      .first();
    if (main.length) {
      return {
        cp: Number(main.attr("value")) || null,
        label: main.text().replace(/\s+/g, " ").trim(),
        coords: main.text().match(/\[(\d+:\d+:\d+)\]/)?.[1] ?? null,
      };
    }
  }
  const first = $("#planetSelector option").first();
  return {
    cp: Number(first.attr("value")) || null,
    label: first.text().replace(/\s+/g, " ").trim(),
    coords: first.text().match(/\[(\d+:\d+:\d+)\]/)?.[1] ?? null,
  };
}

/** Parse les montants Astrogame (ex. data-amount="105.157" → 105157). */
export function parseGameAmount(value) {
  const raw = String(value ?? "")
    .trim()
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "");
  if (!raw) return 0;

  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    return Number(raw.replace(/\./g, "")) || 0;
  }

  const normalized = raw.includes(",") && !raw.includes(".")
    ? raw.replace(",", ".")
    : raw.replace(/,/g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.floor(amount) : 0;
}

function parseAvailableShip(html, shipId) {
  const $ = cheerio.load(html);
  const amount = parseGameAmount($(`#${shipId}_value`).attr("data-amount"));
  return amount > 0 ? amount : 0;
}

function parseAvailableSmallTransports(html) {
  return parseAvailableShip(html, "ship202");
}

function parseFleetRoomFromStep2(html) {
  const match = String(html).match(/"fleetRoom"\s*:\s*"(\d+)"/);
  return match ? Number(match[1]) : null;
}

function parseFleetStep1Hidden(html) {
  const $ = cheerio.load(html);
  const hidden = {};
  $('form[action*="fleetStep1"] input[type="hidden"]').each((_, el) => {
    const name = $(el).attr("name");
    const value = $(el).attr("value") ?? "";
    if (name) hidden[name] = value;
  });
  return hidden;
}

function parsePageMessage(html) {
  const $ = cheerio.load(html);
  const text = $("section").text().replace(/\s+/g, " ").trim();
  if (text.includes("Flotte envoyée")) return { ok: true, message: "Flotte envoyée" };
  const info = $("section p").text().replace(/\s+/g, " ").trim();
  if (info) return { ok: false, message: info };
  return { ok: false, message: text.slice(0, 300) || "Réponse inconnue" };
}

function roundTransportsToPolicy(rawCount) {
  const needed = Math.max(0, Math.ceil(Number(rawCount) || 0));
  if (needed <= BASE_TRANSPORT_COUNT) return BASE_TRANSPORT_COUNT;
  const extra = needed - BASE_TRANSPORT_COUNT;
  return BASE_TRANSPORT_COUNT + Math.ceil(extra / TRANSPORT_STEP) * TRANSPORT_STEP;
}

export function calcSmallTransportsForLoot(loot, margin = 1.05) {
  const totalLoot = Math.max(0, Number(loot) || 0);
  if (totalLoot <= 0) return BASE_TRANSPORT_COUNT;

  const stealable = totalLoot * LOOT_FRACTION * margin;

  // 2 000 PT de base, +500 PT par Md de butin total au-delà du 1er Md
  const lootMd = totalLoot / LOOT_TIER_SIZE;
  const lootTier =
    BASE_TRANSPORT_COUNT + Math.max(0, Math.ceil(lootMd) - 1) * TRANSPORT_STEP;

  // Sécurité cargo : arrondi au palier de 500 au-dessus de la base
  const cargoRaw = Math.ceil(stealable / CARGO_PER_TRANSPORT);
  const cargoTier = roundTransportsToPolicy(cargoRaw);

  return Math.max(lootTier, cargoTier);
}

export function parseAttackLootOptions(args) {
  const options = {
    file: null,
    coords: [],
    spyJson: null,
    dryRun: false,
    cp: null,
    reserveSlots: 1,
    slotPollMs: Number(process.env.ATTACK_LOOT_SLOT_POLL_MS) || DEFAULT_SLOT_POLL_MS,
    slotTimeoutMs: Number(process.env.ATTACK_LOOT_SLOT_TIMEOUT_MS) || DEFAULT_SLOT_TIMEOUT_MS,
    delayMinMs: Number(process.env.ATTACK_LOOT_DELAY_MIN_MS) || 400,
    delayMaxMs: Number(process.env.ATTACK_LOOT_DELAY_MAX_MS) || 900,
    minLoot: 0,
    sansDefenseOnly: true,
    battleShips: 0,
    skipAttackedFile: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--file") options.file = args[++i];
    else if (arg === "--spy-json") options.spyJson = args[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--cp") options.cp = Number(args[++i]);
    else if (arg === "--reserve-slots") options.reserveSlots = Number(args[++i]);
    else if (arg === "--min-loot") options.minLoot = Number(args[++i]);
    else if (arg === "--battle-ships") options.battleShips = Number(args[++i]) || 0;
    else if (arg === "--skip-attacked") options.skipAttackedFile = args[++i] ?? paths.attacks.import();
    else if (arg === "--all-reports") options.sansDefenseOnly = false;
    else if (/^\d+:\d+:\d+$/.test(arg)) {
      const target = parseCoordLine(arg);
      if (target) options.coords.push(target);
    }
  }

  return options;
}

function loadSkipCoordsSet(skipAttackedFile) {
  if (!skipAttackedFile) return new Set();
  const filePath = resolve(skipAttackedFile);
  if (!existsSync(filePath)) return new Set();
  const payload = JSON.parse(readFileSync(filePath, "utf8"));
  return getAttackedTodayCoords(payload);
}

function loadSpyMetaMap(spyJsonPath) {
  if (!existsSync(spyJsonPath)) return new Map();
  const payload = JSON.parse(readFileSync(spyJsonPath, "utf8"));
  const map = new Map();
  for (const report of payload.reports ?? []) {
    const coords = report.coords;
    const existing = map.get(coords);
    if (!existing || (report.timestamp ?? 0) > (existing.timestamp ?? 0)) {
      map.set(coords, report);
    }
  }
  return map;
}

export function buildAttackTargets(options) {
  let coords = [...options.coords];
  if (!coords.length && options.file) {
    coords = loadSpyTargets(resolve(options.file));
  }
  if (!coords.length) {
    throw new Error("Aucune coordonnée cible (utilise --file ou des coords G:S:P).");
  }

  const unique = new Map();
  for (const target of coords) unique.set(formatCoords(target), target);

  const spyJsonPath = options.spyJson ? resolve(options.spyJson) : paths.spy.lootTargets();
  const spyMeta = loadSpyMetaMap(spyJsonPath);
  const skipCoords = loadSkipCoordsSet(options.skipAttackedFile);
  const targets = [];

  for (const [coords, target] of unique) {
    if (skipCoords.has(coords)) {
      log.warn(`Skip ${coords}`, { reason: "déjà attaqué aujourd'hui" });
      continue;
    }

    const report = spyMeta.get(coords);
    if (options.sansDefenseOnly) {
      if (!report) {
        log.warn(`Skip ${coords}`, { reason: "pas de rapport espionnage" });
        continue;
      }
      if (!isSansDefense(report)) {
        log.warn(`Skip ${coords}`, { reason: "défense ou flotte détectée" });
        continue;
      }
    }

    const loot = Number(report?.loot) || 0;
    if (loot < options.minLoot) continue;

    targets.push({
      ...target,
      coords,
      loot,
      lootFormatted: report?.lootFormatted ?? String(loot),
      planetName: report?.planetName ?? null,
      username: report?.username ?? null,
      ships: calcSmallTransportsForLoot(loot),
      battleShips: options.battleShips,
    });
  }

  targets.sort((a, b) => b.loot - a.loot);
  return targets;
}

async function waitForFleetSlot(client, options) {
  const startedAt = Date.now();
  while (true) {
    const html = String(
      (await client.get("game/fleetTable", {
        headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
      })).data
    );
    const slots = parseFleetSlotsFromHtml(html);
    const freeAfterReserve = slots.free - options.reserveSlots;
    if (!slots.slotsKnown || freeAfterReserve > 0) return { client, slots, html };

    if (options.slotTimeoutMs > 0 && Date.now() - startedAt >= options.slotTimeoutMs) {
      throw new Error(`Timeout en attente d'un slot de flotte (${slots.used}/${slots.max})`);
    }

    log.info(`Attente slot flotte — ${slots.used}/${slots.max}`);
    await sleep(options.slotPollMs);
  }
}

async function resolveSourcePlanet(client, cpOverride) {
  const html = String(
    (await client.get("game/overview", {
      headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
    })).data
  );
  if (cpOverride) {
    const planet = parsePlanetByCp(html, cpOverride);
    if (planet.coords) {
      log.info(`Départ : ${planet.label}`);
      return planet;
    }
  }
  const main = parseMainPlanetCp(html);
  if (!main.cp) throw new Error("Impossible de détecter la Main Planète (cp).");
  log.info(`Départ : ${main.label}`);
  return main;
}

export async function sendLootAttack(client, target, options) {
  const cp = options.cp;
  if (!cp) throw new Error("cp manquant (planète de départ)");
  const fleetTableUrl = `game/fleetTable?cp=${cp}&galaxy=${target.galaxy}&system=${target.system}&planet=${target.position}&planettype=1&target_mission=1`;
  const step0Html = String(
    (await client.get(fleetTableUrl, {
      headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
    })).data
  );

  const needed = target.ships;
  const battleNeeded = Math.max(0, Number(target.battleShips) || 0);
  const available = parseAvailableSmallTransports(step0Html);
  const availableBattle = parseAvailableShip(step0Html, "ship207");
  if (available <= 0 && battleNeeded <= 0) {
    return { ok: false, error: "Aucun petit transporteur disponible sur la planète de départ" };
  }
  if (available < needed) {
    return {
      ok: false,
      error: `PT insuffisants sur Main : ${available.toLocaleString("fr-FR")} dispo, ${needed.toLocaleString("fr-FR")} requis pour le butin`,
      ships: 0,
      available,
      needed,
    };
  }
  if (battleNeeded > 0 && availableBattle < battleNeeded) {
    return {
      ok: false,
      error: `VB insuffisants sur Main : ${availableBattle.toLocaleString("fr-FR")} dispo, ${battleNeeded.toLocaleString("fr-FR")} requis`,
      ships: 0,
      availableBattle,
      battleNeeded,
    };
  }
  const ships = needed;

  const hidden = parseFleetStep1Hidden(step0Html);
  const body1 = {
    ...hidden,
    fmultiply: "1",
    fmultiplySec: "3",
    fmultiplyType: "1",
    fleetgroup: "0",
    [SHIP_SMALL_CARGO]: String(ships),
  };
  if (battleNeeded > 0) body1[SHIP_BATTLE] = String(battleNeeded);

  const step1Html = await postForm(
    client,
    "game/fleetStep1",
    body1,
    `https://play.astrogame.org/uni24/${fleetTableUrl}`
  );

  const $1 = cheerio.load(step1Html);
  const step2Form = $1('form[action*="fleetStep2"]').first();
  if (!step2Form.length) {
    return { ok: false, error: parsePageMessage(step1Html).message || "Formulaire fleetStep2 introuvable" };
  }

  const body2 = {};
  step2Form.find("input, select").each((_, el) => {
    const name = $1(el).attr("name");
    if (!name || name.startsWith("shortcut")) return;
    const value = readFormField($1, el);
    if (value !== undefined) body2[name] = value;
  });
  if (!body2.speed) body2.speed = DEFAULT_SPEED;
  if (!body2.type) body2.type = "1";

  const step2Html = await postForm(
    client,
    "game/fleetStep2",
    body2,
    "https://play.astrogame.org/uni24/game/fleetStep1"
  );
  const flightDurationSec = parseFlightDurationFromStep2(step2Html);

  const $2 = cheerio.load(step2Html);
  const step3Form = $2('form[action*="fleetStep3"]').first();
  if (!step3Form.length) {
    return { ok: false, error: parsePageMessage(step2Html).message || "Formulaire fleetStep3 introuvable" };
  }

  const fleetRoom = parseFleetRoomFromStep2(step2Html);
  const stealable = Math.max(0, Number(target.loot) || 0) * LOOT_FRACTION;
  if (fleetRoom != null && stealable > 0 && fleetRoom < stealable * 0.95) {
    return {
      ok: false,
      error: `Capacité cargo insuffisante : ${fleetRoom.toLocaleString("fr-FR")} pour ~${Math.round(stealable).toLocaleString("fr-FR")} pillables`,
      ships,
      available,
      needed,
      fleetRoom,
    };
  }

  const body3 = {
    mission: ATTACK_MISSION,
    metal: "0",
    crystal: "0",
    deuterium: "0",
    staytime: "1",
    token: body2.token,
    transferLimitCheck: "0",
  };

  const step3Html = await postForm(
    client,
    "game/fleetStep3",
    body3,
    "https://play.astrogame.org/uni24/game/fleetStep2"
  );

  const result = parsePageMessage(step3Html);
  const base = {
    ok: result.ok,
    message: result.message,
    ships,
    battleShips: battleNeeded,
    available,
    needed,
    fleetRoom: fleetRoom ?? undefined,
    sourceCp: cp,
    sourceCoords: options.sourcePlanet?.coords ?? null,
    sourceLabel: options.sourcePlanet?.label ?? null,
    targetCoords: formatCoords(target),
    shipsLabel: formatShipsLabel(ships, battleNeeded),
    flightDurationSec,
  };

  if (!result.ok) return base;

  let timing = extractFleetTiming(null, flightDurationSec);
  try {
    const fleetHtml = String(
      (await client.get(`game/fleetTable?cp=${cp}`, {
        headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
      })).data
    );
    const activeFleet = findOwnAttackFleet(
      parseActiveFleetActs(fleetHtml),
      formatCoords(target),
      options.sourcePlanet?.coords ?? null
    );
    if (activeFleet) timing = extractFleetTiming(activeFleet, flightDurationSec);
  } catch {
    /* garder l'estimation step2 */
  }

  return {
    ...base,
    durationOutSec: timing.durationOutSec,
    durationReturnSec: timing.durationReturnSec,
    arrivalAt: timing.arrivalAt,
    returnAt: timing.returnAt,
    durationOutFormatted: formatDurationSec(timing.durationOutSec),
    durationReturnFormatted: formatDurationSec(timing.durationReturnSec),
  };
}

export async function sendAttackLootMissions(options = {}, client) {
  const http = client ?? (await getClient());
  const targets = buildAttackTargets(options);
  if (!targets.length) {
    throw new Error("Aucune cible éligible (sans défense + rapport espionnage).");
  }

  const results = [];
  let slotStatus = null;

  log.info(`${targets.length} cible(s) à attaquer`);

  if (!options.dryRun) {
    const sourcePlanet = await resolveSourcePlanet(http, options.cp);
    options.cp = sourcePlanet.cp;
    options.sourcePlanet = sourcePlanet;
  }

  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const label = target.planetName
      ? `${target.coords} ${target.planetName} (${target.username ?? "?"})`
      : target.coords;

    if (options.dryRun) {
      results.push({
        coords: target.coords,
        ok: true,
        dryRun: true,
        ships: target.ships,
        loot: target.loot,
        lootFormatted: target.lootFormatted,
      });
      log.info(`[dry-run] ${label} — ${target.ships} PT — butin ${target.lootFormatted}`);
      continue;
    }

    try {
      const ready = await waitForFleetSlot(http, options);
      slotStatus = ready.slots;
      const payload = await sendLootAttack(http, target, options);
      results.push({
        coords: target.coords,
        ok: payload.ok,
        message: payload.message ?? payload.error,
        ships: payload.ships,
        battleShips: payload.battleShips ?? target.battleShips,
        shipsLabel: payload.shipsLabel ?? formatShipsLabel(payload.ships, payload.battleShips),
        needed: target.ships,
        loot: target.loot,
        lootFormatted: target.lootFormatted,
        planetName: target.planetName,
        username: target.username,
        fleetSlots: slotStatus ? `${slotStatus.used}/${slotStatus.max}` : null,
        sourceCp: options.cp,
        sourceCoords: payload.sourceCoords ?? options.sourcePlanet?.coords ?? null,
        sourceLabel: payload.sourceLabel ?? options.sourcePlanet?.label ?? null,
        targetCoords: payload.targetCoords ?? target.coords,
        durationOutSec: payload.durationOutSec,
        durationReturnSec: payload.durationReturnSec,
        durationOutFormatted: payload.durationOutFormatted,
        durationReturnFormatted: payload.durationReturnFormatted,
        arrivalAt: payload.arrivalAt,
        returnAt: payload.returnAt,
      });

      if (payload.ok) {
        log.info(`OK ${label}`, {
          ships: `${payload.ships}/${target.ships} PT`,
          battleShips: payload.battleShips ? `${payload.battleShips} VB` : undefined,
          cargo: payload.fleetRoom ? `${Math.round(payload.fleetRoom / 1_000_000)}M` : "?",
          butin: target.lootFormatted,
        });
      } else {
        log.warn(`Échec ${label}`, { message: payload.message ?? payload.error });
      }
    } catch (error) {
      results.push({
        coords: target.coords,
        ok: false,
        error: error.message,
        lootFormatted: target.lootFormatted,
        planetName: target.planetName,
        username: target.username,
      });
      log.warn(`Erreur ${label}`, { error: error.message });
    }

    if (!options.dryRun && index < targets.length - 1) {
      const delay =
        Math.floor(Math.random() * (options.delayMaxMs - options.delayMinMs + 1)) + options.delayMinMs;
      await sleep(delay);
    }
  }

  const payload = {
    meta: {
      total: targets.length,
      sentAt: new Date().toISOString(),
      dryRun: Boolean(options.dryRun),
      reserveSlots: options.reserveSlots,
      fleetSlots: slotStatus ? `${slotStatus.used}/${slotStatus.max}` : null,
      sourceCp: options.cp ?? null,
      sourceCoords: options.sourcePlanet?.coords ?? null,
      sourceLabel: options.sourcePlanet?.label ?? null,
    },
    results,
  };

  if (!options.dryRun) {
    saveAttacksImportFile(payload.results);
  }

  return payload;
}

function saveAttacksImportFile(results) {
  const okCoords = results.filter((result) => result.ok).map((result) => result.coords);
  if (!okCoords.length) return;

  const filePath = paths.attacks.import();
  let existing = null;
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      existing = null;
    }
  }

  const store = mergeAttackRecords(existing, okCoords, { source: "attack-loot" });
  saveAttacksStore(store);
  log.info(`Export extension → ${paths.attacks.import()}`, { count: okCoords.length });
}

export function saveAttacksStore(storeRaw) {
  const normalized = normalizeAttacksStore(storeRaw);
  const meta = storeRaw && typeof storeRaw === "object" && storeRaw.meta ? storeRaw.meta : {};
  const payload = serializeAttacksStore(normalized, meta);
  const filePath = paths.attacks.import();
  writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
  copyFileSync(filePath, paths.attacks.extensionImport());
  return payload;
}

export function printAttackLootSummary(payload) {
  const okCount = payload.results.filter((result) => result.ok).length;
  const failCount = payload.results.length - okCount;
  const mode = payload.meta.dryRun ? "simulation" : "envoi";
  const slotInfo = payload.meta.fleetSlots ? ` — flottes ${payload.meta.fleetSlots}` : "";

  console.log(
    `\nAttaques pillage (${mode}) — ${okCount} OK / ${failCount} échec(s) sur ${payload.meta.total} cible(s)${slotInfo}\n`
  );

  for (const [index, result] of payload.results.entries()) {
    const label = result.planetName
      ? `${result.coords} ${result.planetName} (${result.username ?? "?"})`
      : result.coords;
    const status = result.ok ? "OK" : "KO";
    const shipParts = [];
    if (result.ships) shipParts.push(`${result.ships} PT`);
    else if (result.needed) shipParts.push(`0/${result.needed} PT`);
    if (result.battleShips) shipParts.push(`${result.battleShips} VB`);
    const ships = shipParts.length ? shipParts.join(" + ") : "—";
    const detail = result.message ?? result.error ?? (result.dryRun ? "prêt" : "—");
    const loot = result.lootFormatted ?? "—";
    console.log(
      `${String(index + 1).padStart(2)}. [${status}] ${label} — ${ships} — butin ${loot} — ${detail}`
    );
  }
}
