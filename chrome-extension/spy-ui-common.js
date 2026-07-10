var AstroSpyUI = (function () {
  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response ?? {});
        });
      } catch (error) {
        resolve({ ok: false, error: error.message });
      }
    });
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

  function findSpyReport(reports, messageId) {
    return reports?.find((report) => String(report.messageId) === String(messageId)) ?? null;
  }

  function buildSpyTableRow(report, { attacksStore, selectedId, variant }) {
    const messageId = report.messageId ? String(report.messageId) : "";
    const attacked = isCoordAttackedToday(report.coords, attacksStore);
    const selected = messageId && messageId === selectedId;
    const rowClass = `${attacked ? "row-attacked" : ""}${selected ? " selected" : ""}`.trim();

    if (variant === "panel") {
      return `<tr data-id="${escapeHtml(messageId)}" class="${rowClass}">
        <td><button type="button" class="detail-btn${selected ? " active" : ""}" data-id="${escapeHtml(messageId)}">Détail</button></td>
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
    }

    const mines = `M${report.metalMine}/C${report.crystalMine}/D${report.deutMine}`;
    const title = `${report.planetName} — ${mines} — Destr. ${report.targetChance ?? "?"}% — Espion. ${report.spyChance ?? "?"}%`;
    return `<tr title="${escapeHtml(title)}" class="${rowClass}">
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
  }

  function renderSpyTableBody(tableBody, reports, { attacksStore, selectedId, variant, emptyColspan, emptyText }, onSelect) {
    if (!reports.length) {
      tableBody.innerHTML = `<tr class="empty"><td colspan="${emptyColspan}">${emptyText}</td></tr>`;
      return;
    }

    tableBody.innerHTML = reports
      .map((report) => buildSpyTableRow(report, { attacksStore, selectedId, variant }))
      .join("");

    tableBody.querySelectorAll(".detail-btn").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelect(button.dataset.id);
      });
    });

    if (variant === "panel") {
      tableBody.querySelectorAll("tr[data-id]").forEach((row) => {
        row.addEventListener("click", () => onSelect(row.dataset.id));
      });
    }
  }

  async function loadAttacksStore() {
    const response = await sendMessage({ type: "GET_ATTACKS_SUMMARY" });
    return normalizeAttacksStore(response?.store);
  }

  async function syncBundledAttacks() {
    try {
      const response = await fetch(chrome.runtime.getURL("attacks-import.json"));
      if (!response.ok) return null;

      const payload = await response.json();
      const coords = (payload.attacks ?? [])
        .map((entry) => (typeof entry === "string" ? entry : entry?.coords))
        .filter(Boolean);
      if (!coords.length) return null;

      const summary = await sendMessage({ type: "GET_ATTACKS_SUMMARY" });
      const todayCoords = new Set(
        getAttacksForDay(normalizeAttacksStore(summary?.store)).map((entry) => entry.coords)
      );
      const missing = coords.filter((coord) => !todayCoords.has(coord));
      if (!missing.length) return null;

      const result = await sendMessage({
        type: "BATCH_MARK_ATTACKED",
        coords: missing,
        source: payload.meta?.source ?? "attack-loot",
      });
      return result?.store ? normalizeAttacksStore(result.store) : null;
    } catch {
      return null;
    }
  }

  function buildSpyMetaLine(meta, reports, attacksStore) {
    const total = meta.totalReports ?? reports?.length ?? 0;
    const withDetail = meta.withDetail ?? reports?.filter((report) => report.spyData).length ?? 0;
    return `${total} rapport(s) · ${withDetail} avec détail · ${meta.grosButin ?? 0} gros butin · ${countAttacksToday(attacksStore)} attaqué(s) aujourd'hui · ${countAllAttacks(attacksStore)} attaque(s) enregistrée(s)`;
  }

  return {
    sendMessage,
    escapeHtml,
    truncateText,
    formatDateTime,
    downloadJson,
    findSpyReport,
    buildSpyTableRow,
    renderSpyTableBody,
    loadAttacksStore,
    syncBundledAttacks,
    buildSpyMetaLine,
  };
})();
