import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import ExcelJS from "exceljs";
import { UNIVERSE } from "./config.js";
import { paths } from "./paths.js";
import { groupEntriesByPlayer } from "./galaxy.js";
import { green, logSuccess } from "./logger.js";

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1A4D7A" },
};
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

export function loadGalaxyFile(filePath) {
  const absolute = resolve(filePath);
  if (!existsSync(absolute)) {
    throw new Error(`Fichier introuvable : ${filePath}`);
  }

  const data = JSON.parse(readFileSync(absolute, "utf8"));
  if (!Array.isArray(data?.entries)) {
    throw new Error(`Format invalide (entries manquant) : ${filePath}`);
  }

  return {
    path: absolute,
    name: basename(absolute),
    meta: data.meta ?? {},
    entries: data.entries,
  };
}

export function mergeGalaxySources(sources) {
  const byCoords = new Map();
  const fileOrder = [];

  for (const source of sources) {
    fileOrder.push(source.name);
    for (const entry of source.entries) {
      if (!entry?.coords) continue;
      byCoords.set(entry.coords, entry);
    }
  }

  const entries = [...byCoords.values()].sort(compareEntries);
  const players = groupEntriesByPlayer(entries);

  return {
    meta: {
      universe: sources.find((s) => s.meta?.universe)?.meta.universe ?? UNIVERSE,
      mergedAt: new Date().toISOString(),
      sourceFiles: fileOrder,
      systemsStored: new Set(entries.map((e) => `${e.galaxy}:${e.system}`)).size,
      planetEntries: entries.length,
      uniquePlayers: players.length,
      inactivePlanets: entries.filter((e) => e.inactive).length,
      attackableInactivePlanets: entries.filter((e) => e.isAttackableInactive).length,
    },
    entries,
    players,
  };
}

function compareEntries(a, b) {
  return a.galaxy - b.galaxy || a.system - b.system || a.position - b.position;
}

function formatAlliance(entry) {
  if (!entry.alliance) return { tag: "", name: "" };
  return { tag: entry.alliance.tag ?? "", name: entry.alliance.name ?? "" };
}

function formatMoon(entry) {
  if (!entry.moon) return "";
  const parts = [entry.moon.name];
  if (entry.moon.diameter) parts.push(`Ø ${entry.moon.diameter}`);
  return parts.join(" — ");
}

function formatDebris(entry) {
  if (!entry.debris) return { metal: "", crystal: "" };
  return {
    metal: entry.debris.metal ?? "",
    crystal: entry.debris.crystal ?? "",
  };
}

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

const PLANET_COLUMNS = [
  { header: "Coords", key: "coords" },
  { header: "Statut joueur", key: "activityLabel" },
  { header: "Inactif", key: "inactive" },
  { header: "Vacances", key: "onVacation" },
  { header: "Galaxie", key: "galaxy" },
  { header: "Système", key: "system" },
  { header: "Position", key: "position" },
  { header: "Planète", key: "planetName" },
  { header: "Joueur", key: "username" },
  { header: "Rang", key: "rank" },
  { header: "Points", key: "points" },
  { header: "Alliance", key: "allianceTag" },
  { header: "Nom alliance", key: "allianceName" },
  { header: "Activité planète", key: "lastActivity" },
  { header: "Classes", key: "playerClasses" },
  { header: "Lune", key: "moon" },
  { header: "Débris métal", key: "debrisMetal" },
  { header: "Débris cristal", key: "debrisCrystal" },
  { header: "Ennemi", key: "isEnemy" },
  { header: "Ma planète", key: "ownPlanet" },
];

const PLANET_WIDTHS = [12, 14, 8, 9, 8, 9, 9, 18, 18, 8, 10, 10, 16, 12, 14, 18, 12, 12, 8, 10];

function entryToPlanetRow(entry) {
  const alliance = formatAlliance(entry);
  const debris = formatDebris(entry);
  return {
    coords: entry.coords,
    activityLabel: entry.activityLabel ?? "",
    inactive: entry.inactive ? "Oui" : "",
    onVacation: entry.onVacation ? "Oui" : "",
    galaxy: entry.galaxy,
    system: entry.system,
    position: entry.position,
    planetName: entry.planetName,
    username: entry.username,
    rank: entry.rank,
    points: entry.points,
    allianceTag: alliance.tag,
    allianceName: alliance.name,
    lastActivity: entry.lastActivity ?? "",
    playerClasses: (entry.playerClasses ?? []).join(", "),
    moon: formatMoon(entry),
    debrisMetal: debris.metal,
    debrisCrystal: debris.crystal,
    isEnemy: entry.isEnemy ? "Oui" : "",
    ownPlanet: entry.ownPlanet ? "Oui" : "",
  };
}

function addPlanetSheet(workbook, name, entries) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = PLANET_COLUMNS;
  for (const entry of entries) {
    sheet.addRow(entryToPlanetRow(entry));
  }
  applySheetStyle(sheet, PLANET_WIDTHS);
  return sheet;
}

