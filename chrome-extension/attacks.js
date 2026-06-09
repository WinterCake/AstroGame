const ATTACKS_STORAGE_KEY = "attacksHistory";
const LEGACY_ATTACKS_KEY = "attacksToday";

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

function parseAttackCoordsFromUrl(href) {
  try {
    const url = new URL(href, "https://play.astrogame.org");
    if (!url.pathname.includes("/game/fleetTable")) return null;
    if (url.searchParams.get("target_mission") !== "1") return null;

    const galaxy = url.searchParams.get("galaxy");
    const system = url.searchParams.get("system");
    const planet = url.searchParams.get("planet");
    if (!galaxy || !system || !planet) return null;

    return `${galaxy}:${system}:${planet}`;
  } catch {
    return null;
  }
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

function normalizeAttacksStore(raw) {
  if (!raw) return emptyAttacksStore();

  if (Array.isArray(raw.attacks)) {
    return {
      version: 1,
      attacks: raw.attacks
        .filter((entry) => entry?.coords)
        .map((entry) => ({
          coords: String(entry.coords),
          at: Number(entry.at) || Date.now(),
          source: entry.source ?? "click",
        })),
    };
  }

  const migrated = migrateLegacyAttacksStore(raw);
  if (migrated) return migrated;

  return emptyAttacksStore();
}

function recordAttack(store, coords, meta = {}) {
  const normalized = normalizeAttacksStore(store);
  if (!coords) return normalized;

  normalized.attacks.push({
    coords: String(coords),
    at: Date.now(),
    source: meta.source ?? "click",
  });

  return normalized;
}

function getAttacksForDay(store, dayKey = getTodayKey()) {
  const normalized = normalizeAttacksStore(store);
  return normalized.attacks.filter((entry) => getDayKey(entry.at) === dayKey);
}

function isCoordAttackedToday(coords, store) {
  if (!coords) return false;
  return getAttacksForDay(store).some((entry) => entry.coords === coords);
}

function countAttacksToday(store) {
  const today = getTodayKey();
  const coords = new Set(getAttacksForDay(store, today).map((entry) => entry.coords));
  return coords.size;
}

function countAllAttacks(store) {
  return normalizeAttacksStore(store).attacks.length;
}

function renderAttackBadge(attacked) {
  if (!attacked) return "";
  return '<span class="attack-badge" title="Attaque lancée aujourd\'hui">Déjà attaqué</span>';
}
