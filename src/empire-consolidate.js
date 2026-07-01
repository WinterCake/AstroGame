import * as cheerio from "cheerio";
import { getClient, postForm } from "./client.js";
import { isMoonPlanet, parseResourcesFromHtml, parseShipsFromHtml } from "./empire.js";
import { parseFlightDurationFromStep2 } from "./fleet-active.js";
import { parseCoordLine } from "./spy-send.js";
import { parseGameAmount } from "./attack-loot-send.js";
import { createLogger } from "./logger.js";

const log = createLogger("empire-consolidate");

const SHIP_SMALL_CARGO = "ship202";
const TRANSPORT_MISSION = "3";
const DEFAULT_SPEED = "10";
const DEFAULT_SLOT_POLL_MS = 3000;
const DEFAULT_SLOT_TIMEOUT_MS = 15 * 60 * 1000;

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

function loadCargoAmounts(metal, crystal, deut, fleetRoom, fuel = 0) {
  const room = Math.max(0, Number(fleetRoom) || 0);
  const fuelCost = Math.max(0, Number(fuel) || 0);
  const stockDeut = Math.max(0, Number(deut) || 0);

  const loadedMetal = Math.min(Math.max(0, metal), room);
  let remaining = room - loadedMetal;
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

function calcTransportsNeeded(totalCargo, fleetRoom, availableShips) {
  if (totalCargo <= 0 || availableShips <= 0) return 0;
  if (fleetRoom != null && fleetRoom > 0) {
    return Math.min(availableShips, Math.max(1, Math.ceil(totalCargo / fleetRoom)));
  }
  return availableShips;
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
  const {
    sourceCp,
    target,
    metal = 0,
    crystal = 0,
    deut = 0,
    ships,
    reserveSlots = 1,
    slotPollMs = DEFAULT_SLOT_POLL_MS,
    slotTimeoutMs = DEFAULT_SLOT_TIMEOUT_MS,
  } = params;

  if (!sourceCp) throw new Error("Planète source manquante (cp)");
  if (!target?.galaxy || !target?.system || !target?.position) {
    throw new Error("Cible invalide");
  }

  const totalCargo = metal + crystal + deut;
  if (totalCargo <= 0) {
    return { ok: false, skipped: true, error: "Aucune ressource à envoyer" };
  }

  const fleetTableUrl =
    `game/fleetTable?cp=${sourceCp}` +
    `&galaxy=${target.galaxy}&system=${target.system}&planet=${target.position}` +
    `&planettype=1&target_mission=${TRANSPORT_MISSION}`;

  const step0Html = String(
    (await client.get(fleetTableUrl, {
      headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
    })).data
  );

  const available = parseAvailableShip(step0Html, SHIP_SMALL_CARGO);
  if (available <= 0) {
    return { ok: false, error: "Aucun petit transporteur disponible", available: 0 };
  }

  let shipCount = ships ?? available;
  shipCount = Math.min(Math.max(1, shipCount), available);

  const hidden = parseFleetStep1Hidden(step0Html);
  const body1 = {
    ...hidden,
    fmultiply: "1",
    fmultiplySec: "3",
    fmultiplyType: "1",
    fleetgroup: "0",
    [SHIP_SMALL_CARGO]: String(shipCount),
  };

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

  const fleetRoom = parseFleetRoomFromStep2(step2Html);
  const fuel = parseFuelFromStep2(step2Html);
  const cargo = loadCargoAmounts(metal, crystal, deut, fleetRoom, fuel);

  if (cargo.total <= 0) {
    return {
      ok: false,
      error: "Capacité cargo insuffisante pour charger des ressources",
      ships: shipCount,
      fleetRoom,
      fuel,
    };
  }

  if (fleetRoom != null && cargo.total < totalCargo * 0.99 && shipCount < available) {
    const retryShips = Math.min(
      available,
      Math.max(shipCount + 1, calcTransportsNeeded(totalCargo, fleetRoom, available))
    );
    if (retryShips > shipCount && retryShips <= available) {
      return sendResourceTransport(client, { ...params, ships: retryShips, _retry: true });
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
    ships: shipCount,
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

  const results = [];
  let sent = 0;

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    let metal = Number(source.metal) || 0;
    let crystal = Number(source.crystal) || 0;
    let deut = Number(source.deut) || 0;
    let flights = 0;
    let lastCargo = null;
    let lastError = null;
    const maxFlights = 8;

    options.onPlanet?.({
      phase: "start",
      source,
      targetCoords,
      index: index + 1,
      total: sources.length,
    });

    while (metal + crystal + deut > 0 && flights < maxFlights) {
      const live = await readPlanetState(http, source.cp);
      metal = live.metal;
      crystal = live.crystal;
      deut = live.deut;
      const pt = live.ships?.ship202 ?? 0;

      if (metal + crystal + deut <= 0) break;
      if (pt <= 0) {
        lastError = flights ? "PT épuisés avant fin du transfert" : "Aucun PT disponible";
        break;
      }

      await waitForFleetSlot(http, options);
      const payload = await sendResourceTransport(http, {
        sourceCp: source.cp,
        target,
        metal,
        crystal,
        deut,
        reserveSlots: options.reserveSlots ?? 1,
        slotPollMs: options.slotPollMs,
        slotTimeoutMs: options.slotTimeoutMs,
      });

      flights += 1;
      if (!payload.ok) {
        if (payload.skipped) break;
        lastError = payload.error ?? payload.message ?? "Échec transport";
        break;
      }

      lastCargo = payload.cargo ?? null;
      metal = payload.remaining?.metal ?? 0;
      crystal = payload.remaining?.crystal ?? 0;
      deut = payload.remaining?.deut ?? 0;
      sent += 1;

      options.onPlanet?.({
        phase: "flight",
        source,
        targetCoords,
        flights,
        cargo: payload.cargo,
      });

      if (metal + crystal + deut <= 0) break;
      await sleep(options.delayMs ?? 500);
    }

    const entry = {
      sourceCp: source.cp,
      sourceCoords: source.coords,
      targetCoords,
      ok: !lastError && flights > 0,
      skipped: flights === 0 && !lastError,
      error: lastError ?? undefined,
      flights,
      cargo: lastCargo,
      message: lastError
        ? lastError
        : flights > 1
          ? `${flights} vols envoyés`
          : flights === 1
            ? "Transport envoyé"
            : "Rien à envoyer",
    };
    results.push(entry);

    if (entry.ok) {
      log.info(`OK ${source.coords} → ${targetCoords}`, {
        flights: entry.flights,
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
