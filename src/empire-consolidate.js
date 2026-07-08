import * as cheerio from "cheerio";
import { getClient, postForm } from "./client.js";
import { isMoonPlanet, parseResourcesFromHtml, parseShipsFromHtml } from "./empire.js";
import { parseFlightDurationFromStep2 } from "./fleet-active.js";
import { parseCoordLine } from "./spy-send.js";
import { parseGameAmount } from "./attack-loot-send.js";
import { buildShipyardShips, waitForShipCount } from "./shipyard.js";
import { createLogger } from "./logger.js";

const log = createLogger("empire-consolidate");

const SHIP_SMALL_CARGO = "ship202";
const SHIP_ULTIMATE_CARGO = "ship217";
const ULTIMATE_TRANSPORT_SHIP_ID = 217;
const CARGO_SHIPS = [SHIP_ULTIMATE_CARGO, SHIP_SMALL_CARGO];
const TRANSPORT_MISSION = "3";
const DEFAULT_SPEED = "10";
const DEFAULT_SLOT_POLL_MS = 3000;
const DEFAULT_SLOT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_TU_CARGO = 80_000_000;
const DEFAULT_PT_CARGO = 2_000_000;
const TU_BUILD_BATCH_SIZE = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const match = String(html).match(/Flottes\s+(\d+)\s*\/\s*(\d+)/i);
  if (!match) return { used: 0, max: 0, free: 0, slotsKnown: false };
  const used = Number(match[1]);
  const max = Number(match[2]);
  return { used, max, free: Math.max(0, max - used), slotsKnown: true };
}

function parseAvailableShip(html, shipId) {
  const $ = cheerio.load(html);
  const amount = parseGameAmount($(`#${shipId}_value`).attr("data-amount"));
  return amount > 0 ? amount : 0;
}

function readAvailableCargoShips(html) {
  const out = {};
  for (const shipKey of CARGO_SHIPS) {
    out[shipKey] = parseAvailableShip(html, shipKey);
  }
  return out;
}

function parseFleetRoomFromStep2(html) {
  const match = String(html).match(/"fleetRoom"\s*:\s*"(\d+)"/);
  return match ? Number(match[1]) : null;
}

