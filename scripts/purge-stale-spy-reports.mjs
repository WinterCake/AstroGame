import { readFileSync, writeFileSync } from "node:fs";
import { paths } from "../src/paths.js";
import { purgeStaleSpyReports } from "../src/spy-reports.js";

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const galaxy = loadJson(paths.galaxy.global());
const files = [paths.spy.lootTargets(), paths.spy.reports()];

for (const file of files) {
  const data = loadJson(file);
  const { data: next, removed } = purgeStaleSpyReports(data, galaxy.entries ?? []);
  writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  console.log(`${file}: ${removed.length} rapport(s) périmé(s) supprimé(s)`);
  if (removed.includes("4:381:15")) {
    console.log("  → 4:381:15 (Mars2011) retiré");
  }
}
