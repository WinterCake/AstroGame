const systemsEl = document.getElementById("systems");
const planetsEl = document.getElementById("planets");
const playersEl = document.getElementById("players");
const inactiveEl = document.getElementById("inactive");
const lastEl = document.getElementById("last");
const captureEl = document.getElementById("capture");
const inactiveOnlyEl = document.getElementById("inactiveOnly");
const exportBtn = document.getElementById("export");
const clearBtn = document.getElementById("clear");

const spyTotalEl = document.getElementById("spyTotal");
const spyGrosEl = document.getElementById("spyGros");
const spySansDefenseEl = document.getElementById("spySansDefense");
const spyCiblesEl = document.getElementById("spyCibles");
const spyLastEl = document.getElementById("spyLast");
const spyFilterEl = document.getElementById("spyFilter");
const spyCaptureEl = document.getElementById("spyCapture");
const spyTableBody = document.getElementById("spyTableBody");
const spyStatusEl = document.getElementById("spyStatus");
const spyRefreshBtn = document.getElementById("spyRefresh");
const spyExportBtn = document.getElementById("spyExport");
const spyExportAttacksBtn = document.getElementById("spyExportAttacks");
const spyClearBtn = document.getElementById("spyClear");
const spyOpenPanelBtn = document.getElementById("spyOpenPanel");
const spyDetailBox = document.getElementById("spyDetailBox");

const tabButtons = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");

let spyData = { meta: {}, reports: [] };
let attacksStore = normalizeAttacksStore(null);
let selectedReportId = null;
let sortState = { ...SPY_DEFAULT_SORT };
const popupSortHead = document.querySelector("#panel-spy .spy-table thead");

function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}

function setSpyStatus(text, isError = false, logs = null) {
  spyStatusEl.textContent = text;
  spyStatusEl.classList.toggle("error", isError);
  if (logs?.length) console.log("[astro-spy]", logs.join("\n"));
}

function renderGalaxy(data) {
  const meta = data?.meta ?? {};
  systemsEl.textContent = meta.systemsStored ?? 0;
  planetsEl.textContent = meta.planetEntries ?? 0;
  playersEl.textContent = meta.uniquePlayers ?? 0;
  inactiveEl.textContent = meta.attackableInactivePlanets ?? meta.inactivePlanets ?? 0;
  lastEl.textContent = meta.lastScanned
    ? `Dernier scan : ${meta.lastScanned}`
    : "Dernier scan : —";
}

function findSpyReport(messageId) {
  return spyData.reports?.find((report) => String(report.messageId) === String(messageId)) ?? null;
}

function showInlineDetail(messageId) {
  selectedReportId = messageId ? String(messageId) : null;
  const report = selectedReportId ? findSpyReport(selectedReportId) : null;

  if (!report) {
    spyDetailBox.hidden = false;
    spyDetailBox.innerHTML = '<p class="detail-empty">Rapport introuvable.</p>';
    document.body.classList.add("spy-detail-open");
    renderSpyTable(spyData.reports ?? []);
    return;
  }

  spyDetailBox.hidden = false;
  document.body.classList.add("spy-detail-open");
  spyDetailBox.innerHTML = renderSpyDetailHtml({
    ...report,
    attackedToday: isCoordAttackedToday(report.coords, attacksStore),
  });

  if (!report.spyData) {
    setSpyStatus("Pas de détail — clique Charger (onglet Astrogame ouvert + F5)", true);
  }

  renderSpyTable(spyData.reports ?? []);
  spyDetailBox.scrollIntoView({ block: "nearest" });
}

