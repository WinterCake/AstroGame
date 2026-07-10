const ATTACKS_STORAGE_KEY = "attacksHistory";
const LEGACY_ATTACKS_KEY = "attacksToday";

const A = AstrogameAttacksCore;
const getTodayKey = A.getTodayKey;
const getDayKey = A.getDayKey;
const emptyAttacksStore = A.emptyAttacksStore;
const normalizeAttacksStore = A.normalizeAttacksStore;
const getAttacksForDay = A.getAttacksForDay;
const getAttackedTodayCoords = A.getAttackedTodayCoords;
const mergeAttackRecords = A.mergeAttackRecords;

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

function recordAttacksBatch(store, coordsList, meta = {}) {
  return mergeAttackRecords(store, coordsList, { source: meta.source ?? "import" });
}

function mergeStorageAttacks(historyRaw, legacyRaw) {
  const today = getTodayKey();
  let store = normalizeAttacksStore(historyRaw);
  const legacy = legacyRaw;

  if (legacy?.coords && typeof legacy.coords === "object" && legacy.date === today) {
    const now = Date.now();
    const knownToday = new Set(getAttacksForDay(store, today).map((entry) => entry.coords));
    for (const [coords] of Object.entries(legacy.coords)) {
      if (knownToday.has(coords)) continue;
      store.attacks.push({
        coords: String(coords),
        at: now,
        source: "legacy-today",
      });
      knownToday.add(coords);
    }
  }

  if (!store.attacks.length && legacy) {
    store = normalizeAttacksStore(legacy);
  }

  return store;
}

function isCoordAttackedToday(coords, store) {
  if (!coords) return false;
  return getAttacksForDay(store).some((entry) => entry.coords === coords);
}

function countAttacksToday(store) {
  return getAttackedTodayCoords(store).size;
}

function countAllAttacks(store) {
  return normalizeAttacksStore(store).attacks.length;
}

function renderAttackBadge(attacked) {
  if (!attacked) return "";
  return '<span class="attack-badge" title="Attaque lancée aujourd\'hui">Déjà attaqué</span>';
}
