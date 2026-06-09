import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const EXTENSION_ID = "jgnbpobailkodlipilakbkappapadddp";

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayKey(timestamp) {
  if (!timestamp) return null;
  return getTodayKey(new Date(Number(timestamp)));
}

function isValidCoord(g, s, p) {
  return g >= 1 && g <= 9 && s >= 1 && s <= 499 && p >= 1 && p <= 15;
}

function defaultChromeStorageDir() {
  const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(
    localAppData,
    "Google",
    "Chrome",
    "User Data",
    "Default",
    "Local Extension Settings",
    EXTENSION_ID
  );
}

function copyStorageToTemp(sourceDir) {
  const destDir = join(tmpdir(), "astro-ext-storage", EXTENSION_ID);
  mkdirSync(destDir, { recursive: true });

  for (const file of readdirSync(sourceDir)) {
    if (file === "LOCK") continue;
    copyFileSync(join(sourceDir, file), join(destDir, file));
  }

  return destDir;
}

function readStorageText(dir) {
  const chunks = [];

  for (const file of readdirSync(dir)) {
    if (!/\.(ldb|log)$/i.test(file)) continue;
    chunks.push(readFileSync(join(dir, file)).toString("utf8"));
  }

  return chunks.join("\n");
}

function extractCoordsFromCorruptedSection(section) {
  const coords = new Set();
  let lastGalaxy = null;

  for (let i = 0; i < section.length; i++) {
    if (section[i] === '"') {
      const parts = [];
      let j = i + 1;
      while (j < section.length && parts.length < 3) {
        let num = "";
        while (j < section.length && section[j] >= "0" && section[j] <= "9") {
          num += section[j++];
        }
        if (!num) break;
        parts.push(num);
        if (j < section.length && section[j] === ":") j++;
        else if (parts.length < 3) break;
      }

      if (parts.length === 3) {
        const g = Number(parts[0]);
        const s = Number(parts[1]);
        const p = Number(parts[2]);
        if (isValidCoord(g, s, p)) {
          coords.add(`${g}:${s}:${p}`);
          lastGalaxy = g;
        }
      }
      continue;
    }

    const tail = section.slice(i, i + 10);
    const match = tail.match(/^(\d{1,3}):(\d{1,2})/);
    if (!match) continue;

    const s = Number(match[1]);
    const p = Number(match[2]);
    if (!isValidCoord(1, s, p)) continue;

    const ctx = section.slice(Math.max(0, i - 40), i);
    const galaxyMatches = [...ctx.matchAll(/"(\d):/g)].map((m) => Number(m[1]));
    const galaxy = galaxyMatches.at(-1) ?? lastGalaxy;
    if (galaxy && isValidCoord(galaxy, s, p)) {
      coords.add(`${galaxy}:${s}:${p}`);
      lastGalaxy = galaxy;
    }
    i += match[0].length - 1;
  }

  return coords;
}

function parseAttacksTodayBlob(text, dayKey = getTodayKey()) {
  const marker = '{"coords":{';
  const attacks = [];
  let bestCoords = new Set();

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(marker, searchFrom);
    if (idx < 0) break;
    searchFrom = idx + marker.length;

    const slice = text.slice(idx, idx + 12000);
    const dateMatch = slice.match(/"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/);
    if (dateMatch?.[1] !== dayKey) continue;

    const end = slice.indexOf('},"date"');
    const section = end > 0 ? slice.slice(0, end + 2) : slice.slice(0, 5000);
    const coords = extractCoordsFromCorruptedSection(section);
    if (coords.size > bestCoords.size) bestCoords = coords;

    for (const coord of coords) {
      attacks.push({
        coords: coord,
        at: Date.now(),
        source: "extension-attacksToday",
      });
    }
  }

  if (bestCoords.size) {
    return [...bestCoords].map((coords) => ({
      coords,
      at: Date.now(),
      source: "extension-attacksToday",
    }));
  }

  return attacks;
}

function parseAttacksHistoryBlob(text, dayKey = getTodayKey()) {
  const attacks = [];
  const marker = '{"version":1,"attacks"';

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const idx = text.indexOf(marker, searchFrom);
    if (idx < 0) break;
    searchFrom = idx + marker.length;

    const slice = text.slice(idx, idx + 500000);
    const entryRegex = /"coords":"(\d+:\d+:\d+)","at":(\d+)/g;

    for (const match of slice.matchAll(entryRegex)) {
      const at = Number(match[2]);
      if (getDayKey(at) !== dayKey) continue;
      attacks.push({
        coords: match[1],
        at,
        source: "extension-attacksHistory",
      });
    }
  }

  return attacks;
}

function parseAttacksJsonFile(filePath, dayKey = getTodayKey()) {
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const attacks = [];

  if (Array.isArray(raw.attacks)) {
    for (const entry of raw.attacks) {
      if (!entry?.coords) continue;
      const at = Number(entry.at) || Date.now();
      if (getDayKey(at) !== dayKey) continue;
      attacks.push({
        coords: String(entry.coords),
        at,
        source: "attacks-json-export",
        ...entry,
      });
    }
    return attacks;
  }

  if (raw.coords && typeof raw.coords === "object") {
    for (const [coords, at] of Object.entries(raw.coords)) {
      const timestamp = Number(at) || Date.now();
      if (raw.date && raw.date !== dayKey) continue;
      if (!raw.date && getDayKey(timestamp) !== dayKey) continue;
      attacks.push({
        coords: String(coords),
        at: timestamp,
        source: "attacks-json-legacy",
      });
    }
  }

  return attacks;
}

function uniqueByCoords(attacks) {
  const byCoords = new Map();

  for (const attack of attacks) {
    if (!attack?.coords) continue;
    const existing = byCoords.get(attack.coords);
    if (!existing || Number(attack.at) > Number(existing.at)) {
      byCoords.set(attack.coords, attack);
    }
  }

  return [...byCoords.values()].sort((a, b) =>
    a.coords.localeCompare(b.coords, undefined, { numeric: true })
  );
}

export function loadAttacksFromChromeStorage(options = {}) {
  const dayKey = options.dayKey ?? getTodayKey();
  const sourceDir = options.storageDir ?? defaultChromeStorageDir();

  if (!existsSync(sourceDir)) {
    return { attacks: [], storageDir: sourceDir, error: "storage-not-found" };
  }

  let readDir = sourceDir;
  try {
    readDir = copyStorageToTemp(sourceDir);
  } catch {
    readDir = sourceDir;
  }

  const text = readStorageText(readDir);
  const fromHistory = parseAttacksHistoryBlob(text, dayKey);
  const fromToday = parseAttacksTodayBlob(text, dayKey);
  const attacks = uniqueByCoords([...fromHistory, ...fromToday]);

  return {
    attacks,
    storageDir: sourceDir,
    readDir,
    counts: {
      attacksHistory: fromHistory.length,
      attacksToday: fromToday.length,
      unique: attacks.length,
    },
  };
}

export function loadAttacksFromSources(options = {}) {
  const dayKey = options.dayKey ?? getTodayKey();
  const all = [];

  if (options.jsonFile && existsSync(options.jsonFile)) {
    all.push(...parseAttacksJsonFile(options.jsonFile, dayKey));
  }

  const chrome = loadAttacksFromChromeStorage({ ...options, dayKey });
  all.push(...chrome.attacks);

  return {
    attacks: uniqueByCoords(all),
    chrome,
    dayKey,
  };
}

export { getTodayKey, getDayKey, defaultChromeStorageDir };