function parseFuelFromStep2(html) {
  const match = String(html).match(/"consumption"\s*:\s*"?(\d+)"?/);
  return match ? Number(match[1]) : 0;
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

function coordsFromCp(planets, cp) {
  const planet = planets.find((p) => Number(p.cp) === Number(cp));
  return planet?.coords ?? null;
}

function targetFromCoords(coords) {
  const parsed = parseCoordLine(coords);
  if (!parsed) throw new Error(`Coords invalides : ${coords}`);
  return parsed;
}

function fleetTableUrl(sourceCp, target) {
  return (
    `game/fleetTable?cp=${sourceCp}` +
    `&galaxy=${target.galaxy}&system=${target.system}&planet=${target.position}` +
    `&planettype=1&target_mission=${TRANSPORT_MISSION}`
  );
}

function loadCargoAmounts(metal, crystal, deut, fleetRoom, fuel = 0) {
  const room = Math.max(0, Number(fleetRoom) || 0);
  const fuelCost = Math.max(0, Number(fuel) || 0);
  const stockDeut = Math.max(0, Number(deut) || 0);
  let remaining = Math.max(0, room - fuelCost);

  const loadedMetal = Math.min(Math.max(0, metal), remaining);
  remaining -= loadedMetal;
  const loadedCrystal = Math.min(Math.max(0, crystal), remaining);
  remaining -= loadedCrystal;
  const deutForCargo = Math.max(0, stockDeut - fuelCost);
  const loadedDeut = Math.min(deutForCargo, remaining);

  return {
    metal: Math.floor(loadedMetal),
    crystal: Math.floor(loadedCrystal),
    deuterium: Math.floor(loadedDeut),
    total: Math.floor(loadedMetal + loadedCrystal + loadedDeut),
  };
}

function tuCapacity(probes) {
  return usableCargoPerShip(probes[SHIP_ULTIMATE_CARGO]) || DEFAULT_TU_CARGO;
}

function ptCapacity(probes) {
  return usableCargoPerShip(probes[SHIP_SMALL_CARGO]) || DEFAULT_PT_CARGO;
}

function usableCargoPerShip(probe) {
  if (!probe?.fleetRoom) return 0;
  return Math.max(0, probe.fleetRoom - (probe.fuel ?? 0));
}

function totalAvailableCargoCapacity(tuCount, ptCount, probes) {
  const tu = Math.max(0, Number(tuCount) || 0);
  const pt = Math.max(0, Number(ptCount) || 0);
  return tu * tuCapacity(probes) + pt * ptCapacity(probes);
}

/** TU à construire seulement si la capacité cargo dispo (TU + PT) est insuffisante. */
function calcUltimateTransportersToBuild(totalCargo, tuCount, ptCount, probes) {
  const cargo = Math.max(0, Number(totalCargo) || 0);
  if (cargo <= 0) return 0;

  const available = totalAvailableCargoCapacity(tuCount, ptCount, probes);
  if (available >= cargo) return 0;

  const deficit = cargo - available;
  const tuCap = tuCapacity(probes);
  if (tuCap <= 0) return 0;
  return Math.ceil(deficit / tuCap);
}

function calcShipsNeeded(totalCargo, perShipCapacity, available) {
  if (totalCargo <= 0 || available <= 0 || perShipCapacity <= 0) return 0;
  return Math.min(available, Math.max(1, Math.ceil(totalCargo / perShipCapacity)));
}

function totalCargoShips(ships = {}) {
  return CARGO_SHIPS.reduce((sum, key) => sum + (ships[key] ?? 0), 0);
}

function selectShipsForTransport(available, totalCargo, probes) {
  const tuAvailable = available[SHIP_ULTIMATE_CARGO] ?? 0;
  if (tuAvailable > 0) {
    const needed = calcShipsNeeded(totalCargo, tuCapacity(probes), tuAvailable);
    if (needed > 0) return { [SHIP_ULTIMATE_CARGO]: needed };
  }

  const ptAvailable = available[SHIP_SMALL_CARGO] ?? 0;
  if (ptAvailable > 0) {
    const needed = calcShipsNeeded(totalCargo, ptCapacity(probes), ptAvailable);
    if (needed > 0) return { [SHIP_SMALL_CARGO]: needed };
  }

  return {};
}

async function runFleetSteps12(client, fleetUrl, hidden, shipCounts) {
  const body1 = {
    ...hidden,
    fmultiply: "1",
    fmultiplySec: "3",
    fmultiplyType: "1",
    fleetgroup: "0",
  };
  for (const [shipKey, count] of Object.entries(shipCounts)) {
    if (count > 0) body1[shipKey] = String(count);
  }

  const step1Html = await postForm(
    client,
    "game/fleetStep1",
    body1,
    `https://play.astrogame.org/uni24/${fleetUrl}`
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

  return { ok: true, body2, step2Html };
}

async function probeCargoCapacity(client, sourceCp, target, cache) {
  const cacheKey = `${sourceCp}:${target.galaxy}:${target.system}:${target.position}`;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);

  const url = fleetTableUrl(sourceCp, target);
  const step0Html = String(
    (
      await client.get(url, {
        headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
      })
    ).data
  );
  const hidden = parseFleetStep1Hidden(step0Html);
  const probes = {};

  for (const shipKey of CARGO_SHIPS) {
    if (!parseAvailableShip(step0Html, shipKey)) continue;
    const steps = await runFleetSteps12(client, url, hidden, { [shipKey]: 1 });
    if (!steps.ok) continue;
    probes[shipKey] = {
      fleetRoom: parseFleetRoomFromStep2(steps.step2Html),
      fuel: parseFuelFromStep2(steps.step2Html),
    };
  }

  if (!probes[SHIP_ULTIMATE_CARGO]) {
    probes[SHIP_ULTIMATE_CARGO] = { fleetRoom: DEFAULT_TU_CARGO, fuel: 0 };
  }
  if (!probes[SHIP_SMALL_CARGO]) {
    probes[SHIP_SMALL_CARGO] = { fleetRoom: DEFAULT_PT_CARGO, fuel: 0 };
  }

  cache?.set(cacheKey, probes);
  return probes;
}

async function readAvailableCargoShipsOnPlanet(client, cp) {
  const fleetRes = await client.get(`game/fleetTable?cp=${cp}`, {
    headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
  });
  return readAvailableCargoShips(String(fleetRes.data));
}

async function buildUltimateTransportersInBatches(client, cp, currentTu, totalToBuild, options = {}) {
  if (totalToBuild <= 0) return { built: 0 };

  const batchSize = options.tuBuildBatch ?? TU_BUILD_BATCH_SIZE;
  let built = 0;
  let remaining = totalToBuild;
  let expectedTu = currentTu;

  log.info(`Chantier cp ${cp} — ${totalToBuild} TU à construire (actuellement ${currentTu} TU dispo)`, {
    targetCoords: options.targetCoords,
    remainingCargo: options.remainingCargo,
  });

  while (remaining > 0) {
    const batch = Math.min(remaining, batchSize);
    options.onPlanet?.({
      phase: "build",
      source: options.source,
      targetCoords: options.targetCoords,
      message: `Construction de ${batch} TU (${built + batch}/${totalToBuild})…`,
      count: batch,
      total: totalToBuild,
      progress: built + batch,
    });

    await buildShipyardShips(client, { [ULTIMATE_TRANSPORT_SHIP_ID]: batch }, { cp });
    built += batch;
    remaining -= batch;
    expectedTu += batch;

    await waitForShipCount(client, cp, SHIP_ULTIMATE_CARGO, expectedTu, {
      pollMs: options.ptPollMs ?? DEFAULT_SLOT_POLL_MS,
      timeoutMs: options.ptWaitMs ?? DEFAULT_SLOT_TIMEOUT_MS,
    });
  }

  log.info(`Construit ${built} TU sur cp ${cp} — total dispo ${expectedTu}`);
  return { built };
}

async function waitForFleetSlot(client, options) {
  const startedAt = Date.now();
  while (true) {
    const html = String(
      (
        await client.get("game/fleetTable", {
          headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
        })
      ).data
    );
    const slots = parseFleetSlotsFromHtml(html);
    const freeAfterReserve = slots.free - (options.reserveSlots ?? 1);
    if (!slots.slotsKnown || freeAfterReserve > 0) return { slots, html };

    if (options.slotTimeoutMs > 0 && Date.now() - startedAt >= options.slotTimeoutMs) {
      throw new Error(`Timeout en attente d'un slot de flotte (${slots.used}/${slots.max})`);
    }

    log.info(`Attente slot flotte — ${slots.used}/${slots.max}`);
    await sleep(options.slotPollMs ?? DEFAULT_SLOT_POLL_MS);
  }
}

export async function sendResourceTransport(client, params) {
  const { sourceCp, target, metal = 0, crystal = 0, deut = 0, probes = {} } = params;

  if (!sourceCp) throw new Error("Planète source manquante (cp)");
  if (!target?.galaxy || !target?.system || !target?.position) {
    throw new Error("Cible invalide");
  }

  const totalCargo = metal + crystal + deut;
  if (totalCargo <= 0) {
    return { ok: false, skipped: true, error: "Aucune ressource à envoyer" };
  }

  const url = fleetTableUrl(sourceCp, target);
  const step0Html = String(
    (
      await client.get(url, {
        headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
      })
    ).data
  );

  const available = readAvailableCargoShips(step0Html);
  if (totalCargoShips(available) <= 0) {
    return { ok: false, error: "Aucun vaisseau cargo disponible (TU/PT)", available };
  }

  let selectedShips = selectShipsForTransport(available, totalCargo, probes);
  if (!Object.keys(selectedShips).length) {
    return { ok: false, error: "Aucun vaisseau cargo sélectionnable", available };
  }

  const hidden = parseFleetStep1Hidden(step0Html);
  const primaryKey = selectedShips[SHIP_ULTIMATE_CARGO] ? SHIP_ULTIMATE_CARGO : SHIP_SMALL_CARGO;
  const perShipCap = primaryKey === SHIP_ULTIMATE_CARGO ? tuCapacity(probes) : ptCapacity(probes);
  const maxShips = available[primaryKey] ?? 0;

  while (true) {
    const steps = await runFleetSteps12(client, url, hidden, selectedShips);
    if (!steps.ok) {
      return { ok: false, error: steps.error };
    }

    const { body2, step2Html } = steps;
    const fleetRoom = parseFleetRoomFromStep2(step2Html);
    const fuel = parseFuelFromStep2(step2Html);
    const cargo = loadCargoAmounts(metal, crystal, deut, fleetRoom, fuel);

    const shipCount = selectedShips[primaryKey] ?? 0;
    if (cargo.total <= 0) {
      if (shipCount < maxShips) {
        const needed = Math.min(maxShips, Math.max(shipCount + 1, calcShipsNeeded(totalCargo, perShipCap, maxShips)));
        if (needed > shipCount) {
          log.info(`Cargo nul avec ${shipCount} vaisseau(x) — essai avec ${needed}`, { fleetRoom, fuel });
          selectedShips = { [primaryKey]: needed };
          continue;
        }
      }
      return {
        ok: false,
        error: "Capacité cargo insuffisante pour charger des ressources",
        ships: selectedShips,
        fleetRoom,
        fuel,
      };
    }

    if (cargo.total < totalCargo * 0.99 && shipCount < maxShips) {
      const needed = calcShipsNeeded(totalCargo, perShipCap, maxShips);
      if (needed > shipCount) {
        selectedShips = { [primaryKey]: needed };
        continue;
      }
    }

    const $2 = cheerio.load(step2Html);
    const step3Form = $2('form[action*="fleetStep3"]').first();
    if (!step3Form.length) {
      return { ok: false, error: parsePageMessage(step2Html).message || "Formulaire fleetStep3 introuvable" };
    }

    const body3 = {
      mission: TRANSPORT_MISSION,
      metal: String(cargo.metal),
      crystal: String(cargo.crystal),
      deuterium: String(cargo.deuterium),
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
    return {
      ok: result.ok,
      message: result.message,
      ships: selectedShips,
      cargo,
      fleetRoom,
      fuel,
      remaining: {
        metal: Math.max(0, metal - cargo.metal),
        crystal: Math.max(0, crystal - cargo.crystal),
        deut: Math.max(0, deut - cargo.deuterium),
      },
      durationOutSec: parseFlightDurationFromStep2(step2Html),
    };
  }
}

async function readPlanetState(client, cp) {
  const [ovRes, fleetRes] = await Promise.all([
    client.get(`game/overview?cp=${cp}`, {
      headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
    }),
    client.get(`game/fleetTable?cp=${cp}`, {
      headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
    }),
  ]);
  const res = parseResourcesFromHtml(String(ovRes.data));
  const ships = parseShipsFromHtml(String(fleetRes.data));
  return { ...res, ships };
}

export async function sendAllResourcesToPlanet(options = {}, client) {
  const http = client ?? (await getClient());
  const targetCp = Number(options.targetCp);
  if (!targetCp) throw new Error("Planète destination requise (targetCp)");

  const planets = (options.planets ?? []).filter((p) => p?.cp && !p.isMoon && !isMoonPlanet(p));
  const targetCoords = coordsFromCp(planets, targetCp) ?? options.targetCoords;
  if (!targetCoords) throw new Error("Impossible de résoudre les coords de la destination");

  const target = targetFromCoords(targetCoords);
  const sources = planets.filter((p) => Number(p.cp) !== targetCp);
  const capacityCache = new Map();

  const results = [];
  let sent = 0;

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    let flights = 0;
    let builtTu = 0;
    let lastCargo = null;
    let lastError = null;

    options.onPlanet?.({
      phase: "start",
      source,
      targetCoords,
      index: index + 1,
      total: sources.length,
    });

    const initialLive = await readPlanetState(http, source.cp);
    const snapshotMetal = initialLive.metal;
    const snapshotCrystal = initialLive.crystal;
    const snapshotDeut = initialLive.deut;
    let metal = snapshotMetal;
    let crystal = snapshotCrystal;
    let deut = snapshotDeut;
    let probes = {};

    if (snapshotMetal + snapshotCrystal + snapshotDeut <= 0) {
      results.push({
        sourceCp: source.cp,
        sourceCoords: source.coords,
        targetCoords,
        ok: false,
        skipped: true,
        flights: 0,
        message: "Rien à envoyer",
      });
      continue;
    }

    try {
      probes = await probeCargoCapacity(http, source.cp, target, capacityCache);
    } catch (error) {
      lastError = error.message ?? "Échec sonde capacité cargo";
    }

    let transportSent = false;
    while (!lastError && !transportSent && metal + crystal + deut > 0) {
      const available = await readAvailableCargoShipsOnPlanet(http, source.cp);
      const tu = available[SHIP_ULTIMATE_CARGO] ?? 0;
      const pt = available[SHIP_SMALL_CARGO] ?? 0;
      const remainingCargo = metal + crystal + deut;
      const capacity = totalAvailableCargoCapacity(tu, pt, probes);

      log.info(`${source.coords} → ${targetCoords} — cargo ${remainingCargo}, TU ${tu}, PT ${pt}, cap ${capacity}`, {
        tuCap: tuCapacity(probes),
        ptCap: ptCapacity(probes),
      });

      if (tu + pt <= 0) {
        lastError = "Aucun vaisseau cargo disponible sur cette planète";
        break;
      }

      if (capacity < remainingCargo) {
        const extraTu = calcUltimateTransportersToBuild(remainingCargo, tu, pt, probes);
        if (extraTu > 0) {
          try {
            const buildResult = await buildUltimateTransportersInBatches(
              http,
              source.cp,
              tu,
              extraTu,
              { ...options, source, targetCoords, remainingCargo }
            );
            builtTu += buildResult.built ?? 0;
          } catch (error) {
            lastError = error.message ?? "Échec construction transporteurs ultimes";
            break;
          }
          continue;
        }
      }

      await waitForFleetSlot(http, options);
      const payload = await sendResourceTransport(http, {
        sourceCp: source.cp,
        target,
        metal,
        crystal,
        deut,
        probes,
      });

      flights += 1;
      if (!payload.ok) {
        if (payload.skipped) break;
        lastError = payload.error ?? payload.message ?? "Échec transport";
        break;
      }

      lastCargo = payload.cargo ?? null;
      sent += 1;
      transportSent = true;

      const leftover =
        (payload.remaining?.metal ?? 0) + (payload.remaining?.crystal ?? 0) + (payload.remaining?.deut ?? 0);
      if (leftover > 0) {
        log.info(
          `${source.coords} — ${leftover} ressources non envoyées (snapshot initial, 1 vol par planète)`,
          payload.remaining
        );
      }

      options.onPlanet?.({
        phase: "flight",
        source,
        targetCoords,
        flights,
        cargo: payload.cargo,
        ships: payload.ships,
        leftover: leftover > 0 ? payload.remaining : undefined,
      });
      break;
    }

    const entry = {
      sourceCp: source.cp,
      sourceCoords: source.coords,
      targetCoords,
      ok: !lastError && flights > 0,
      skipped: flights === 0 && !lastError,
      error: lastError ?? undefined,
      flights,
      builtTu: builtTu || undefined,
      cargo: lastCargo,
      message: lastError
        ? lastError
        : builtTu > 0
          ? `${flights} vol(s) — ${builtTu} TU construit(s)`
          : flights === 1
              ? "Transport envoyé"
              : "Rien à envoyer",
    };
    results.push(entry);

    if (entry.ok) {
      log.info(`OK ${source.coords} → ${targetCoords}`, {
        flights: entry.flights,
        builtTu: entry.builtTu,
        cargo: entry.cargo?.total,
      });
    } else if (!entry.skipped) {
      log.warn(`Échec ${source.coords}`, { error: entry.error });
    }

    options.onPlanet?.({
      phase: "done",
      source,
      targetCoords,
      result: entry,
      index: index + 1,
      total: sources.length,
    });

    if (options.delayMs) await sleep(options.delayMs);
  }

  return {
    targetCp,
    targetCoords,
    sent,
    results,
    sources: sources.length,
  };
}
