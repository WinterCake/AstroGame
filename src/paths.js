import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function getProjectRoot() {
  return ROOT;
}

export function getDataDir() {
  return resolve(process.env.ASTROGAME_DATA_DIR || join(ROOT, "data"));
}

export const paths = {
  root: ROOT,
  data: getDataDir,
  galaxy: {
    global: () => join(getDataDir(), "galaxy", "global.json"),
    exportsDir: () => join(getDataDir(), "galaxy", "exports"),
    defaultScrape: () => join(getDataDir(), "galaxy", "exports", "galaxy-players.json"),
    merged: () => join(getDataDir(), "galaxy", "merged.json"),
    mergedExcel: () => join(getDataDir(), "galaxy", "merged.xlsx"),
    globalExcel: () => join(getDataDir(), "galaxy", "global.xlsx"),
  },
  spy: {
    reports: () => join(getDataDir(), "spy", "reports.json"),
    lootTargets: () => join(getDataDir(), "spy", "loot-targets.json"),
    reportsExcel: () => join(getDataDir(), "spy", "reports.xlsx"),
  },
  attacks: {
    import: () => join(getDataDir(), "attacks", "import.json"),
    historyDir: () => join(getDataDir(), "attacks", "history"),
    extensionImport: () => join(ROOT, "chrome-extension", "attacks-import.json"),
    todayJson: () => join(getDataDir(), "attacks", "history", "attacks-today.json"),
    todayTxt: () => join(getDataDir(), "attacks", "history", "attacks-today.txt"),
    previousTargets: () => join(ROOT, "targets", "previous-attacks.txt"),
  },
  empire: {
    snapshot: () => join(getDataDir(), "empire", "snapshot.json"),
  },
};

export function ensureDataDirs() {
  const dirs = [
    getDataDir(),
    join(getDataDir(), "galaxy"),
    paths.galaxy.exportsDir(),
    join(getDataDir(), "spy"),
    join(getDataDir(), "empire"),
    paths.attacks.historyDir(),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}
