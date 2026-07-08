import * as cheerio from "cheerio";
import { parseGameAmount } from "./attack-loot-send.js";
import { fetchPage, getClient, postForm } from "./client.js";
import { SITE_URL } from "./config.js";
import { parseShipsFromHtml } from "./empire.js";
import { createLogger } from "./logger.js";

const log = createLogger("shipyard");

const SHIPYARD_REFERER = "https://play.astrogame.org/uni24/game/overview";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shipyardPath(cp) {
  return cp ? `game/shipyard?mode=fleet&cp=${cp}` : "game/shipyard?mode=fleet";
}

function extractShipId($li) {
  const onclick = $li.find('a[onclick*="Dialog.info"]').first().attr("onclick");
  const fromDialog = onclick?.match(/Dialog\.info\((\d+)\)/);
  if (fromDialog) return Number(fromDialog[1]);

  const inputId = $li.find('input[type="text"][id^="input_"]').first().attr("id");
  const fromInput = inputId?.match(/^input_(\d+)$/);
  return fromInput ? Number(fromInput[1]) : null;
}

export function parseShipyardPage(html) {
  const $ = cheerio.load(html);
  const token = $('form[action*="shipyard"] input[name="token"]').first().attr("value") ?? null;
  const ships = {};

  $("li.wp100").each((_, element) => {
    const $li = $(element);
    const id = extractShipId($li);
    if (!id) return;

    const name = $li.find("th a").first().text().replace(/\s+/g, " ").trim();
    const haveTitle = $li.find("th .tooltip[title]").first().attr("title");
    const maxBtn = $li.find('input[type="button"][value="Max"]').attr("onclick");
    const maxBuild = maxBtn?.match(/val\('([\d.]+)'\)/)?.[1];

    ships[id] = {
      id,
      name,
      available: haveTitle ? parseGameAmount(haveTitle) : 0,
      maxBuild: maxBuild ? parseGameAmount(maxBuild) : 0,
    };
  });

  return { token, ships };
}

export async function getShipyard(client, options = {}) {
  const http = client ?? (await getClient());
  const path = shipyardPath(options.cp);
  const html = await fetchPage(http, path);
  return parseShipyardPage(html);
}

export async function buildShipyardShips(client, shipCounts, options = {}) {
  const http = client ?? (await getClient());
  const cp = options.cp;
  if (!cp) throw new Error("cp requis pour construire des vaisseaux");

  const counts = Object.entries(shipCounts)
    .map(([id, count]) => [Number(id), Math.max(0, Math.floor(Number(count) || 0))])
    .filter(([, count]) => count > 0);

  if (!counts.length) {
    return { ok: true, built: {}, skipped: true };
  }

  const path = shipyardPath(cp);
  const page = await getShipyard(http, { cp });
  if (!page.token) {
    throw new Error("Token chantier introuvable — recharge le chantier spatial.");
  }

  const body = { token: page.token };
  const built = {};
  for (const [shipId, count] of counts) {
    const ship = page.ships[shipId];
    if (!ship) {
      throw new Error(`Vaisseau #${shipId} introuvable au chantier.`);
    }
    const qty = Math.min(count, ship.maxBuild || count);
    if (qty <= 0) {
      throw new Error(
        `Impossible de construire ${count} × ${ship.name ?? shipId} (max ${ship.maxBuild ?? 0}).`
      );
    }
    body[`fmenge[${shipId}]`] = String(qty);
    built[shipId] = qty;
  }

  log.info(`Construction chantier cp ${cp}`, built);
  await postForm(http, path, body, `${SITE_URL}${path}`);

  return { ok: true, built, cp };
}

export async function waitForShipCount(client, cp, shipKey, minCount, options = {}) {
  const pollMs = options.pollMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
  const startedAt = Date.now();

  while (true) {
    const html = String(
      (
        await client.get(`game/fleetTable?cp=${cp}`, {
          headers: { Referer: SHIPYARD_REFERER },
        })
      ).data
    );
    const ships = parseShipsFromHtml(html);
    const count = ships[shipKey] ?? 0;
    if (count >= minCount) return count;

    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timeout en attente de ${shipKey} (${count}/${minCount})`);
    }

    log.info(`Attente ${shipKey} — ${count}/${minCount}`);
    await sleep(pollMs);
  }
}
