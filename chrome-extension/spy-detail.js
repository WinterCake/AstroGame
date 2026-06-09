function getNonZeroSpyItems(categoryData, mode = "amount") {
  if (!categoryData) return [];

  return Object.entries(categoryData)
    .filter(([, value]) => Number(value) > 0)
    .sort(([leftId], [rightId]) => Number(leftId) - Number(rightId))
    .map(([id, value]) => {
      const amount = Number(value);
      let display = String(amount);

      if (mode === "amount" || mode === "count") {
        display = formatCompactNumber(amount);
      }

      return {
        id,
        name: SPY_ELEMENT_LABELS[id] ?? `Élément ${id}`,
        value: amount,
        display,
      };
    });
}

function buildSpyDetailSections(report) {
  if (!report?.spyData) return null;

  return SPY_DETAIL_SECTIONS.map((section) => ({
    title: section.title,
    total: section.total(report),
    items: getNonZeroSpyItems(report.spyData[section.key], section.mode),
  }));
}

function renderSpyDetailHtml(report) {
  if (!report) {
    return '<p class="detail-empty">Sélectionne un rapport dans la liste.</p>';
  }

  if (!report.spyData) {
    return `<p class="detail-empty">Détail indisponible pour ce rapport.<br>Clique <strong>Charger</strong> pour récupérer les données complètes.</p>`;
  }

  const sections = buildSpyDetailSections(report);

  const header = `
    <header class="detail-header">
      <h2>${escapeSpyHtml(report.planetName)} <span class="coords">[${escapeSpyHtml(report.coords)}]</span></h2>
      <p class="detail-meta">
        <strong>${escapeSpyHtml(report.username)}</strong>
        · ${escapeSpyHtml(report.dateText ?? formatReportDate(report))}
        · <span class="${verdictClass(report.verdict)}">${escapeSpyHtml(report.verdict)}</span>
        ${report.attackedToday ? ` · ${renderAttackBadge(true)}` : ""}
      </p>
      <p class="detail-chances">
        Destruction ${report.targetChance ?? "?"}% · Espionnage ${report.spyChance ?? "?"}%
      </p>
    </header>
  `;

  const body = sections
    .map((section) => {
      const itemsHtml = section.items.length
        ? section.items
            .map(
              (item) => `
            <li>
              <span class="detail-name">${escapeSpyHtml(item.name)}</span>
              <span class="detail-value">${escapeSpyHtml(item.display)}</span>
            </li>`
            )
            .join("")
        : `<li class="detail-none"><span class="detail-name">—</span><span class="detail-value">Rien</span></li>`;

      return `
      <section class="detail-section">
        <div class="detail-section-head">
          <h3>${escapeSpyHtml(section.title)}</h3>
          <span class="detail-total">Total ${escapeSpyHtml(section.total)}</span>
        </div>
        <ul class="detail-list">${itemsHtml}</ul>
      </section>`;
    })
    .join("");

  return `${header}<div class="detail-sections">${body}</div>`;
}

function escapeSpyHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function openSpyPanel(messageId, filter = "all") {
  const params = new URLSearchParams();
  if (messageId) params.set("id", messageId);
  if (filter && filter !== "all") params.set("filter", filter);
  const query = params.toString();
  const url = chrome.runtime.getURL(`spy-panel.html${query ? `?${query}` : ""}`);
  chrome.tabs.create({ url });
}
