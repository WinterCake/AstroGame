import { writeFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { parseGameAmount } from "./attack-loot-send.js";
import { parseBuildingsPage } from "./buildings.js";
import { getClient } from "./client.js";
import { ensureDataDirs, paths } from "./paths.js";

export const MINE_BUILDING_IDS = {
  metal: 1,
  crystal: 2,
  deut: 3,
};

export function extractMineLevels(buildings) {
  const byId = new Map((buildings ?? []).map((b) => [b.id, Number(b.level) || 0]));
  const metalMine = byId.get(MINE_BUILDING_IDS.metal) ?? 0;
  const crystalMine = byId.get(MINE_BUILDING_IDS.crystal) ?? 0;
  const deutMine = byId.get(MINE_BUILDING_IDS.deut) ?? 0;
  return {
    metalMine,
    crystalMine,
    deutMine,
    minesTotal: metalMine + crystalMine + deutMine,
  };
}

export function parseResourcesFromHtml(html) {
  const $ = cheerio.load(html);
  const out = { metal: 0, crystal: 0, deut: 0 };

  for (const [key, id] of [
    ["metal", "current_metal"],
    ["crystal", "current_crystal"],
    ["deut", "current_deuterium"],
  ]) {
    const el = $(`#${id}`);
    if (el.length) {
      out[key] = parseGameAmount(el.text()) || parseGameAmount(el.attr("data-real")) || 0;
    }
  }

  if (!out.metal) out.metal = parseGameAmount($("#metalbox [data-real]").attr("data-real"));
  if (!out.crystal) out.crystal = parseGameAmount($("#crystalbox [data-real]").attr("data-real"));
  if (!out.deut) out.deut = parseGameAmount($("#deuteriumbox [data-real]").attr("data-real"));

  const scriptMatch = html.match(/resources\s*[=:]\s*\{[^}]+\}/i);
  if (scriptMatch) {
    const metalM = scriptMatch[0].match(/["']?metal["']?\s*[:=]\s*["']?([\d.]+)/i);
    const crystalM = scriptMatch[0].match(/["']?crystal["']?\s*[:=]\s*["']?([\d.]+)/i);
    const deutM = scriptMatch[0].match(/["']?deuterium["']?\s*[:=]\s*["']?([\d.]+)/i);
    if (metalM) out.metal = out.metal || parseGameAmount(metalM[1]);
    if (crystalM) out.crystal = out.crystal || parseGameAmount(crystalM[1]);
    if (deutM) out.deut = out.deut || parseGameAmount(deutM[1]);
  }

  if (!out.metal) out.metal = parseGameAmount($("#resources_metal").text());
  if (!out.crystal) out.crystal = parseGameAmount($("#resources_crystal").text());
  if (!out.deut) out.deut = parseGameAmount($("#resources_deuterium").text());

  out.total = out.metal + out.crystal + out.deut;
  return out;
}

export function parseShipsFromHtml(html) {
  const $ = cheerio.load(html);
  const ships = {};
  $("[id^='ship'][id$='_value']").each((_, el) => {
    const id = $(el).attr("id").replace("_value", "");
    const amount = parseGameAmount($(el).attr("data-amount"));
    if (amount) ships[id] = amount;
  });
  return ships;
}

export function dedupePlanets(planets) {
  const byCp = new Map();
  for (const planet of planets) {
    if (!planet?.cp || byCp.has(planet.cp)) continue;
    byCp.set(planet.cp, planet);
  }
  return [...byCp.values()];
}

/** Une entrée par coords — colonie prioritaire sur lune. */
export function dedupePlanetsByCoords(planets) {
  const byCoords = new Map();
  for (const planet of planets) {
    if (!planet?.coords) continue;
    const existing = byCoords.get(planet.coords);
    if (!existing) {
      byCoords.set(planet.coords, planet);
      continue;
    }
    const planetIsMoon = planet.isMoon ?? isMoonPlanet(planet);
    const existingIsMoon = existing.isMoon ?? isMoonPlanet(existing);
    if (existingIsMoon && !planetIsMoon) {
      byCoords.set(planet.coords, planet);
    }
  }
  return [...byCoords.values()];
}

export function isMoonPlanet(planet) {
  return /(lune|moon)\s*\(/i.test(planet.label ?? "");
}

export async function listEmpirePlanets(client, options = {}) {
  const http = client ?? (await getClient());
  const overviewHtml = String((await http.get("game/overview")).data);
  const $ov = cheerio.load(overviewHtml);
  const collected = [];

  function collectOptions(selectSelector) {
    $ov(`${selectSelector} > option`).each((_, el) => {
      const node = $ov(el);
      const text = node.text().replace(/\s+/g, " ").trim();
      const coords = text.match(/\[(\d+:\d+:\d+)\]/)?.[1];
      const cp = Number(node.attr("value")) || null;
      if (!coords || !cp) return;
      collected.push({
        cp,
        coords,
        label: text,
        isMain: /main\s*plan[eè]te/i.test(text),
        isMoon: isMoonPlanet({ label: text }),
      });
    });
  }

  collectOptions("select#planetSelector");
  if (!collected.length) collectOptions("select#planetSelectorMobile");

  let planets = dedupePlanets(collected);
  planets = dedupePlanetsByCoords(planets);
  if (options.forSource) {
    planets = planets.filter((p) => !p.isMoon);
  }
  return planets;
}

export async function scanEmpireResources(client, options = {}) {
  ensureDataDirs();
  const http = client ?? (await getClient());
  const planets = await listEmpirePlanets(http);
  const rows = [];
  const empire = { metal: 0, crystal: 0, deut: 0, total: 0 };

  for (const planet of planets) {
    const [ovRes, fleetRes, buildRes] = await Promise.all([
      http.get(`game/overview?cp=${planet.cp}`, {
        headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
      }),
      http.get(`game/fleetTable?cp=${planet.cp}`, {
        headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
      }),
      http.get(`game/buildings?cp=${planet.cp}`, {
        headers: { Referer: "https://play.astrogame.org/uni24/game/overview" },
      }),
    ]);

    const res = parseResourcesFromHtml(String(ovRes.data));
    const ships = parseShipsFromHtml(String(fleetRes.data));
    const mines = extractMineLevels(parseBuildingsPage(String(buildRes.data)).buildings);

    empire.metal += res.metal;
    empire.crystal += res.crystal;
    empire.deut += res.deut;
    empire.total += res.total;

    rows.push({ ...planet, ...res, ships, ...mines });
    options.onPlanet?.({ planet, res, ships, mines, index: rows.length, total: planets.length });
  }

  const payload = {
    scannedAt: new Date().toISOString(),
    empire,
    planets: rows,
  };

  const outputPath = options.outputPath ?? paths.empire.snapshot();
  writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