function renderSpyTable(reports) {
  const filtered = sortSpyReports(
    filterSpyReports(reports, spyFilterEl.value),
    sortState.key,
    sortState.dir,
    attacksStore
  );
  updateSpySortHeaders(popupSortHead, sortState);

  if (!filtered.length) {
    spyTableBody.innerHTML =
      '<tr class="empty"><td colspan="9">Aucun rapport pour ce filtre.</td></tr>';
    return;
  }

  spyTableBody.innerHTML = filtered
    .map((report) => {
      const mines = `M${report.metalMine}/C${report.crystalMine}/D${report.deutMine}`;
      const title = `${report.planetName} — ${mines} — Destr. ${report.targetChance ?? "?"}% — Espion. ${report.spyChance ?? "?"}%`;
      const messageId = report.messageId ? String(report.messageId) : "";
      const attacked = isCoordAttackedToday(report.coords, attacksStore);
      const selected = messageId && messageId === selectedReportId ? " selected" : "";
      return `<tr title="${escapeHtml(title)}" class="${attacked ? "row-attacked" : ""}${selected}">
        <td>${messageId ? `<button type="button" class="detail-btn${selected ? " active" : ""}" data-id="${escapeHtml(messageId)}">▶</button>` : ""}</td>
        <td>${escapeHtml(formatReportDate(report))}</td>
        <td>${escapeHtml(report.coords)}</td>
        <td>${attacked ? renderAttackBadge(true) : ""}</td>
        <td>${escapeHtml(truncateText(report.username, 14))}</td>
        <td class="num">${escapeHtml(report.lootFormatted)}</td>
        <td class="num">${escapeHtml(report.fleetFormatted)}</td>
        <td class="num">${escapeHtml(report.defenseFormatted)}</td>
        <td class="${verdictClass(report.verdict)}">${escapeHtml(report.verdict)}</td>
      </tr>`;
    })
    .join("");

  spyTableBody.querySelectorAll(".detail-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      showInlineDetail(button.dataset.id);
    });
  });
}

function renderSpy(data) {
  spyData = data ?? { meta: {}, reports: [] };
  const meta = spyData.meta ?? {};
  const reports = spyData.reports ?? [];

  spyTotalEl.textContent = meta.totalReports ?? reports.length;
  spyGrosEl.textContent = meta.grosButin ?? reports.filter((r) => r.verdict === "Gros butin").length;
  spySansDefenseEl.textContent = meta.sansDefense ?? reports.filter(isSansDefense).length;
  spyCiblesEl.textContent =
    meta.cibles ?? reports.filter((r) => r.verdict === "Cible intéressante").length;

  const last = meta.lastScrape || meta.lastCapture || meta.scrapedAt;
  spyLastEl.textContent = last ? `Dernier chargement : ${formatDateTime(last)}` : "Dernier chargement : —";

  renderSpyTable(reports);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncateText(text, maxLength) {
  const value = String(text ?? "");
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1)}…`;
}

function formatDateTime(iso) {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function downloadJson(data, prefix) {
  const filename = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function switchTab(tabName) {
  document.body.classList.toggle("spy-mode", tabName === "spy");
  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName);
  });
  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tabName}`);
  });
}

async function refreshGalaxy() {
  const [data, settings] = await Promise.all([
    sendMessage({ type: "GET_DATA" }),
    sendMessage({ type: "GET_SETTINGS" }),
  ]);
  renderGalaxy(data ?? { meta: {} });
  if (settings) {
    captureEl.checked = settings.captureEnabled !== false;
    spyCaptureEl.checked = settings.spyCaptureEnabled !== false;
  }
}

async function loadAttacks() {
  attacksStore = normalizeAttacksStore(await sendMessage({ type: "GET_ATTACKS" }));
}

async function refreshSpy() {
  await loadAttacks();
  const data = await sendMessage({ type: "GET_SPY_DATA" });
  renderSpy(data ?? { meta: {}, reports: [] });
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tab);
    if (button.dataset.tab === "spy") {
      refreshSpy();
    }
  });
});

captureEl.addEventListener("change", async () => {
  await sendMessage({ type: "SET_CAPTURE", enabled: captureEl.checked });
});

spyCaptureEl.addEventListener("change", async () => {
  await sendMessage({ type: "SET_SPY_CAPTURE", enabled: spyCaptureEl.checked });
});

spyFilterEl.addEventListener("change", () => {
  selectedReportId = null;
  spyDetailBox.hidden = true;
  document.body.classList.remove("spy-detail-open");
  renderSpyTable(spyData.reports ?? []);
});

