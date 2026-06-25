import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import ExcelJS from "exceljs";
import {
  emptyAttacksStore,
  getAttackedTodayCoords,
  mergeAttackRecords,
  serializeAttacksStore,
} from "./attacks-history.js";
import { getClient } from "./client.js";
import { paths } from "./paths.js";
import { normalizeCoordString } from "./spy-send.js";
import { createLogger } from "./logger.js";

const log = createLogger("spy");
const SPY_CATEGORY = 0;
/** Missiles en silo — ne comptent pas comme défense pour le filtre « sans défense ». */
const MISSILE_ONLY_DEFENSE_IDS = new Set(["502", "503"]);

function sumCategoryValues(category) {
  if (!category) return 0;
  return Object.values(category).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

export function sumDefenseExcludingMissiles(category) {
  if (!category) return 0;
  return Object.entries(category).reduce((sum, [id, value]) => {
    if (MISSILE_ONLY_DEFENSE_IDS.has(id)) return sum;
    return sum + (Number(value) || 0);
  }, 0);
}

export function getEffectiveDefense(report) {
  if (report.spyData?.["400"]) {
    return sumDefenseExcludingMissiles(report.spyData["400"]);
  }
  return Number(report.defense) || 0;
}

function sumResources(category) {
  if (!category) return 0;
  return (Number(category?.["901"]) || 0) + (Number(category?.["902"]) || 0) + (Number(category?.["903"]) || 0);
}

function formatCompactNumber(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Md`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} K`;
  return String(Math.round(n));
}

function buildVerdict(fleetTotal, defenseTotal, lootTotal) {
  if (fleetTotal > 0) return "Flotte présente";
  if (defenseTotal > 50_000) return "Défense lourde";
  if (defenseTotal > 0) return "Défense légère";
  if (lootTotal >= 500_000_000) return "Gros butin";
  if (lootTotal > 0) return "Cible intéressante";
  return "Peu de ressources";
}

export function isSansDefense(report) {
  return (Number(report.fleet) || 0) === 0 && getEffectiveDefense(report) === 0;
}

export function isGrosButinSansDefense(report) {
  return isSansDefense(report) && (Number(report.loot) || 0) >= 500_000_000;
}

export function isReportToday(report) {
  if (!report.timestamp) return false;
  const date = new Date(report.timestamp * 1000);
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

export function getSpiedTodayCoords(reports, extraCoords = null) {
  const coords = new Set();
  for (const report of reports ?? []) {
    if (isReportToday(report)) coords.add(normalizeCoordString(report.coords));
  }
  for (const value of extraCoords ?? []) {
    const normalized = normalizeCoordString(value);
    if (normalized) coords.add(normalized);
  }
  return coords;
}

export function getAllSpiedCoords(reports) {
  const coords = new Set();
  for (const report of reports ?? []) {
    if (report?.coords) coords.add(normalizeCoordString(report.coords));
  }
  return coords;
}

function loadSpiedLogStore() {
  const path = paths.spy.spiedLog();
  if (!existsSync(path)) return emptyAttacksStore();
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return emptyAttacksStore();
  }
}

/** Marque des coords comme espionnées aujourd'hui (envoi sonde OK, avant sync messagerie). */
export function recordSpiedSendSuccess(okCoords) {
  const coords = [...new Set((okCoords ?? []).map(normalizeCoordString).filter(Boolean))];
  if (!coords.length) return { recorded: 0 };

  const logPath = paths.spy.spiedLog();
  const merged = mergeAttackRecords(loadSpiedLogStore(), coords, { source: "spy-send" });
  writeFileSync(logPath, JSON.stringify(serializeAttacksStore(merged, { source: "spy-send" }), null, 2), "utf8");

  const lootPath = paths.spy.lootTargets();
  if (!existsSync(lootPath)) return { recorded: coords.length };

  const loot = JSON.parse(readFileSync(lootPath, "utf8"));
  if (!Array.isArray(loot?.reports)) return { recorded: coords.length };

  const now = Math.floor(Date.now() / 1000);
  const dateText = new Date(now * 1000).toLocaleString("fr-FR", { hour12: false });
  let touched = 0;

  for (const coord of coords) {
    const idx = loot.reports.findIndex((r) => normalizeCoordString(r.coords) === coord);
    if (idx < 0) continue;
    loot.reports[idx] = { ...loot.reports[idx], timestamp: now, dateText };
    touched++;
  }

  if (touched) {
    writeFileSync(lootPath, JSON.stringify(loot, null, 2), "utf8");
  }

  return { recorded: coords.length, touched };
}

export function applySpyHiddenFilter(reports, hiddenCoords) {
  const hidden = new Set(hiddenCoords ?? []);
  if (!hidden.size) return reports ?? [];
  return (reports ?? []).filter((report) => !hidden.has(report.coords));
}

export function removeSpyReports(data, coords) {
  const remove = new Set(
    (coords ?? []).map((c) => String(c).trim()).filter((c) => /^\d+:\d+:\d+$/.test(c))
  );
  if (!remove.size) {
    return { data, removed: 0 };
  }

  const hidden = new Set(data.meta?.hiddenCoords ?? []);
  for (const coord of remove) hidden.add(coord);

  const reports = applySpyHiddenFilter(data.reports, hidden);
  const next = {
    ...data,
    meta: {
      ...data.meta,
      hiddenCoords: [...hidden],
      totalReports: reports.length,
    },
    reports,
  };

  return { data: next, removed: remove.size };
}

export function filterSpyReports(reports, filter) {
  switch (filter) {
    case "gros-butin":
      return reports.filter((report) => report.verdict === "Gros butin");
    case "sans-defense":
      return reports.filter(isSansDefense);
    case "gros-butin-sans-defense":
      return reports.filter(isGrosButinSansDefense);
    case "today":
      return reports.filter(isReportToday);
    case "today-gros":
      return reports.filter((report) => report.verdict === "Gros butin" && isReportToday(report));
    case "today-sans-defense":
      return reports.filter((report) => isSansDefense(report) && isReportToday(report));
    case "today-gros-sans-defense":
      return reports.filter((report) => isGrosButinSansDefense(report) && isReportToday(report));
    default:
      return reports;
  }
}

function decodeSpyPayload(encoded) {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

export function summarizeSpyPayload(payload, meta = {}) {
  const planet = payload.targetPlanet ?? {};
  const coords = `${planet.galaxy}:${planet.system}:${planet.planet}`;
  const loot = sumResources(payload.spyData?.["900"]);
  const fleet = sumCategoryValues(payload.spyData?.["200"]);
  const defense = sumDefenseExcludingMissiles(payload.spyData?.["400"]);
  const buildings = payload.spyData?.["0"] ?? {};

  return {
    messageId: meta.messageId ?? null,
    dateText: meta.dateText ?? null,
    timestamp: payload.time ?? meta.timestamp ?? null,
    coords,
    galaxy: planet.galaxy,
    system: planet.system,
    position: planet.planet,
    planetId: planet.id,
    planetName: planet.name,
    username: payload.targetUsername,
    loot,
    lootFormatted: formatCompactNumber(loot),
    fleet,
    fleetFormatted: formatCompactNumber(fleet),
    defense,
    defenseFormatted: formatCompactNumber(defense),
    metalMine: Number(buildings["1"]) || 0,
    crystalMine: Number(buildings["2"]) || 0,
    deutMine: Number(buildings["3"]) || 0,
    targetChance: payload.targetChance ?? null,
    spyChance: payload.spyChance ?? null,
    verdict: buildVerdict(fleet, defense, loot),
    spyData: payload.spyData,
  };
}

export function parseSpyReportsHtml(html) {
  const reports = [];
  const rowRegex =
    /<tr[^>]*class="[^"]*messages_body[^"]*"[^>]*data-message-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>|<tr[^>]*data-message-id="(\d+)"[^>]*class="[^"]*messages_body[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;

  for (const match of html.matchAll(rowRegex)) {
    const messageId = match[1] || match[3];
    const rowHtml = match[2] || match[4];
    const dataMatch = rowHtml.match(/ASTRO_SPY_REPORT_DATA:([A-Za-z0-9+/=]+)/);
    if (!dataMatch) continue;

    const payload = decodeSpyPayload(dataMatch[1]);
    let dateText = null;
    const before = html.slice(0, match.index);
    const headBlocks = [...before.matchAll(/<tr[^>]*class="message_head"[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (headBlocks.length) {
      const cells = [...headBlocks[headBlocks.length - 1][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (cells[1]) {
        dateText = cells[1][1].replace(/<[^>]+>/g, "").trim() || null;
      }
    }

    reports.push(
      summarizeSpyPayload(payload, {
        messageId,
        dateText,
        timestamp: payload.time,
      })
    );
  }

  return reports;
}

function isNewerSpyReport(candidate, current) {
  const candidateTs = Number(candidate.timestamp) || 0;
  const currentTs = Number(current.timestamp) || 0;
  if (candidateTs !== currentTs) return candidateTs > currentTs;

  const candidateDetail = Boolean(candidate.spyData);
  const currentDetail = Boolean(current.spyData);
  if (candidateDetail !== currentDetail) return candidateDetail;

  return Number(candidate.messageId) > Number(current.messageId);
}

export function isSpyReportComplete(report) {
  return Boolean(report?.messageId && report?.spyData);
}

function buildSpyProcessedIndex(reports) {
  const byMessageId = new Map();
  for (const report of reports ?? []) {
    if (!isSpyReportComplete(report)) continue;
    byMessageId.set(String(report.messageId), report);
  }
  return { byMessageId };
}

function resolveCachedSpyReport(report, index) {
  if (!report?.messageId) return null;
  return index.byMessageId.get(String(report.messageId)) ?? null;
}

export function mergeSpyReports(existing = [], incoming = []) {
  const byId = new Map((existing ?? []).map((r) => [String(r.messageId), r]));
  for (const report of incoming ?? []) {
    if (!report.messageId) continue;
    const id = String(report.messageId);
    const prev = byId.get(id);
    if (!prev || isNewerSpyReport(report, prev)) {
      byId.set(id, {
        ...prev,
        ...report,
        spyData: report.spyData || prev?.spyData,
      });
    }
  }
  return dedupeSpyReportsByCoords([...byId.values()]);
}

function dedupeSpyReportsByCoords(reports) {
  const byCoords = new Map();
  const withoutCoords = [];

  for (const report of reports) {
    if (!report.coords) {
      withoutCoords.push(report);
      continue;
    }

    const existing = byCoords.get(report.coords);
    if (!existing || isNewerSpyReport(report, existing)) {
      byCoords.set(report.coords, report);
    }
  }

  return [...byCoords.values(), ...withoutCoords].sort(
    (a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)
  );
}

function detectMaxPage(html) {
  const pages = [...html.matchAll(/Message\.getMessages\(\s*0\s*,\s*(\d+)\s*\)/g)].map((m) => Number(m[1]));
  return pages.length ? Math.max(...pages) : 1;
}

export async function fetchSpyReportsPage(client, page = 1) {
  const response = await client.get(`game/messages/view?messcat=${SPY_CATEGORY}&site=${page}&ajax=1`, {
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://play.astrogame.org/uni24/game/messages",
    },
    transformResponse: [(data) => data],
  });

  const html = String(response.data);
  return {
    page,
    maxPage: detectMaxPage(html),
    reports: parseSpyReportsHtml(html),
  };
}

export function parseSpyScrapeOptions(args) {
  const options = {
    all: true,
    page: null,
    maxPages: null,
    output: null,
    excel: paths.spy.reportsExcel(),
    noExcel: false,
    filter: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--page") options.page = Number(args[++i]);
    else if (arg === "--max-pages") options.maxPages = Number(args[++i]);
    else if (arg === "--output") options.output = args[++i];
    else if (arg === "--filter") options.filter = args[++i];
    else if (arg === "--excel") {
      const next = args[i + 1];
      options.excel = next && !next.startsWith("-") ? args[++i] : paths.spy.reportsExcel();
    } else if (arg === "--no-excel") options.noExcel = true;
    else if (arg === "--all") options.all = true;
  }

  if (options.page) options.all = false;

  return options;
}

export async function scrapeSpyReports(options = {}, client) {
  const http = client ?? (await getClient());
  const processedIndex = buildSpyProcessedIndex(options.existingReports ?? []);
  const stats = { skipped: 0, newReports: 0 };
  const reports = [];
  let maxPage = 1;

  function ingestPageReports(pageReports) {
    for (const report of pageReports) {
      const cached = resolveCachedSpyReport(report, processedIndex);
      if (cached) {
        stats.skipped++;
        reports.push(cached);
        continue;
      }
      stats.newReports++;
      reports.push(report);
      if (isSpyReportComplete(report)) {
        processedIndex.byMessageId.set(String(report.messageId), report);
      }
    }
  }

  if (options.page) {
    const result = await fetchSpyReportsPage(http, options.page);
    ingestPageReports(result.reports);
    maxPage = result.maxPage;
  } else {
    const first = await fetchSpyReportsPage(http, 1);
    maxPage = options.maxPages ? Math.min(options.maxPages, first.maxPage) : first.maxPage;
    ingestPageReports(first.reports);
    log.info(`Rapports page 1/${maxPage}`, { count: first.reports.length });

    for (let page = 2; page <= maxPage; page++) {
      const result = await fetchSpyReportsPage(http, page);
      ingestPageReports(result.reports);
      log.info(`Rapports page ${page}/${maxPage}`, { count: result.reports.length });
    }
  }

  const deduped = dedupeSpyReportsByCoords(reports);

  const payload = {
    meta: {
      scrapedAt: new Date().toISOString(),
      totalReports: deduped.length,
      rawReports: reports.length,
      pagesScanned: options.page ? 1 : maxPage,
      sortedBy: "date-desc",
      newReports: stats.newReports,
      skippedReports: stats.skipped,
    },
    reports: deduped,
  };

  log.info(
    `Récupération des rapports d'espionnage terminée — ${deduped.length} rapports, ${stats.newReports} nouveau(x), ${stats.skipped} ignoré(s) (déjà en cache)`
  );

  if (options.output) {
    writeFileSync(resolve(options.output), JSON.stringify(payload, null, 2), "utf8");
    log.info(`JSON exporté`, { output: options.output, reports: deduped.length });
  }

  return payload;
}

function truncate(text, maxLength) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatReportDate(report) {
  if (report.timestamp) {
    const date = new Date(report.timestamp * 1000);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}/${month} ${hours}:${minutes}`;
  }
  return truncate(report.dateText ?? "?", 14);
}

function printTable(headers, rows) {
  const widths = headers.map((header, columnIndex) => {
    const dataWidth = rows.reduce(
      (max, row) => Math.max(max, String(row[columnIndex] ?? "").length),
      0
    );
    return Math.max(header.length, dataWidth);
  });

  const formatRow = (cells) =>
    cells.map((cell, index) => String(cell ?? "").padEnd(widths[index])).join("  ");

  console.log(formatRow(headers));
  console.log(widths.map((width) => "─".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

export function printSpySummary(payload, options = {}) {
  const filtered = options.filter ? filterSpyReports(payload.reports, options.filter) : payload.reports;
  const filterLabel = options.filter ? ` — filtre: ${options.filter}` : "";
  console.log(
    `\nRapports d'espionnage (${filtered.length}/${payload.meta.totalReports})${filterLabel} — tri par date décroissante\n`
  );

  if (!filtered.length) {
    console.log("Aucun rapport trouvé.");
    return;
  }

  const headers = [
    "#",
    "Date",
    "Coords",
    "Joueur",
    "Planète",
    "Butin",
    "Flotte",
    "Défense",
    "Mines",
    "Destr.",
    "Espion.",
    "Verdict",
  ];

  const rows = filtered.map((report, index) => [
    index + 1,
    formatReportDate(report),
    report.coords,
    truncate(report.username, 16),
    truncate(report.planetName, 18),
    report.lootFormatted,
    report.fleetFormatted,
    report.defenseFormatted,
    `M${report.metalMine}/C${report.crystalMine}/D${report.deutMine}`,
    report.targetChance != null ? `${report.targetChance}%` : "-",
    report.spyChance != null ? `${report.spyChance}%` : "-",
    report.verdict,
  ]);

  printTable(headers, rows);
  console.log("");
}

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1A4D7A" },
};
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

const REPORT_COLUMNS = [
  { header: "Date", key: "date" },
  { header: "Coords", key: "coords" },
  { header: "Galaxie", key: "galaxy" },
  { header: "Système", key: "system" },
  { header: "Position", key: "position" },
  { header: "Joueur", key: "username" },
  { header: "Planète", key: "planetName" },
  { header: "Butin total", key: "loot" },
  { header: "Métal", key: "metal" },
  { header: "Cristal", key: "crystal" },
  { header: "Deutérium", key: "deuterium" },
  { header: "Flotte", key: "fleet" },
  { header: "Défense", key: "defense" },
  { header: "Mine métal", key: "metalMine" },
  { header: "Mine cristal", key: "crystalMine" },
  { header: "Synth. deut.", key: "deutMine" },
  { header: "Destruction %", key: "targetChance" },
  { header: "Espionnage %", key: "spyChance" },
  { header: "Verdict", key: "verdict" },
  { header: "Message ID", key: "messageId" },
];

const REPORT_WIDTHS = [18, 12, 8, 9, 9, 18, 22, 14, 14, 14, 14, 12, 12, 11, 12, 12, 13, 13, 18, 12];

function applySheetStyle(sheet, columnWidths) {
  const header = sheet.getRow(1);
  header.font = HEADER_FONT;
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle", horizontal: "center" };
  header.height = 22;

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columnWidths.length },
  };

  columnWidths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function reportToExcelRow(report) {
  const resources = report.spyData?.["900"] ?? {};
  return {
    date: report.timestamp ? new Date(report.timestamp * 1000) : report.dateText ?? "",
    coords: report.coords,
    galaxy: report.galaxy,
    system: report.system,
    position: report.position,
    username: report.username,
    planetName: report.planetName,
    loot: report.loot,
    metal: Number(resources["901"]) || 0,
    crystal: Number(resources["902"]) || 0,
    deuterium: Number(resources["903"]) || 0,
    fleet: report.fleet,
    defense: report.defense,
    metalMine: report.metalMine,
    crystalMine: report.crystalMine,
    deutMine: report.deutMine,
    targetChance: report.targetChance,
    spyChance: report.spyChance,
    verdict: report.verdict,
    messageId: report.messageId,
  };
}

function addReportsSheet(workbook, name, reports) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = REPORT_COLUMNS;

  for (const report of reports) {
    const row = sheet.addRow(reportToExcelRow(report));
    const dateCell = row.getCell("date");
    if (dateCell.value instanceof Date) {
      dateCell.numFmt = "dd/mm/yyyy hh:mm";
    }
  }

  applySheetStyle(sheet, REPORT_WIDTHS);
  return sheet;
}

export async function writeSpyReportsExcel(payload, outputPath) {
  const { reports, meta } = payload;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Astrogame API";
  workbook.created = new Date();

  addReportsSheet(workbook, "Rapports", reports);

  const grosButin = reports.filter((report) => report.verdict === "Gros butin");
  if (grosButin.length > 0) {
    addReportsSheet(workbook, "Gros butin", grosButin);
  }

  const sansDefense = reports.filter(isSansDefense);
  if (sansDefense.length > 0) {
    addReportsSheet(workbook, "Sans défense", sansDefense);
  }

  const grosButinSansDefense = reports.filter(isGrosButinSansDefense);
  if (grosButinSansDefense.length > 0) {
    addReportsSheet(workbook, "Gros butin sans déf.", grosButinSansDefense);
  }

  const cibles = reports.filter(
    (report) => report.verdict === "Gros butin" || report.verdict === "Cible intéressante"
  );
  if (cibles.length > 0) {
    addReportsSheet(workbook, "Cibles", cibles);
  }

  const metaSheet = workbook.addWorksheet("Résumé");
  metaSheet.columns = [
    { header: "Clé", key: "key", width: 22 },
    { header: "Valeur", key: "value", width: 50 },
  ];

  const verdictCounts = reports.reduce((counts, report) => {
    counts[report.verdict] = (counts[report.verdict] ?? 0) + 1;
    return counts;
  }, {});

  const metaRows = [
    ["Scrapé le", meta.scrapedAt],
    ["Rapports", meta.totalReports],
    ["Pages", meta.pagesScanned],
    ["Tri", meta.sortedBy],
    ["Gros butin", grosButin.length],
    ["Sans défense", sansDefense.length],
    ["Gros butin sans défense", grosButinSansDefense.length],
    ["Cibles intéressantes", verdictCounts["Cible intéressante"] ?? 0],
    ["Flotte présente", verdictCounts["Flotte présente"] ?? 0],
    ["Défense lourde", verdictCounts["Défense lourde"] ?? 0],
  ];

  for (const [key, value] of metaRows) {
    metaSheet.addRow({ key, value });
  }

  metaSheet.getRow(1).font = HEADER_FONT;
  metaSheet.getRow(1).fill = HEADER_FILL;

  await workbook.xlsx.writeFile(resolve(outputPath));
}
