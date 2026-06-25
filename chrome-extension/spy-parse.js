const SPY_CATEGORY = 0;

function sumCategoryValues(category) {
  if (!category) return 0;
  return Object.values(category).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

/** Missiles en silo — ne comptent pas comme défense pour le filtre « sans défense ». */
const MISSILE_ONLY_DEFENSE_IDS = new Set(["502", "503"]);

function sumDefenseExcludingMissiles(category) {
  if (!category) return 0;
  return Object.entries(category).reduce((sum, [id, value]) => {
    if (MISSILE_ONLY_DEFENSE_IDS.has(id)) return sum;
    return sum + (Number(value) || 0);
  }, 0);
}

function getEffectiveDefense(report) {
  if (report.spyData?.["400"]) {
    return sumDefenseExcludingMissiles(report.spyData["400"]);
  }
  return Number(report.defense) || 0;
}

function sumResources(category) {
  if (!category) return 0;
  return (Number(category?.["901"]) || 0) + (Number(category?.["902"]) || 0) + (Number(category?.["903"]) || 0);
}

function formatCompactNumber(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Md`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} K`;
  return String(Math.round(n));
}

function buildVerdict(fleetTotal, defenseTotal, lootTotal) {
  if (fleetTotal > 0) return "Flotte présente";
  if (defenseTotal > 50_000) return "Défense lourde";
  if (defenseTotal > 0) return "Défense légère";
  if (lootTotal >= 500_000_000) return "Gros butin";
  if (lootTotal > 0) return "Cible intéressante";
  return "Peu de ressources";
}

function decodeSpyPayload(encoded) {
  return JSON.parse(atob(encoded));
}

function summarizeSpyPayload(payload, meta = {}) {
  const planet = payload.targetPlanet ?? {};
  const coords = `${planet.galaxy}:${planet.system}:${planet.planet}`;
  const loot = sumResources(payload.spyData?.["900"]);
  const fleet = sumCategoryValues(payload.spyData?.["200"]);
  const defense = sumDefenseExcludingMissiles(payload.spyData?.["400"]);
  const buildings = payload.spyData?.["0"] ?? {};

  return {
    messageId: meta.messageId ?? null,
    dateText: meta.dateText ?? null,
    timestamp: payload.time ?? meta.timestamp ?? null,
    coords,
    galaxy: planet.galaxy,
    system: planet.system,
    position: planet.planet,
    planetId: planet.id,
    planetName: planet.name,
    username: payload.targetUsername,
    loot,
    lootFormatted: formatCompactNumber(loot),
    fleet,
    fleetFormatted: formatCompactNumber(fleet),
    defense,
    defenseFormatted: formatCompactNumber(defense),
    metalMine: Number(buildings["1"]) || 0,
    crystalMine: Number(buildings["2"]) || 0,
    deutMine: Number(buildings["3"]) || 0,
    targetChance: payload.targetChance ?? null,
    spyChance: payload.spyChance ?? null,
    verdict: buildVerdict(fleet, defense, loot),
    spyData: payload.spyData ?? null,
  };
}

function parseSpyReportsHtml(html) {
  const reports = [];
  const rowRegex =
    /<tr[^>]*class="[^"]*messages_body[^"]*"[^>]*data-message-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>|<tr[^>]*data-message-id="(\d+)"[^>]*class="[^"]*messages_body[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;

  for (const match of html.matchAll(rowRegex)) {
    const messageId = match[1] || match[3];
    const rowHtml = match[2] || match[4];
    const dataMatch = rowHtml.match(/ASTRO_SPY_REPORT_DATA:([A-Za-z0-9+/=]+)/);
    if (!dataMatch) continue;

    const payload = decodeSpyPayload(dataMatch[1]);
    let dateText = null;
    const before = html.slice(0, match.index);
    const headBlocks = [...before.matchAll(/<tr[^>]*class="message_head"[^>]*>([\s\S]*?)<\/tr>/gi)];
    if (headBlocks.length) {
      const cells = [...headBlocks[headBlocks.length - 1][1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (cells[1]) {
        dateText = cells[1][1].replace(/<[^>]+>/g, "").trim() || null;
      }
    }

    reports.push(
      summarizeSpyPayload(payload, {
        messageId,
        dateText,
        timestamp: payload.time,
      })
    );
  }

  return reports;
}

function detectMaxSpyPage(html) {
  const pages = [...html.matchAll(/Message\.getMessages\(\s*0\s*,\s*(\d+)\s*\)/g)].map((match) =>
    Number(match[1])
  );
  return pages.length ? Math.max(...pages) : 1;
}

function isNewerSpyReport(candidate, current) {
  const candidateTs = Number(candidate.timestamp) || 0;
  const currentTs = Number(current.timestamp) || 0;
  if (candidateTs !== currentTs) return candidateTs > currentTs;

  const candidateDetail = Boolean(candidate.spyData);
  const currentDetail = Boolean(current.spyData);
  if (candidateDetail !== currentDetail) return candidateDetail;

  return Number(candidate.messageId) > Number(current.messageId);
}

function dedupeSpyReportsByCoords(reports) {
  const byCoords = new Map();
  const withoutCoords = [];

  for (const report of reports) {
    if (!report.coords) {
      withoutCoords.push(report);
      continue;
    }

    const existing = byCoords.get(report.coords);
    if (!existing || isNewerSpyReport(report, existing)) {
      byCoords.set(report.coords, report);
    }
  }

  return [...byCoords.values(), ...withoutCoords].sort(
    (a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)
  );
}

function mergeSpyReports(existing, incoming) {
  const byId = new Map();

  for (const report of existing) {
    if (report.messageId) byId.set(String(report.messageId), report);
  }

  for (const report of incoming) {
    if (!report.messageId) continue;
    const key = String(report.messageId);
    const previous = byId.get(key);
    if (previous && !report.spyData && previous.spyData) {
      byId.set(key, { ...report, spyData: previous.spyData });
    } else {
      byId.set(key, report);
    }
  }

  return dedupeSpyReportsByCoords([...byId.values()]);
}

function isSansDefense(report) {
  return (Number(report.fleet) || 0) === 0 && getEffectiveDefense(report) === 0;
}

function isGrosButinSansDefense(report) {
  return isSansDefense(report) && (Number(report.loot) || 0) >= 500_000_000;
}

function filterSpyReports(reports, filter) {
  switch (filter) {
    case "gros-butin":
      return reports.filter((report) => report.verdict === "Gros butin");
    case "sans-defense":
      return reports.filter(isSansDefense);
    case "gros-butin-sans-defense":
      return reports.filter(isGrosButinSansDefense);
    case "today":
      return reports.filter(isReportToday);
    case "today-gros":
      return reports.filter((report) => report.verdict === "Gros butin" && isReportToday(report));
    case "today-sans-defense":
      return reports.filter((report) => isSansDefense(report) && isReportToday(report));
    case "today-gros-sans-defense":
      return reports.filter((report) => isGrosButinSansDefense(report) && isReportToday(report));
    default:
      return reports;
  }
}

function buildSpyPayload(reports, meta = {}) {
  const grosButin = reports.filter((report) => report.verdict === "Gros butin").length;
  const cibles = reports.filter((report) => report.verdict === "Cible intéressante").length;
  const sansDefense = reports.filter(isSansDefense).length;

  return {
    meta: {
      source: "chrome-extension",
      scrapedAt: new Date().toISOString(),
      totalReports: reports.length,
      grosButin,
      sansDefense,
      cibles,
      sortedBy: "date-desc",
      ...meta,
    },
    reports,
  };
}

function formatReportDate(report) {
  if (report.timestamp) {
    const date = new Date(report.timestamp * 1000);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${day}/${month} ${hours}:${minutes}`;
  }
  return report.dateText ?? "?";
}

function isReportToday(report) {
  if (!report.timestamp) return false;
  const date = new Date(report.timestamp * 1000);
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function verdictClass(verdict) {
  switch (verdict) {
    case "Gros butin":
      return "verdict-loot";
    case "Cible intéressante":
      return "verdict-target";
    case "Flotte présente":
      return "verdict-fleet";
    case "Défense lourde":
      return "verdict-heavy";
    case "Défense légère":
      return "verdict-light";
    default:
      return "verdict-muted";
  }
}
