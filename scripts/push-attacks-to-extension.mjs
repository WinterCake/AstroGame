import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EXTENSION_ID = "jgnbpobailkodlipilakbkappapadddp";

function parseCoordsFromLog(text) {
  const coords = [];
  const regex = /\[OK\]\s+(\d+:\d+:\d+)/g;
  for (const match of text.matchAll(regex)) coords.push(match[1]);
  return [...new Set(coords)];
}

function loadCoords(options) {
  if (options.coords?.length) return options.coords;

  if (options.file && existsSync(options.file)) {
    const raw = JSON.parse(readFileSync(options.file, "utf8"));
    if (Array.isArray(raw.attacks)) {
      return raw.attacks.map((entry) => String(entry.coords ?? entry).trim()).filter(Boolean);
    }
    if (Array.isArray(raw.coords)) return raw.coords.map(String);
  }

  if (options.log && existsSync(options.log)) {
    return parseCoordsFromLog(readFileSync(options.log, "utf8"));
  }

  throw new Error("Aucune source de coords (--file, --log ou coords en argument).");
}

function buildImportUrl(coords, source = "attack-loot") {
  const params = new URLSearchParams({
    source,
    coords: coords.join(","),
  });
  return `chrome-extension://${EXTENSION_ID}/import-attacks.html?${params.toString()}`;
}

function parseArgs(argv) {
  const options = { coords: [], open: true, source: "attack-loot" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") options.file = resolve(argv[++i]);
    else if (arg === "--log") options.log = resolve(argv[++i]);
    else if (arg === "--source") options.source = argv[++i];
    else if (arg === "--no-open") options.open = false;
    else if (/^\d+:\d+:\d+$/.test(arg)) options.coords.push(arg);
  }
  if (!options.file && !options.log) {
    options.file = resolve("attacks-import.json");
    options.log = resolve("attack-loot-run.log");
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
let coords = [];

try {
  coords = loadCoords(options);
} catch (error) {
  if (options.log && existsSync(options.log)) {
    coords = parseCoordsFromLog(readFileSync(options.log, "utf8"));
  } else {
    throw error;
  }
}

if (!coords.length) {
  throw new Error("Aucune coordonnée à importer.");
}

writeFileSync(
  resolve("attacks-import.json"),
  JSON.stringify(
    {
      meta: { source: options.source, importedAt: new Date().toISOString() },
      attacks: coords.map((coordsValue) => ({ coords: coordsValue, source: options.source })),
    },
    null,
    2
  ),
  "utf8"
);

const url = buildImportUrl(coords, options.source);
console.log(`${coords.length} coordonnée(s) prêtes pour l'extension.`);
console.log(url);

copyFileSync(resolve("attacks-import.json"), resolve("chrome-extension/attacks-import.json"));

if (options.open) {
  try {
    execSync(`start "" chrome "${url}"`, { stdio: "ignore", shell: true });
    console.log("Page d'import ouverte dans Chrome.");
  } catch {
    console.log("Ouvre l'URL ci-dessus manuellement dans Chrome (extension chargée).");
  }
}

console.log("Recharge l'extension (chrome://extensions) puis rouvre le panneau espionnage.");
