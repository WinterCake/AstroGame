const panelMetaEl = document.getElementById("panelMeta");
const panelFilterEl = document.getElementById("panelFilter");
const panelRefreshBtn = document.getElementById("panelRefresh");
const panelTableBody = document.getElementById("panelTableBody");
const detailPane = document.getElementById("detailPane");
const panelStatusEl = document.getElementById("panelStatus");
const debugLogEl = document.getElementById("debugLog");

let spyData = { meta: {}, reports: [] };
let attacksStore = normalizeAttacksStore(null);
let selectedId = null;
let sortState = { ...SPY_DEFAULT_SORT };
const panelSortHead = document.querySelector(".list-pane .spy-table thead");

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response ?? {});
    });
  });
}

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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getUrlParams() {
  const params = new URLSearchParams(location.search);
  return {
    id: params.get("id"),
    filter: params.get("filter") || "all",
  };
}

function findReport(messageId) {
  return spyData.reports?.find((report) => String(report.messageId) === String(messageId)) ?? null;
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
  const report = selectedId ? findReport(selectedId) : null;
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

  if (!reports.length) {
    panelTableBody.innerHTML =
      '<tr><td colspan="10" class="detail-empty">Aucun rapport pour ce filtre.</td></tr>';
    return;
  }

  panelTableBody.innerHTML = reports
    .map((report) => {
      const id = String(report.messageId ?? "");
      const selected = id === selectedId ? " selected" : "";
      const attacked = isCoordAttackedToday(report.coords, attacksStore);
      return `<tr data-id="${escapeHtml(id)}" class="${selected.trim()}${attacked ? " row-attacked" : ""}">
        <td><button type="button" class="detail-btn${id === selectedId ? " active" : ""}" data-id="${escapeHtml(id)}">Détail</button></td>
        <td>${escapeHtml(formatReportDate(report))}</td>
        <td>${escapeHtml(report.coords)}</td>
        <td>${attacked ? renderAttackBadge(true) : ""}</td>
        <td>${escapeHtml(report.username)}</td>
        <td>${escapeHtml(report.planetName)}</td>
        <td class="num">${escapeHtml(report.lootFormatted)}</td>
        <td class="num">${escapeHtml(report.fleetFormatted)}</td>
        <td class="num">${escapeHtml(report.defenseFormatted)}</td>
        <td class="${verdictClass(report.verdict)}">${escapeHtml(report.verdict)}</td>
      </tr>`;
    })
    .join("");

  panelTableBody.querySelectorAll(".detail-btn").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      selectReport(button.dataset.id);
    });
  });

  panelTableBody.querySelectorAll("tr[data-id]").forEach((row) => {
    row.addEventListener("click", () => selectReport(row.dataset.id));
  });
}

function renderMeta() {
  const meta = spyData.meta ?? {};
  const total = meta.totalReports ?? spyData.reports?.length ?? 0;
  const withDetail =
    meta.withDetail ?? spyData.reports?.filter((report) => report.spyData).length ?? 0;
  const attackedToday = countAttacksToday(attacksStore);
  const attackedTotal = countAllAttacks(attacksStore);
  panelMetaEl.textContent = `${total} rapport(s) · ${withDetail} avec détail · ${meta.grosButin ?? 0} gros butin · ${attackedToday} attaqué(s) aujourd'hui · ${attackedTotal} attaque(s) enregistrée(s)`;
}

async function loadAttacks() {
  attacksStore = normalizeAttacksStore(await sendMessage({ type: "GET_ATTACKS" }));
}

async function loadData() {
  await loadAttacks();
  const data = await sendMessage({ type: "GET_SPY_DATA" });
  spyData = data ?? { meta: {}, reports: [] };
  renderMeta();
  renderTable();

  if (selectedId && findReport(selectedId)) {
    selectReport(selectedId);
  } else if (selectedId) {
    renderDetail(null);
    setStatus("Rapport introuvable dans le cache — recharge les données.", true);
  }
}

panelFilterEl.addEventListener("change", () => {
  renderTable();
  if (selectedId && !findReport(selectedId)) {
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

  await loadData();

  if (selectedId && findReport(selectedId)) {
    selectReport(selectedId);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.attacksHistory) return;
  attacksStore = normalizeAttacksStore(changes.attacksHistory.newValue);
  renderMeta();
  renderTable();
  if (selectedId && findReport(selectedId)) {
    selectReport(selectedId);
  }
});

init();
