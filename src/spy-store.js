import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { applySpyHiddenFilter } from "../shared/spy-core.js";
import { normalizeAttacksStore } from "./attacks-history.js";
import { normalizeCoordString } from "./spy-send.js";
import { paths } from "./paths.js";

function loadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadSpyReportsData() {
  const data = loadJson(paths.spy.lootTargets()) ?? loadJson(paths.spy.reports()) ?? { reports: [], meta: {} };
  const hidden = data.meta?.hiddenCoords;
  if (hidden?.length) {
    return {
      ...data,
      reports: applySpyHiddenFilter(data.reports, hidden),
    };
  }
  return data;
}

/**
 * Écrit le store canonique (loot-targets.json) et miroir optionnel (reports.json).
 * loot-targets = store actif ; reports.json = archive/sync pour historique complet.
 */
export function saveSpyReportsBundle(data, { mirrorArchive = true } = {}) {
  const payload = {
    ...data,
    meta: {
      ...data.meta,
      canonicalStore: "loot-targets.json",
      updatedAt: new Date().toISOString(),
    },
  };

  writeFileSync(paths.spy.lootTargets(), JSON.stringify(payload, null, 2), "utf8");

  if (mirrorArchive) {
    writeFileSync(
      paths.spy.reports(),
      JSON.stringify(
        {
          ...payload,
          meta: {
            ...payload.meta,
            mirroredFrom: "loot-targets.json",
          },
        },
        null,
        2
      ),
      "utf8"
    );
  }

  return payload;
}

export function saveSpyReportsData(data) {
  return saveSpyReportsBundle(data, { mirrorArchive: true });
}

/** Tous les rapports espionnage connus (loot-targets + reports.json), sans filtre masqué. */
export function loadRawSpyArchiveReports() {
  const loot = loadJson(paths.spy.lootTargets());
  const reports = loadJson(paths.spy.reports());
  const byCoords = new Map();
  for (const report of [...(reports?.reports ?? []), ...(loot?.reports ?? [])]) {
    if (!report?.coords) continue;
    byCoords.set(normalizeCoordString(report.coords), report);
  }
  return [...byCoords.values()];
}

/**
 * Coords déjà espionnées au moins une fois :
 * rapports locaux + rapports masqués/supprimés + journal d'envois sondes.
 */
export function buildAllSpiedCoordsSet({
  reports = [],
  hiddenCoords = [],
  spiedLogStore = null,
} = {}) {
  const coords = new Set();

  for (const report of reports ?? []) {
    const value = normalizeCoordString(report?.coords);
    if (value) coords.add(value);
  }

  for (const raw of hiddenCoords ?? []) {
    const value = normalizeCoordString(raw);
    if (value) coords.add(value);
  }

  for (const entry of normalizeAttacksStore(spiedLogStore).attacks) {
    const value = normalizeCoordString(entry.coords);
    if (value) coords.add(value);
  }

  return coords;
}

/** Charge l'ensemble complet des coords déjà espionnées (pour galaxie / filtres). */
export function loadAllSpiedCoordsSet() {
  const loot = loadJson(paths.spy.lootTargets());
  const reportsFile = loadJson(paths.spy.reports());
  const hidden = [
    ...(loot?.meta?.hiddenCoords ?? []),
    ...(reportsFile?.meta?.hiddenCoords ?? []),
  ];
  return buildAllSpiedCoordsSet({
    reports: loadRawSpyArchiveReports(),
    hiddenCoords: hidden,
    spiedLogStore: loadJson(paths.spy.spiedLog()),
  });
}
