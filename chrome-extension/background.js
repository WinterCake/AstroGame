importScripts("galaxy-activity.js", "parse.js", "spy-parse.js", "attacks.js");

const STORAGE_KEY = "galaxyData";
const SPY_STORAGE_KEY = "spyReports";
const SETTINGS_KEY = "settings";
const DEFAULT_UNIVERSE = "uni24";

async function getAttacksStore() {
  const result = await chrome.storage.local.get([ATTACKS_STORAGE_KEY, LEGACY_ATTACKS_KEY]);
  return mergeStorageAttacks(result[ATTACKS_STORAGE_KEY], result[LEGACY_ATTACKS_KEY]);
}

async function consolidateAttacksStorage() {
  const result = await chrome.storage.local.get([ATTACKS_STORAGE_KEY, LEGACY_ATTACKS_KEY]);
  const store = mergeStorageAttacks(result[ATTACKS_STORAGE_KEY], result[LEGACY_ATTACKS_KEY]);
  const today = getTodayKey();
  const legacyCoords = {};

  for (const entry of getAttacksForDay(store, today)) {
    legacyCoords[entry.coords] = Number(entry.at) || Date.now();
  }

  await chrome.storage.local.set({
    [ATTACKS_STORAGE_KEY]: store,
    [LEGACY_ATTACKS_KEY]: { coords: legacyCoords, date: today },
  });

  return store;
}

async function saveAttacksStore(store) {
  await chrome.storage.local.set({ [ATTACKS_STORAGE_KEY]: store });
}

async function markAttacked(coords, meta = {}) {
  const store = recordAttack(await getAttacksStore(), coords, meta);
  await saveAttacksStore(store);
  return store;
}

async function getSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return { captureEnabled: true, spyCaptureEnabled: true, ...result[SETTINGS_KEY] };
}

async function getStore() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] ?? buildPayload([], null);
}

async function getSpyStore() {
  const result = await chrome.storage.local.get(SPY_STORAGE_KEY);
  return result[SPY_STORAGE_KEY] ?? buildSpyPayload([], { universe: DEFAULT_UNIVERSE });
}

async function saveStore(payload) {
  await chrome.storage.local.set({ [STORAGE_KEY]: payload });
  await chrome.action.setBadgeBackgroundColor({ color: "#1a6fb5" });
  await chrome.action.setBadgeText({
    text: payload.meta.systemsStored > 0 ? String(payload.meta.systemsStored) : "",
  });
}

async function saveSpyStore(payload) {
  await chrome.storage.local.set({ [SPY_STORAGE_KEY]: payload });
}

function extractUniverseFromUrl(url) {
  const match = String(url ?? "").match(/play\.astrogame\.org\/(uni\d+)/i);
  return match?.[1] ?? DEFAULT_UNIVERSE;
}

async function mergeGalaxyResponse(payload) {
  const store = await getStore();
  const galaxy = Number(payload.galaxy);
  const system = Number(payload.system);
  const systemKey = `${galaxy}:${system}`;
  const newEntries = parseSystemEntries(galaxy, system, payload.existsPlanets);

  const kept = store.entries.filter((entry) => `${entry.galaxy}:${entry.system}` !== systemKey);
  const entries = [...kept, ...newEntries];
  const merged = buildPayload(entries, systemKey);

  await saveStore(merged);
  return merged;
}

async function mergeSpyCapture(html, url) {
  const incoming = parseSpyReportsHtml(html);
  if (!incoming.length) return null;

  const store = await getSpyStore();
  const reports = mergeSpyReports(store.reports, incoming);
  const payload = buildSpyPayload(reports, {
    universe: extractUniverseFromUrl(url) || store.meta.universe || DEFAULT_UNIVERSE,
    lastCapture: new Date().toISOString(),
    pagesScanned: store.meta.pagesScanned ?? null,
  });

  await saveSpyStore(payload);
  return payload;
}

