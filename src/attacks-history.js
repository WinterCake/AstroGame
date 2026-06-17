export function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDayKey(timestamp) {
  if (!timestamp) return null;
  return getTodayKey(new Date(timestamp));
}

export function emptyAttacksStore() {
  return { version: 1, attacks: [] };
}

function migrateLegacyAttacksStore(raw) {
  if (!raw?.coords || typeof raw.coords !== "object") return null;

  const attacks = Object.entries(raw.coords).map(([coords, at]) => ({
    coords,
    at: Number(at) || Date.now(),
    source: "legacy",
  }));

  return { version: 1, attacks };
}

function parseMetaTimestamp(meta) {
  const value = meta?.importedAt ?? meta?.exportedAt ?? null;
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAttackEntry(entry, fallbackAt) {
  const at = Number(entry.at);
  return {
    coords: String(entry.coords),
    at: Number.isFinite(at) && at > 0 ? at : fallbackAt,
    source: entry.source ?? "import",
  };
}

export function migrateLegacyTimestamps(raw) {
  if (!Array.isArray(raw?.attacks)) return raw;
  const fallback = parseMetaTimestamp(raw.meta);
  if (!fallback) return raw;

  let changed = false;
  const attacks = raw.attacks.map((entry) => {
    if (!entry?.coords) return entry;
    const at = Number(entry.at);
    if (Number.isFinite(at) && at > 0) return entry;
    changed = true;
    return { ...entry, at: fallback };
  });

  return changed ? { ...raw, attacks } : raw;
}

export function normalizeAttacksStore(raw) {
  if (!raw) return emptyAttacksStore();

  const fallbackAt = parseMetaTimestamp(raw.meta);

  if (Array.isArray(raw.attacks)) {
    return {
      version: 1,
      attacks: raw.attacks
        .filter((entry) => entry?.coords)
        .map((entry) => normalizeAttackEntry(entry, fallbackAt)),
    };
  }

  const migrated = migrateLegacyAttacksStore(raw);
  if (migrated) return migrated;

  return emptyAttacksStore();
}

export function getAttacksForDay(store, dayKey = getTodayKey()) {
  const normalized = normalizeAttacksStore(store);
  return normalized.attacks.filter((entry) => getDayKey(entry.at) === dayKey);
}

export function getAttackedTodayCoords(store, dayKey = getTodayKey()) {
  return new Set(getAttacksForDay(store, dayKey).map((entry) => entry.coords));
}

export function isCoordAttackedToday(coords, store, dayKey = getTodayKey()) {
  if (!coords) return false;
  return getAttacksForDay(store, dayKey).some((entry) => entry.coords === coords);
}

export function countAttacksToday(store, dayKey = getTodayKey()) {
  return getAttackedTodayCoords(store, dayKey).size;
}

export function mergeAttackRecords(existingRaw, newCoords, meta = {}) {
  const store = normalizeAttacksStore(existingRaw);
  const today = getTodayKey();
  const todayCoords = getAttackedTodayCoords(store, today);
  const now = Date.now();

  for (const coords of newCoords ?? []) {
    const value = String(coords ?? "").trim();
    if (!value || todayCoords.has(value)) continue;
    store.attacks.push({
      coords: value,
      at: now,
      source: meta.source ?? "attack-loot",
    });
    todayCoords.add(value);
  }

  return store;
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

export function serializeAttacksStore(store, meta = {}) {
  const normalized = normalizeAttacksStore(store);
  return {
    meta: {
      source: meta.source ?? "attack-loot",
      importedAt: meta.importedAt ?? new Date().toISOString(),
      ...meta,
    },
    attacks: normalized.attacks.filter((entry) => entry.coords),
  };
}
