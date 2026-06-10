const ATTACKS_STORAGE_KEY = "attacksHistory";

function parseCoordsParam(raw) {
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter((value) => /^\d+:\d+:\d+$/.test(value));
}

async function importAttacks(coords, source = "import") {
  const result = await chrome.storage.local.get([ATTACKS_STORAGE_KEY, LEGACY_ATTACKS_KEY]);
  const beforeToday = countAttacksToday(normalizeAttacksStore(result[ATTACKS_STORAGE_KEY]));
  const store = recordAttacksBatch(result[ATTACKS_STORAGE_KEY], coords, { source });

  const today = getTodayKey();
  const legacy = result[LEGACY_ATTACKS_KEY] ?? { coords: {}, date: today };
  if (legacy.date !== today) legacy.coords = {};
  legacy.date = today;
  const now = Date.now();
  for (const coord of coords) legacy.coords[coord] = now;

  await chrome.storage.local.set({
    [ATTACKS_STORAGE_KEY]: store,
    [LEGACY_ATTACKS_KEY]: legacy,
  });
  const afterToday = countAttacksToday(store);
  return {
    requested: coords.length,
    addedToday: afterToday - beforeToday,
    today: afterToday,
    total: countAllAttacks(store),
  };
}

async function run() {
  const statusEl = document.getElementById("status");
  const detailsEl = document.getElementById("details");

  try {
    const params = new URLSearchParams(location.search);
    const source = params.get("source") || "attack-loot";
    let coords = parseCoordsParam(params.get("coords"));

    if (!coords.length && params.get("file")) {
      const response = await fetch(chrome.runtime.getURL(params.get("file")));
      const payload = await response.json();
      coords = (payload.attacks ?? payload.coords ?? [])
        .map((entry) => (typeof entry === "string" ? entry : entry?.coords))
        .filter(Boolean);
    }

    if (!coords.length) {
      statusEl.textContent = "Aucune coordonnée à importer.";
      statusEl.className = "err";
      return;
    }

    const result = await importAttacks(coords, source);
    statusEl.textContent = `OK — ${result.addedToday} nouvelle(s) attaque(s) aujourd'hui (${result.today} au total aujourd'hui).`;
    statusEl.className = "ok";
    detailsEl.textContent = coords.join("\n");
    setTimeout(() => window.close(), 1500);
  } catch (error) {
    statusEl.textContent = `Erreur : ${error.message}`;
    statusEl.className = "err";
  }
}

run();
