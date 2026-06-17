import * as cheerio from "cheerio";
import { BUILDINGS_URL } from "./config.js";
import { fetchPage, getClient, postForm } from "./client.js";
import { createLogger, maskToken } from "./logger.js";

const log = createLogger("buildings");

function extractBuildingId($li) {
  const onclick = $li.find('a[onclick*="Dialog.info"]').first().attr("onclick");
  const fromDialog = onclick?.match(/Dialog\.info\((\d+)\)/);
  if (fromDialog) return Number(fromDialog[1]);

  const src = $li.find("img.production_img").first().attr("src") ?? "";
  const fromImg = src.match(/\/(\d+)(?:\(\d+\))?\.png/);
  return fromImg ? Number(fromImg[1]) : null;
}

function extractLevel($li) {
  const thText = $li.find("th").first().text().replace(/\s+/g, " ");
  const match = thText.match(/Niveau\s*(\d+)/i);
  if (match) return Number(match[1]);

  const baseLevel = $li.find("form.build_form input[baselevel]").first().attr("baselevel");
  if (baseLevel != null && baseLevel !== "") {
    return Number(baseLevel);
  }

  return 0;
}

function parsePlanetInfo($) {
  let $option = $('#planetSelector option[selected], #planetSelector option[selected="selected"]').first();
  if (!$option.length) {
    $option = $("#planetSelectorMobile option[selected], #planetSelectorMobile option[selected=\"selected\"]").first();
  }
  if (!$option.length) {
    $option = $("#planetSelector option").first();
  }
  const label = $option.text().replace(/\s+/g, " ").trim();
  const id = Number($option.attr("value")) || null;
  const coords = label.match(/\[(\d+:\d+:\d+)\]/)?.[1] ?? null;

  const title = $("title").text().replace(/\s+/g, " ").trim();
  const playerName = title.match(/-\s*(.+?)\s*-\s*Astrogame/i)?.[1]?.trim() ?? null;

  if (!label) {
    return { id: null, label: null, coords: null, playerName };
  }

  return { id, label, coords, playerName };
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function parseConstructionQueue($) {
  const queue = [];

  $("table.buildingsListQueue tr").each((_, element) => {
    const $row = $(element);
    const $form = $row.find('form.build_form input[name="cmd"][value="insert"]').closest("form");
    if (!$form.length) return;

    const buildingId = Number(
      $form.find('input[name="building"]').val() ||
        $form.find('input[name$="[id]"]').first().val()
    );
    if (!buildingId) return;

    const buttonLabel = $form.find("button.build_submit").text().replace(/\s+/g, " ").trim();
    const targetLevel = Number(buttonLabel.match(/(\d+)\s*$/)?.[1]) || null;
    const timeLeftSeconds = Number($row.find("#time").attr("data-time")) || null;
    const endTime = $row.find("span.timer").text().replace(/\s+/g, " ").trim() || null;
    const slot = Number($row.find("td.left").text().match(/(\d+)\s*\./)?.[1]) || queue.length + 1;

    queue.push({
      slot,
      buildingId,
      label: buttonLabel,
      targetLevel,
      timeLeftSeconds,
      timeLeftFormatted: formatDuration(timeLeftSeconds),
      endTime,
    });
  });

  return queue;
}

function applyConstructionStatus(buildings, constructionQueue) {
  const queueById = new Map(constructionQueue.map((item) => [item.buildingId, item]));

  for (const building of buildings) {
    const queueItem = queueById.get(building.id);
    building.underConstruction = Boolean(queueItem);
    building.constructionTargetLevel = queueItem?.targetLevel ?? null;
    building.constructionTimeLeft = queueItem?.timeLeftSeconds ?? null;
    building.constructionTimeLeftFormatted = queueItem?.timeLeftFormatted ?? null;
    building.constructionEndTime = queueItem?.endTime ?? null;
  }
}

export function parseBuildingsPage(html) {
  const $ = cheerio.load(html);
  const planet = parsePlanetInfo($);
  const constructionQueue = parseConstructionQueue($);
  const buildings = [];

  $("li.wp100").each((_, element) => {
    const $li = $(element);
    const id = extractBuildingId($li);
    if (id == null) return;

    const name = $li.find("th a").first().text().replace(/\s+/g, " ").trim();
    const level = extractLevel($li);
    const $form = $li.find("form.build_form");
    const upgradeable = $form.length > 0;

    let defaultTargetLevel = null;
    if (upgradeable) {
      const countValue = $form.find('input[name$="[count]"]').first().attr("value");
      defaultTargetLevel = countValue ? Number(countValue) : level != null ? level + 1 : null;
    }

    buildings.push({
      id,
      name,
      level,
      upgradeable,
      defaultTargetLevel,
      underConstruction: false,
      constructionTargetLevel: null,
      constructionTimeLeft: null,
      constructionTimeLeftFormatted: null,
      constructionEndTime: null,
    });
  });

  applyConstructionStatus(buildings, constructionQueue);

  const token = $('form.build_form input[name="token"]').first().attr("value") ?? null;

  return { buildings, token, planet, constructionQueue };
}

export function formatConstructionQueue(constructionQueue) {
  if (!constructionQueue?.length) return null;

  const lines = constructionQueue.map((item) => {
    const timing = [
      item.timeLeftFormatted ? `reste ${item.timeLeftFormatted}` : null,
      item.endTime ? `fin ${item.endTime}` : null,
    ]
      .filter(Boolean)
      .join(" — ");

    return `  #${item.slot} [${item.buildingId}] ${item.label}${timing ? ` — ${timing}` : ""}`;
  });

  return `Construction en cours (${constructionQueue.length}) :\n${lines.join("\n")}`;
}

export function formatPlanetHeader(planet) {
  if (!planet?.label) return "Planète active : (inconnue)";

  const parts = [];
  if (planet.playerName) parts.push(`Joueur : ${planet.playerName}`);
  parts.push(`Planète : ${planet.label}`);
  if (planet.coords) parts.push(`Coords : ${planet.coords}`);
  return parts.join(" — ");
}

export async function getBuildings(client, options = {}) {
  const http = client ?? (await getClient());
  const path = options.cp ? `game/buildings?cp=${options.cp}` : "game/buildings";
  log.info("Récupération de la page bâtiments", options.cp ? { cp: options.cp } : {});
  const html = await fetchPage(http, path);
  const page = parseBuildingsPage(html);
  log.info(`${page.buildings.length} bâtiments parsés — ${formatPlanetHeader(page.planet)}`, {
    token: maskToken(page.token),
    upgradeable: page.buildings.filter((b) => b.upgradeable && !b.underConstruction).length,
    constructionQueue: page.constructionQueue.length,
  });
  return page;
}

export async function upgradeBuilding(buildingId, targetLevel, client) {
  const http = client ?? (await getClient());
  log.info(`Amélioration demandée : bâtiment #${buildingId} → niv. ${targetLevel}`);
  const page = await getBuildings(http);
  const building = page.buildings.find((b) => b.id === buildingId);

  if (!building) {
    throw new Error(`Bâtiment ${buildingId} introuvable sur la page.`);
  }

  if (building.underConstruction) {
    throw new Error(
      `« ${building.name} » est déjà en construction vers le niveau ${building.constructionTargetLevel ?? "?"}.`
    );
  }

  if (!building.upgradeable) {
    throw new Error(
      `« ${building.name} » (niv. ${building.level}) n'est pas améliorable pour le moment.`
    );
  }

  if (building.level != null && targetLevel <= building.level) {
    throw new Error(
      `Le niveau cible (${targetLevel}) doit être supérieur au niveau actuel (${building.level}).`
    );
  }

  if (!page.token) {
    throw new Error("Token CSRF introuvable. Recharge la page bâtiments dans le navigateur.");
  }

  const body = {
    cmd: "insert",
    [`building[${buildingId}][id]`]: String(buildingId),
    [`building[${buildingId}][count]`]: String(targetLevel),
    token: page.token,
  };

  const html = await postForm(http, "game/buildings", body, BUILDINGS_URL);
  const result = parseBuildingsPage(html);
  log.info("Amélioration envoyée au serveur");

  return {
    buildingId,
    targetLevel,
    building: result.buildings.find((b) => b.id === buildingId) ?? building,
    success: true,
  };
}

export function formatBuildingLine(building) {
  let status;
  let extra = "";

  if (building.underConstruction) {
    status = `en construction → niv. ${building.constructionTargetLevel ?? "?"}`;
    if (building.constructionTimeLeftFormatted) {
      extra = ` — reste ${building.constructionTimeLeftFormatted}`;
    }
  } else if (building.upgradeable) {
    status = "améliorable";
    if (building.defaultTargetLevel != null) {
      extra = ` → défaut niv. ${building.defaultTargetLevel}`;
    }
  } else {
    status = "indisponible";
  }

  return `[${building.id}] ${building.name} — niv. ${building.level ?? "?"} (${status})${extra}`;
}
