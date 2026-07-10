const panelMetaEl = document.getElementById("panelMeta");
const panelFilterEl = document.getElementById("panelFilter");
const panelRefreshBtn = document.getElementById("panelRefresh");
const panelTableBody = document.getElementById("panelTableBody");
const detailPane = document.getElementById("detailPane");
const panelStatusEl = document.getElementById("panelStatus");
const debugLogEl = document.getElementById("debugLog");

const { sendMessage, findSpyReport, renderSpyTableBody, loadAttacksStore, syncBundledAttacks, buildSpyMetaLine } =
  AstroSpyUI;

let spyData = { meta: {}, reports: [] };
let attacksStore = normalizeAttacksStore(null);
let selectedId = null;
let sortState = { ...SPY_DEFAULT_SORT };
const panelSortHead = document.querySelector(".list-pane .spy-table thead");

function setStatus(text, isError = false, logs = null) {
  panelStatusEl.textContent = text;
  panelStatusEl.classList.toggle("error", isError);

  if (logs?.length) {
    debugLogEl.hidden = false;
    debugLogEl.textContent = logs.join("\n");
    console.log("[astro-spy]", logs.join("\n"));
  } else if (!isError) {
    debugLogEl.hidden = true;
    debugLogEl.textContent = "";
  }
}

function getUrlParams() {
  const params = new URLSearchParams(location.search);
  return {
    id: params.get("id"),
    filter: params.get("filter") || "all",
  };
}

function renderDetail(report) {
  if (!report) {
    detailPane.innerHTML = renderSpyDetailHtml(null);
    return;
  }

  detailPane.innerHTML = renderSpyDetailHtml({
    ...report,
    attackedToday: isCoordAttackedToday(report.coords, attacksStore),
  });
}

function selectReport(messageId) {
  selectedId = messageId ? String(messageId) : null;
  const report = selectedId ? findSpyReport(spyData.reports, selectedId) : null;
  renderDetail(report);

  panelTableBody.querySelectorAll("tr[data-id]").forEach((row) => {
    const isSelected = row.dataset.id === selectedId;
    row.classList.toggle("selected", isSelected);
    row.querySelector(".detail-btn")?.classList.toggle("active", isSelected);
  });
}

function renderTable() {
  const reports = sortSpyReports(
    filterSpyReports(spyData.reports ?? [], panelFilterEl.value),
    sortState.key,
    sortState.dir,
    attacksStore
  );
  updateSpySortHeaders(panelSortHead, sortState);

  renderSpyTableBody(
    panelTableBody,
    reports,
    {
      attacksStore,
      selectedId,
      variant: "panel",
      emptyColspan: 10,
      emptyText: "Aucun rapport pour ce filtre.",
    },
    selectReport
  );
}

function renderMeta() {
  panelMetaEl.textContent = buildSpyMetaLine(spyData.meta ?? {}, spyData.reports, attacksStore);
}

async function loadAttacks() {
  attacksStore = await loadAttacksStore();
}

async function loadData() {
  await loadAttacks();
  const data = await sendMessage({ type: "GET_SPY_DATA" });
  spyData = data ?? { meta: {}, reports: [] };
  renderMeta();
  renderTable();

  if (selectedId && findSpyReport(spyData.reports, selectedId)) {
    selectReport(selectedId);
  } else if (selectedId) {
    renderDetail(null);
    setStatus("Rapport introuvable dans le cache — recharge les données.", true);
  }
}

panelFilterEl.addEventListener("change", () => {
  renderTable();
  if (selectedId && !findSpyReport(spyData.reports, selectedId)) {
    renderDetail(null);
  } else if (selectedId) {
    selectReport(selectedId);
  }
});

panelRefreshBtn.addEventListener("click", async () => {
  panelRefreshBtn.disabled = true;
  setStatus("Chargement des rapports…");

  const { universe } = await sendMessage({ type: "GET_UNIVERSE" });
  const result = await sendMessage({ type: "SCRAPE_SPY", universe });

  panelRefreshBtn.disabled = false;

  if (!result.ok) {
    setStatus(result.error ?? "Échec du chargement", true, result.logs);
    return;
  }

  const detailMsg =
    result.withDetail === 0
      ? " ⚠ Aucun détail — connecte-toi sur Astrogame et recharge l'onglet (F5)"
      : "";
  setStatus(
    `${result.total} rapport(s), ${result.withDetail ?? "?"} avec détail (ressources/flotte/défense)${detailMsg}`,
    result.withDetail === 0,
    result.logs
  );
  await loadData();
});

bindSpySortHeaders(
  panelSortHead,
  () => sortState,
  (next) => {
    sortState = next;
  },
  () => renderTable()
);

async function init() {
  const params = getUrlParams();
  panelFilterEl.value = params.filter;
  selectedId = params.id;
  updateSpySortHeaders(panelSortHead, sortState);

  const synced = await syncBundledAttacks();
  if (synced) attacksStore = synced;
  await loadData();

  if (selectedId && findSpyReport(spyData.reports, selectedId)) {
    selectReport(selectedId);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || (!changes.attacksHistory && !changes.attacksToday)) return;
  loadAttacks().then(() => {
    renderMeta();
    renderTable();
    if (selectedId && findSpyReport(spyData.reports, selectedId)) {
      selectReport(selectedId);
    }
  });
});

init();
