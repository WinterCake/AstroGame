import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ensureDataDirs, getProjectRoot, paths } from "../src/paths.js";

const ROOT = getProjectRoot();

const MOVES = [
  ["global-galaxy.json", paths.galaxy.global()],
  ["loot-targets.json", paths.spy.lootTargets()],
  ["spy-reports.json", paths.spy.reports()],
  ["attacks-import.json", paths.attacks.import()],
  ["empire-resources.json", paths.empire.snapshot()],
  ["galaxy-merged.json", paths.galaxy.merged()],
  ["galaxy-players.json", paths.galaxy.defaultScrape()],
  ["attacks-today.json", paths.attacks.todayJson()],
  ["attacks-yesterday.json", join(paths.attacks.historyDir(), "attacks-yesterday.json")],
  ["attacks-tonight.json", join(paths.attacks.historyDir(), "attacks-tonight.json")],
  ["spy-reports.xlsx", paths.spy.reportsExcel()],
  ["galaxy-merged.xlsx", paths.galaxy.mergedExcel()],
  ["global-galaxy.xlsx", paths.galaxy.globalExcel()],
];

function moveIfExists(fromName, toPath) {
  const from = resolve(ROOT, fromName);
  if (!existsSync(from)) return false;
  if (existsSync(toPath)) {
    console.log(`  skip ${fromName} → ${toPath} (destination exists)`);
    return false;
  }
  mkdirSync(join(toPath, ".."), { recursive: true });
  renameSync(from, toPath);
  console.log(`  moved ${fromName} → ${toPath}`);
  return true;
}

ensureDataDirs();

console.log("Migration data/ …\n");

let moved = 0;
for (const [from, to] of MOVES) {
  if (moveIfExists(from, to)) moved++;
}

const exportsDir = paths.galaxy.exportsDir();
for (const name of readdirSync(ROOT)) {
  if (!/^galaxy.*\.json$/i.test(name)) continue;
  if (name === "global-galaxy.json" || /merged\.json$/i.test(name)) continue;
  const from = resolve(ROOT, name);
  const to = join(exportsDir, name);
  if (existsSync(to)) {
    console.log(`  skip ${name} (already in exports/)`);
    continue;
  }
  renameSync(from, to);
  console.log(`  moved ${name} → ${to}`);
  moved++;
}

if (moved === 0) {
  console.log("Rien à migrer (déjà à jour ou fichiers absents).");
} else {
  console.log(`\n${moved} fichier(s) migré(s).`);
}

console.log("\nStructure data/ :");
console.log(`  ${paths.galaxy.global()}`);
console.log(`  ${paths.spy.lootTargets()}`);
console.log(`  ${paths.attacks.import()}`);
console.log(`  ${paths.empire.snapshot()}`);
