// Généré par npm run sync:shared — ne pas éditer à la main
var AstrogameAttacksCore = (function() {
function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayKey(timestamp) {
  if (!timestamp) return null;
  return getTodayKey(new Date(timestamp));
}

function emptyAttacksStore() {
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

function migrateLegacyTimestamps(raw) {
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

function normalizeAttacksStore(raw) {
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

function getAttacksForDay(store, dayKey = getTodayKey()) {
  const normalized = normalizeAttacksStore(store);
  return normalized.attacks.filter((entry) => getDayKey(entry.at) === dayKey);
}

function getAttackedTodayCoords(store, dayKey = getTodayKey()) {
  return new Set(getAttacksForDay(store, dayKey).map((entry) => entry.coords));
}

function mergeAttackRecords(existingRaw, newCoords, meta = {}) {
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

function serializeAttacksStore(store, meta = {}) {
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

return { getTodayKey, getDayKey, emptyAttacksStore, migrateLegacyTimestamps, normalizeAttacksStore, getAttacksForDay, getAttackedTodayCoords, mergeAttackRecords, serializeAttacksStore };
})();
