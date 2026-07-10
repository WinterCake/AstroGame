import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import ExcelJS from "exceljs";
import {
  applySpyHiddenFilter,
  buildSpyPayload,
  dedupeSpyReportsByCoords,
  detectMaxSpyPage,
  filterSpyReports,
  formatCompactNumber,
  getEffectiveDefense,
  isGrosButinSansDefense,
  isReportToday,
  isSansDefense,
  isSpyReportComplete,
  mergeSpyReports,
  parseSpyReportsHtml,
  sumDefenseExcludingMissiles,
  summarizeSpyPayload,
} from "../shared/spy-core.js";
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

export {
  applySpyHiddenFilter,
  filterSpyReports,
  formatCompactNumber,
  getEffectiveDefense,
  isGrosButinSansDefense,
  isReportToday,
  isSansDefense,
  isSpyReportComplete,
  mergeSpyReports,
  parseSpyReportsHtml,
  summarizeSpyPayload,
  sumDefenseExcludingMissiles,
};

const log = createLogger("spy");
const SPY_CATEGORY = 0;

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

  return { recorded: coords.length };
}

export function parseGalaxyPoints(value) {
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  let thousands;
  if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    thousands = Number(raw.replace(/\./g, ""));
  } else {
    const digits = raw.replace(/[^\d]/g, "");
    thousands = digits ? Number(digits) : Number(raw) || 0;
  }
  // L'API galaxie Astrogame affiche les points joueur en milliers (ex. "50.131" → ~50 M).
  return thousands * 1000;
}

/** Rapport espionnage incohérent avec la galaxie (compte crashé, planète recyclée, cache périmé). */
export function isStaleSpyReport(report, galaxyEntry) {
  if (!report?.coords) return false;

  if (galaxyEntry?.planetId && report.planetId) {
    if (String(galaxyEntry.planetId) !== String(report.planetId)) return true;
  }
  if (galaxyEntry?.username && report.username) {
    if (String(galaxyEntry.username).toLowerCase() !== String(report.username).toLowerCase()) return true;
  }

  const points = parseGalaxyPoints(galaxyEntry?.points);
  const loot = Number(report.loot) || 0;

  // Compte très faible avec butin énorme (ex. planète vidée après attaque, cache espionnage ancien).
  if (points > 0 && points < 500_000 && loot >= 500_000_000) return true;
  return false;
}

export function purgeStaleSpyReports(data, galaxyEntries = []) {
  const galaxyByCoord = new Map(
    (galaxyEntries ?? []).map((entry) => [normalizeCoordString(entry.coords), entry])
  );
  const removed = [];
  const reports = (data?.reports ?? []).filter((report) => {
    const galaxyEntry = galaxyByCoord.get(normalizeCoordString(report.coords));
    if (!isStaleSpyReport(report, galaxyEntry)) return true;
    removed.push(report.coords);
    return false;
  });

  return {
    data: {
      ...data,
      meta: {
        ...data?.meta,
        totalReports: reports.length,
        stalePurgedAt: new Date().toISOString(),
      },
      reports,
    },
    removed,
  };
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
    maxPage: detectMaxSpyPage(html),
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
      if (cached) stats.skipped++;
      else stats.newReports++;

      // Toujours garder le parse HTML frais (le cache servait d'ancienne version identique messageId).
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
