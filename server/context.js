import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCredentials } from "../src/config.js";
import {
  emptyAttacksStore,
  getAttackedTodayCoords,
  getAttacksHistoryList,
  getAttacksTodayList,
  countAttacksToday,
  mergeAttackRecords,
  migrateLegacyTimestamps,
  normalizeAttacksStore,
} from "../src/attacks-history.js";
import { saveAttacksStore } from "../src/attack-loot-send.js";
import { applyCombatHiddenFilter } from "../src/combat-reports.js";
import { groupEntriesByPlayer } from "../src/galaxy.js";
import { getAllSpiedCoords, getSpiedTodayCoords, isReportToday } from "../src/spy-reports.js";
import { buildSpyEnrichmentContext, enrichGalaxyEntry, enrichSpyReport } from "../src/spy-enrichment.js";
import { loadRawSpyArchiveReports, loadSpyReportsData, saveSpyReportsData } from "../src/spy-store.js";
import { normalizeCoordString } from "../src/spy-send.js";
import { paths } from "../src/paths.js";

export function createServerContext() {
  function loadJson(path) {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  }

  function getSpyEnrichmentContext() {
    const attacks = loadJson(paths.attacks.import());
    const combat = loadJson(paths.combat.reports());
    const galaxy = loadJson(paths.galaxy.global());
    const { username } = getCredentials();
    return buildSpyEnrichmentContext({
      attacksImport: attacks,
      combatReports: combat?.reports,
      username,
      galaxyEntries: galaxy?.entries,
    });
  }

  function loadCombatReportsData() {
    const data = loadJson(paths.combat.reports()) ?? { reports: [], meta: {} };
    const hidden = data.meta?.hiddenMessageIds;
    if (hidden?.length) {
      return { ...data, reports: applyCombatHiddenFilter(data.reports, hidden) };
    }
    return data;
  }

  function saveCombatReportsData(data) {
    writeFileSync(paths.combat.reports(), JSON.stringify(data, null, 2), "utf8");
  }

  function loadSpiedTodayContext() {
    const data = loadSpyReportsData();
    const spiedLogToday = getAttackedTodayCoords(loadJson(paths.spy.spiedLog()) ?? emptyAttacksStore());
    const spiedTodaySet = getSpiedTodayCoords(data.reports, spiedLogToday);
    const allSpiedSet = getAllSpiedCoords(loadRawSpyArchiveReports());
    return {
      spiedTodaySet,
      spiedTodayCount: spiedTodaySet.size,
      allSpiedSet,
      allSpiedCount: allSpiedSet.size,
    };
  }

  function enrichGalaxyEntryForApi(entry, ctx) {
    return enrichGalaxyEntry(entry, ctx, normalizeCoordString);
  }

  function loadAttacksStore() {
    let data = loadJson(paths.attacks.import()) ?? { attacks: [], meta: {} };
    const migrated = migrateLegacyTimestamps(data);
    if (migrated !== data) {
      saveAttacksStore(migrated);
      data = migrated;
    }
    return data;
  }

  function loadCoordsFromTextFile(filePath) {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .filter((line) => /^\d+:\d+:\d+$/.test(line));
  }

  function loadCoordsFromHistoryExports() {
    const coords = new Set();
    const dir = paths.attacks.historyDir();
    if (!existsSync(dir)) return [];

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const payload = JSON.parse(readFileSync(join(dir, file), "utf8"));
        for (const value of payload.coords ?? []) {
          if (/^\d+:\d+:\d+$/.test(String(value))) coords.add(String(value));
        }
        for (const entry of payload.attacks ?? []) {
          const c = typeof entry === "string" ? entry : entry?.coords;
          if (c && /^\d+:\d+:\d+$/.test(String(c))) coords.add(String(c));
        }
      } catch {
        /* ignore */
      }
    }
    return [...coords];
  }

  function loadExternalAttackCoords() {
    return [
      ...new Set([
        ...loadCoordsFromTextFile(paths.attacks.previousTargets()),
        ...loadCoordsFromHistoryExports(),
      ]),
    ];
  }

  return {
    loadJson,
    paths,
    getSpyEnrichmentContext,
    enrichSpyReport,
    loadSpyReportsData,
    saveSpyReportsData,
    loadCombatReportsData,
    saveCombatReportsData,
    loadSpiedTodayContext,
    enrichGalaxyEntryForApi,
    groupEntriesByPlayer,
    loadAttacksStore,
    loadExternalAttackCoords,
    isReportToday,
    getAttacksTodayList,
    getAttacksHistoryList,
    countAttacksToday,
    normalizeAttacksStore,
    mergeAttackRecords,
    saveAttacksStore,
  };
}