async function findAstrogameTab() {
  const tabs = await chrome.tabs.query({ url: "https://play.astrogame.org/*" });
  return tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
}

async function scrapeSpyReportsViaTab(universe) {
  const tab = await findAstrogameTab();
  if (!tab?.id) {
    throw new Error("Ouvre play.astrogame.org dans Chrome (connecté), puis réessaie Charger");
  }

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_SPY_PAGES", universe });
  } catch (error) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["attacks.js", "spy-parse.js", "content-game.js"],
    });
    result = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_SPY_PAGES", universe });
  }

  if (!result?.ok) {
    const logs = result?.logs?.join(" | ") ?? "";
    throw new Error(`${result?.error ?? "Échec scrape onglet"}${logs ? ` — ${logs}` : ""}`);
  }

  return result;
}

async function fetchSpyMessagesPage(universe, page) {
  const url = `https://play.astrogame.org/${universe}/game/messages/view?messcat=${SPY_CATEGORY}&site=${page}&ajax=1`;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      Accept: "text/html, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} — es-tu connecté sur Astrogame ?`);
  }

  const html = await response.text();
  return {
    page,
    maxPage: detectMaxSpyPage(html),
    reports: parseSpyReportsHtml(html),
  };
}

async function scrapeAllSpyReports(universe = DEFAULT_UNIVERSE) {
  const logs = [];
  let reports = [];
  let pagesScanned = 0;
  let withDetail = 0;
  let scrapeSource = "tab";

  try {
    const tabResult = await scrapeSpyReportsViaTab(universe);
    reports = tabResult.reports ?? [];
    pagesScanned = tabResult.pagesScanned ?? 1;
    withDetail = tabResult.withDetail ?? 0;
    logs.push(...(tabResult.logs ?? []));
  } catch (tabError) {
    logs.push(`Onglet: ${tabError.message}`);
    logs.push("Fallback service worker…");
    scrapeSource = "background";

    const first = await fetchSpyMessagesPage(universe, 1);
    logs.push(`SW p1: HTTP ok, ${first.reports.length} rapports`);
    pagesScanned = first.maxPage;
    reports = [...first.reports];

    for (let page = 2; page <= first.maxPage; page++) {
      const result = await fetchSpyMessagesPage(universe, page);
      reports.push(...result.reports);
    }

    withDetail = reports.filter((report) => report.spyData).length;
    if (withDetail === 0 && reports.length === 0) {
      throw new Error(
        `${tabError.message}. Fallback SW: 0 rapport — connecte-toi sur Astrogame et recharge l'onglet (F5).`
      );
    }
  }

  const existingStore = await getSpyStore();
  const merged = mergeSpyReports(existingStore.reports ?? [], reports);
  withDetail = merged.filter((report) => report.spyData).length;

  const payload = buildSpyPayload(merged, {
    universe,
    pagesScanned,
    lastScrape: new Date().toISOString(),
    scrapeSource,
    withDetail,
    debugLogs: logs,
  });

  await saveSpyStore(payload);
  return { payload, logs, withDetail, total: merged.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let responded = false;
  const safeSend = (payload) => {
    if (responded) return;
    responded = true;
    try {
      sendResponse(payload);
    } catch {
      // popup fermé
    }
  };

  (async () => {
    try {
      switch (message.type) {
        case "GALAXY_DATA": {
          const settings = await getSettings();
          if (!settings.captureEnabled) {
            safeSend({ skipped: true });
            return;
          }
          const data = await mergeGalaxyResponse(message.payload);
          safeSend({ ok: true, meta: data.meta });
          return;
        }
        case "GET_DATA":
          safeSend(await getStore());
          return;
        case "GET_SPY_DATA":
          safeSend(await getSpyStore());
          return;
        case "SCRAPE_SPY": {
          const universe = message.universe || DEFAULT_UNIVERSE;
          const result = await scrapeAllSpyReports(universe);
          safeSend({
            ok: true,
            meta: result.payload.meta,
            total: result.total,
            withDetail: result.withDetail,
            logs: result.logs,
          });
          return;
        }
        case "GET_SPY_DEBUG": {
          const store = await getSpyStore();
          safeSend({
            meta: store.meta,
            sample: store.reports?.slice(0, 3).map((report) => ({
              coords: report.coords,
              messageId: report.messageId,
              hasSpyData: Boolean(report.spyData),
              keys: report.spyData ? Object.keys(report.spyData) : [],
            })),
          });
          return;
        }
        case "SPY_PAGE_CAPTURE": {
          const settings = await getSettings();
          if (!settings.spyCaptureEnabled) {
            safeSend({ skipped: true });
            return;
          }
          const data = await mergeSpyCapture(message.html, message.url);
          safeSend({ ok: true, added: data?.reports?.length ?? 0, meta: data?.meta });
          return;
        }
        case "GET_SETTINGS":
          safeSend(await getSettings());
          return;
        case "SET_CAPTURE": {
          const settings = await getSettings();
          settings.captureEnabled = Boolean(message.enabled);
          await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
          safeSend(settings);
          return;
        }
        case "SET_SPY_CAPTURE": {
          const settings = await getSettings();
          settings.spyCaptureEnabled = Boolean(message.enabled);
          await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
          safeSend(settings);
          return;
        }
        case "CLEAR_DATA": {
          const empty = buildPayload([], null);
          await saveStore(empty);
          safeSend(empty);
          return;
        }
        case "CLEAR_SPY": {
          const empty = buildSpyPayload([], { universe: DEFAULT_UNIVERSE });
          await saveSpyStore(empty);
          safeSend(empty);
          return;
        }
        case "GET_UNIVERSE": {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const url = tabs[0]?.url ?? "";
          safeSend({ universe: extractUniverseFromUrl(url) });
          return;
        }
        case "GET_ATTACKS":
          safeSend(await getAttacksStore());
          return;
        case "MARK_ATTACKED": {
          if (!message.coords) {
            safeSend({ ok: false, error: "Coords manquantes" });
            return;
          }
          const store = await markAttacked(message.coords, { source: message.source ?? "click" });
          safeSend({ ok: true, coords: message.coords, store });
          return;
        }
        case "BATCH_MARK_ATTACKED": {
          const coords = Array.isArray(message.coords) ? message.coords : [];
          if (!coords.length) {
            safeSend({ ok: false, error: "Liste de coords vide" });
            return;
          }
          const current = await getAttacksStore();
          const beforeToday = countAttacksToday(current);
          const store = recordAttacksBatch(current, coords, {
            source: message.source ?? "batch",
          });
          await saveAttacksStore(store);
          const merged = await consolidateAttacksStorage();
          safeSend({
            ok: true,
            added: countAttacksToday(merged) - beforeToday,
            today: countAttacksToday(merged),
            store: merged,
          });
          return;
        }
        case "GET_ATTACKS_SUMMARY": {
          const store = await getAttacksStore();
          safeSend({
            today: countAttacksToday(store),
            total: countAllAttacks(store),
            store,
          });
          return;
        }
        case "CLEAR_ATTACKS": {
          const empty = emptyAttacksStore();
          await saveAttacksStore(empty);
          safeSend(empty);
          return;
        }
        default:
          safeSend({ ok: false, error: `Message inconnu: ${message.type}` });
      }
    } catch (error) {
      safeSend({ ok: false, error: error.message });
    }
  })();

  return true;
});

chrome.runtime.onInstalled.addListener(async () => {
  const store = await getStore();
  if (store.meta.systemsStored > 0) {
    await chrome.action.setBadgeText({ text: String(store.meta.systemsStored) });
  }
  await consolidateAttacksStorage();
});

chrome.runtime.onStartup.addListener(() => {
  consolidateAttacksStorage().catch(() => {});
});
