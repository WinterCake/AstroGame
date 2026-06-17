import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ClassicLevel } from "classic-level";
import { paths } from "../src/paths.js";
import { defaultChromeStorageDir, getTodayKey } from "./chrome-storage-attacks.mjs";

const EXTENSION_ID = "jgnbpobailkodlipilakbkappapadddp";

function loadCoordsFromArgs(argv) {
  const options = { file: paths.attacks.import() };
  const coords = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") options.file = resolve(argv[++i]);
    else if (/^\d+:\d+:\d+$/.test(arg)) coords.push(arg);
  }

  if (!coords.length && existsSync(options.file)) {
    const raw = JSON.parse(readFileSync(options.file, "utf8"));
    for (const entry of raw.attacks ?? []) {
      const value = typeof entry === "string" ? entry : entry?.coords;
      if (value) coords.push(String(value));
    }
  }

  return [...new Set(coords)];
}

function copyDir(sourceDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const file of readdirSync(sourceDir)) {
    if (file === "LOCK") continue;
    try {
      copyFileSync(join(sourceDir, file), join(destDir, file));
    } catch {
      // Fichier verrouillé par Chrome — on continue avec le reste
    }
  }
}

function normalizeHistory(raw, coords, source) {
  const attacks = Array.isArray(raw?.attacks)
    ? raw.attacks.map((entry) => ({
        coords: String(entry.coords),
        at: Number(entry.at) || Date.now(),
        source: entry.source ?? "click",
      }))
    : [];

  const today = getTodayKey();
  const todayCoords = new Set(
    attacks.filter((entry) => getTodayKey(new Date(entry.at)) === today).map((entry) => entry.coords)
  );

  const now = Date.now();
  for (const coord of coords) {
    if (todayCoords.has(coord)) continue;
    attacks.push({ coords: coord, at: now, source });
    todayCoords.add(coord);
  }

  return { version: 1, attacks };
}

function normalizeLegacy(coords) {
  const today = getTodayKey();
  const legacy = { coords: {}, date: today };
  const now = Date.now();
  for (const coord of coords) legacy.coords[coord] = now;
  return legacy;
}

async function readKey(db, key) {
  try {
    const value = await db.get(key);
    return JSON.parse(value.toString());
  } catch {
    return null;
  }
}

const sourceDir = defaultChromeStorageDir();
if (!existsSync(sourceDir)) {
  throw new Error(`Storage extension introuvable : ${sourceDir}`);
}

const coords = loadCoordsFromArgs(process.argv.slice(2));
if (!coords.length) {
  throw new Error("Aucune coordonnée à écrire.");
}

const workDir = join(tmpdir(), "astro-write-attacks", String(Date.now()));
copyDir(sourceDir, workDir);

const db = new ClassicLevel(workDir);
await db.open();

const existingHistory = await readKey(db, "attacksHistory");
const existingToday = await readKey(db, "attacksToday");

const allCoords = new Set([
  ...coords,
  ...Object.keys(existingToday?.coords ?? {}),
  ...(existingHistory?.attacks ?? [])
    .filter((entry) => getTodayKey(new Date(entry.at)) === getTodayKey())
    .map((entry) => entry.coords),
]);

const history = normalizeHistory(existingHistory, [...allCoords], "attack-loot");
const legacy = normalizeLegacy([...allCoords]);

await db.put("attacksHistory", JSON.stringify(history));
await db.put("attacksToday", JSON.stringify(legacy));
await db.close();

let copied = 0;
for (const file of readdirSync(workDir)) {
  if (file === "LOCK") continue;
  try {
    copyFileSync(join(workDir, file), join(sourceDir, file));
    copied++;
  } catch (error) {
    console.warn(`Impossible de copier ${file} : ${error.message}`);
  }
}

console.log(`OK — ${coords.length} coord(s) fusionnée(s), ${allCoords.size} au total aujourd'hui.`);
console.log(`Fichiers copiés : ${copied}`);
console.log(`Si l'extension ne se met pas à jour : recharge-la (chrome://extensions) ou rouvre le popup.`);