export async function writeGalaxyExcel(payload, outputPath) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Astrogame API";
  workbook.created = new Date();

  addPlanetSheet(workbook, "Planètes", payload.entries);

  const inactiveEntries = payload.entries.filter((entry) => entry.isAttackableInactive);
  if (inactiveEntries.length > 0) {
    addPlanetSheet(workbook, "Inactifs (cibles)", inactiveEntries);
  }

  const playersSheet = workbook.addWorksheet("Joueurs");
  playersSheet.columns = [
    { header: "Joueur", key: "username" },
    { header: "Statut", key: "activityLabel" },
    { header: "Inactif", key: "inactive" },
    { header: "Vacances", key: "onVacation" },
    { header: "Rang", key: "rank" },
    { header: "Points", key: "points" },
    { header: "Alliance", key: "allianceTag" },
    { header: "Nom alliance", key: "allianceName" },
    { header: "Nb planètes", key: "planetCount" },
    { header: "Coordonnées", key: "coordsList" },
  ];

  for (const player of payload.players) {
    const alliance = formatAlliance(player);
    playersSheet.addRow({
      username: player.username,
      activityLabel: player.activityLabel ?? "",
      inactive: player.inactive ? "Oui" : "",
      onVacation: player.onVacation ? "Oui" : "",
      rank: player.rank,
      points: player.points,
      allianceTag: alliance.tag,
      allianceName: alliance.name,
      planetCount: player.planets.length,
      coordsList: player.planets.map((p) => p.coords).join(", "),
    });
  }

  applySheetStyle(playersSheet, [18, 14, 8, 9, 8, 10, 10, 18, 11, 40]);

  const metaSheet = workbook.addWorksheet("Résumé");
  metaSheet.columns = [
    { header: "Clé", key: "key", width: 22 },
    { header: "Valeur", key: "value", width: 50 },
  ];

  const metaRows = [
    ["Univers", payload.meta.universe],
    ["Fusionné le", payload.meta.mergedAt],
    ["Fichiers sources", payload.meta.sourceFiles.join(", ")],
    ["Systèmes", payload.meta.systemsStored],
    ["Planètes", payload.meta.planetEntries],
    ["Joueurs uniques", payload.meta.uniquePlayers],
    ["Planètes inactives", payload.meta.inactivePlanets ?? 0],
    ["Cibles inactives (hors vacances)", payload.meta.attackableInactivePlanets ?? 0],
  ];

  for (const [key, value] of metaRows) {
    metaSheet.addRow({ key, value });
  }

  metaSheet.getRow(1).font = HEADER_FONT;
  metaSheet.getRow(1).fill = HEADER_FILL;

  await workbook.xlsx.writeFile(resolve(outputPath));
}

export function discoverGalaxyJsonFiles(directory = paths.galaxy.exportsDir()) {
  const dir = resolve(directory);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^galaxy.*\.json$/i.test(name) && !/merged\.json$/i.test(name))
    .map((name) => resolve(dir, name))
    .sort();
}

export function parseGalaxyMergeOptions(args) {
  const options = {
    files: [],
    all: false,
    outputJson: paths.galaxy.merged(),
    outputExcel: paths.galaxy.mergedExcel(),
    json: true,
    excel: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--all") {
      options.all = true;
    } else if (arg === "--output") {
      options.outputJson = args[++i];
    } else if (arg === "--excel") {
      options.outputExcel = args[++i];
    } else if (arg === "--no-json") {
      options.json = false;
    } else if (arg === "--no-excel") {
      options.excel = false;
    } else if (!arg.startsWith("-")) {
      options.files.push(arg);
    }
  }

  return options;
}

export async function mergeGalaxyExports(options) {
  let files = options.files;
  if (options.all || files.length === 0) {
    files = discoverGalaxyJsonFiles();
  }

  if (files.length === 0) {
    throw new Error("Aucun fichier galaxy*.json trouvé. Passe des fichiers en argument ou utilise --all.");
  }

  const sources = files.map(loadGalaxyFile);
  const merged = mergeGalaxySources(sources);

  if (options.json) {
    writeFileSync(resolve(options.outputJson), JSON.stringify(merged, null, 2), "utf8");
  }

  if (options.excel) {
    await writeGalaxyExcel(merged, options.outputExcel);
  }

  return { merged, files, options };
}

export function printMergeSummary({ merged, files, options }) {
  logSuccess(
    `Fusion OK — ${merged.meta.planetEntries} planètes / ${merged.meta.uniquePlayers} joueurs / ${merged.meta.systemsStored} systèmes`,
    `Inactifs : ${merged.meta.inactivePlanets ?? 0} (${merged.meta.attackableInactivePlanets ?? 0} attaquables)`,
    `Sources (${files.length}) : ${files.map((f) => basename(f)).join(", ")}`
  );

  if (options.json) {
    console.log(green(`JSON → ${resolve(options.outputJson)}`));
  }
  if (options.excel) {
    console.log(green(`Excel → ${resolve(options.outputExcel)}`));
  }
}