function filterExportData(data) {
  if (!inactiveOnlyEl.checked) return data;

  const entries = data.entries.filter((entry) => entry.isAttackableInactive);
  const playerIds = new Set(entries.map((entry) => entry.playerId));
  return {
    ...data,
    meta: {
      ...data.meta,
      exportedAt: new Date().toISOString(),
      exportFilter: "inactive-only",
      planetEntries: entries.length,
      uniquePlayers: playerIds.size,
    },
    entries,
    players: data.players.filter((player) => playerIds.has(player.playerId)),
  };
}

exportBtn.addEventListener("click", async () => {
  const data = filterExportData((await sendMessage({ type: "GET_DATA" })) ?? { entries: [], players: [] });
  if (!data.entries?.length) {
    exportBtn.textContent = inactiveOnlyEl.checked ? "Aucun inactif" : "Aucune donnée";
    setTimeout(() => {
      exportBtn.textContent = "Exporter JSON";
    }, 1500);
    return;
  }
  downloadJson(data, "galaxy");
});

clearBtn.addEventListener("click", async () => {
  if (!confirm("Effacer toutes les données galaxie ?")) return;
  const data = await sendMessage({ type: "CLEAR_DATA" });
  renderGalaxy(data ?? { meta: {} });
});

spyRefreshBtn.addEventListener("click", async () => {
  spyRefreshBtn.disabled = true;
  spyRefreshBtn.textContent = "Chargement…";
  setSpyStatus("Récupération des rapports (toutes les pages)…");

  const { universe } = (await sendMessage({ type: "GET_UNIVERSE" })) ?? {};
  const result = await sendMessage({ type: "SCRAPE_SPY", universe });

  spyRefreshBtn.disabled = false;
  spyRefreshBtn.textContent = "Charger";

  if (!result?.ok) {
    setSpyStatus(result?.error ?? "Échec du chargement", true, result?.logs);
    return;
  }

  const warn = result.withDetail === 0 ? " — ouvre Astrogame connecté + F5" : "";
  setSpyStatus(
    `${result.total} rapports, ${result.withDetail ?? "?"} avec détail${warn}`,
    result.withDetail === 0,
    result.logs
  );
  await refreshSpy();
});

spyExportBtn.addEventListener("click", () => {
  const filtered = filterSpyReports(spyData.reports ?? [], spyFilterEl.value);
  if (!filtered.length) {
    setSpyStatus("Rien à exporter pour ce filtre.", true);
    return;
  }

  downloadJson(
    {
      meta: {
        ...spyData.meta,
        exportedAt: new Date().toISOString(),
        exportFilter: spyFilterEl.value,
        totalReports: filtered.length,
      },
      reports: filtered,
    },
    "spy-reports"
  );
  setSpyStatus(`${filtered.length} rapport(s) exporté(s).`);
});

spyExportAttacksBtn.addEventListener("click", async () => {
  const store = normalizeAttacksStore(await sendMessage({ type: "GET_ATTACKS" }));
  const attacks = store.attacks ?? [];
  if (!attacks.length) {
    setSpyStatus("Aucune attaque enregistrée.", true);
    return;
  }

  downloadJson(
    {
      meta: {
        exportedAt: new Date().toISOString(),
        total: attacks.length,
        today: countAttacksToday(store),
      },
      attacks,
    },
    "attacks-history"
  );
  setSpyStatus(`${attacks.length} attaque(s) exportée(s).`);
});

spyOpenPanelBtn.addEventListener("click", () => {
  openSpyPanel(null, spyFilterEl.value);
});

spyClearBtn.addEventListener("click", async () => {
  if (!confirm("Effacer tous les rapports d’espionnage en cache ?")) return;
  const data = await sendMessage({ type: "CLEAR_SPY" });
  renderSpy(data ?? { meta: {}, reports: [] });
  setSpyStatus("");
});

bindSpySortHeaders(
  popupSortHead,
  () => sortState,
  (next) => {
    sortState = next;
  },
  () => renderSpyTable(spyData.reports ?? [])
);

async function initPopup() {
  try {
    if (typeof filterSpyReports !== "function") {
      throw new Error("Scripts espionnage non chargés — recharge l'extension (v1.4.0)");
    }
    updateSpySortHeaders(popupSortHead, sortState);
    await refreshGalaxy();
  } catch (error) {
    setSpyStatus(error.message, true);
    console.error("[astro-popup]", error);
  }
}

initPopup();
