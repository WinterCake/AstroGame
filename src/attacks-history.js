export {
  emptyAttacksStore,
  getAttackedTodayCoords,
  getAttacksForDay,
  getDayKey,
  getTodayKey,
  mergeAttackRecords,
  migrateLegacyTimestamps,
  normalizeAttacksStore,
  serializeAttacksStore,
} from "../shared/attacks-core.js";

import {
  getAttackedTodayCoords,
  getAttacksForDay,
  getDayKey,
  getTodayKey,
  normalizeAttacksStore,
} from "../shared/attacks-core.js";

export function isCoordAttackedToday(coords, store, dayKey = getTodayKey()) {
  if (!coords) return false;
  return getAttacksForDay(store, dayKey).some((entry) => entry.coords === coords);
}

export function countAttacksToday(store, dayKey = getTodayKey()) {
  return getAttackedTodayCoords(store, dayKey).size;
}

export function removeAttackCoords(storeRaw, coordsToRemove) {
  const remove = new Set((coordsToRemove ?? []).map((c) => String(c).trim()).filter(Boolean));
  const store = normalizeAttacksStore(storeRaw);
  store.attacks = store.attacks.filter((entry) => !remove.has(entry.coords));
  return store;
}

export function clearAttacksForDay(storeRaw, dayKey = getTodayKey()) {
  const store = normalizeAttacksStore(storeRaw);
  store.attacks = store.attacks.filter((entry) => getDayKey(entry.at) !== dayKey);
  return store;
}

export function getAttacksTodayList(storeRaw) {
  const todayKey = getTodayKey();
  const entries = getAttacksForDay(normalizeAttacksStore(storeRaw), todayKey);
  const byCoords = new Map();
  for (const entry of entries) {
    const prev = byCoords.get(entry.coords);
    if (!prev || (entry.at || 0) > (prev.at || 0)) byCoords.set(entry.coords, entry);
  }
  return [...byCoords.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
}

export function getAttacksHistoryList(storeRaw) {
  const store = normalizeAttacksStore(storeRaw);
  const byCoords = new Map();
  for (const entry of store.attacks) {
    const prev = byCoords.get(entry.coords);
    if (!prev || (entry.at || 0) > (prev.at || 0)) byCoords.set(entry.coords, entry);
  }
  return [...byCoords.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
}
