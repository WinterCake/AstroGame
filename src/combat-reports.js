import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getClient } from "./client.js";
import { getCredentials } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("combat");
export const COMBAT_CATEGORY = 100;

const MONTHS_FR = {
  janvier: 0,
  fevrier: 1,
  février: 1,
  mars: 2,
  avril: 3,
  mai: 4,
  juin: 5,
  juillet: 6,
  aout: 7,
  août: 7,
  septembre: 8,
  octobre: 9,
  novembre: 10,
  decembre: 11,
  décembre: 11,
};

function stripHtml(text) {
  return String(text ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatCompactNumber(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Md`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} K`;
  return String(Math.round(n));
}

export function parseGameAmount(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return 0;

  const fromTitle = value.match(/title="([^"]+)"/i)?.[1];
  const text = fromTitle ?? value;
  const cleaned = text.replace(/\s/g, "").replace(/&nbsp;/g, "");

  if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    return Number(cleaned.replace(/\./g, ""));
  }

  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function parseFrenchDateText(dateText) {
  const match = String(dateText ?? "").match(
    /(\d{1,2})\.\s*([A-Za-zÀ-ÿ]+)\s*(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/
  );
  if (!match) return null;

  const month = MONTHS_FR[match[2].toLowerCase()];
  if (month === undefined) return null;

  const date = new Date(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  );
  return Math.floor(date.getTime() / 1000);
}

export function isReportToday(report) {
  if (!report.timestamp) return false;
  const date = new Date(report.timestamp * 1000);
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

function normalizePlayerName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

export function isPlayerAttackerInCombatReport(report, playerUsername) {
  const user = normalizePlayerName(playerUsername);
  const attacker = normalizePlayerName(report?.attacker);
  if (!user || !attacker) return false;
  return attacker === user || attacker.includes(user) || user.includes(attacker);
}

export function getPlayerAttackCoordsTodayFromCombatReports(reports, playerUsername) {
  const coords = new Set();
  if (!playerUsername) return coords;

  for (const report of reports ?? []) {
    if (!report?.coords || !isReportToday(report)) continue;
    if (!isPlayerAttackerInCombatReport(report, playerUsername)) continue;
    coords.add(String(report.coords));
  }

  return coords;
}

export function sanitizeCombatHtml(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/\son\w+\s*=\s*(".*?"|'.*?')/gi, "");
}

function parseMessageHeadMeta(headHtml) {
  const cells = [...String(headHtml).matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    stripHtml(m[1])
  );

  const dateIdx = cells.findIndex((cell) => /\d{1,2}\.\s*\w+\s*\d{4}/.test(cell));
  const dateText = dateIdx >= 0 ? cells[dateIdx] : null;
  const from = dateIdx >= 0 ? cells[dateIdx + 1] ?? null : null;
  const subject = cells.length ? cells[cells.length - 1] : null;

  return { dateText, from, subject };
}

function formatLootBreakdown(metal, crystal, deut) {
  return `M ${formatCompactNumber(metal)} / C ${formatCompactNumber(crystal)} / D ${formatCompactNumber(deut)}`;
}

function resultRank(result) {
  const value = String(result ?? "").toLowerCase();
  if (value.includes("victoire")) return 3;
  if (value.includes("défaite") || value.includes("defaite")) return 3;
  if (value.includes("match")) return 2;
  if (value.includes("inconnu") || !value) return 0;
  return 1;
}

function pickBetterCombatResult(incoming, existing) {
  if (!existing) return incoming ?? null;
  if (!incoming) return existing ?? null;
  return resultRank(incoming) >= resultRank(existing) ? incoming : existing;
}

function pickBetterOutcome(incoming, existing) {
  if (incoming === "W" || incoming === "L" || incoming === "D") return incoming;
  return existing ?? incoming ?? null;
}

function outcomeFromCode(code) {
  if (code === "W") return "victoire";
  if (code === "L") return "défaite";
  if (code === "D") return "match nul";
  return null;
}

function parseOutcomeFromInline(bodyHtml) {
  const spanText = stripHtml(
    bodyHtml.match(/raport(?:Win|Lose)[^>]*>([\s\S]*?)<\/(?:span|a)>/i)?.[1] ?? ""
  );
  const title = spanText || stripHtml(bodyHtml.match(/Rapport de bataille[\s\S]{0,240}/i)?.[0] ?? "");

  let code =
    title.match(/\(\s*([WLD])\s*\)/i)?.[1]?.toUpperCase() ??
    bodyHtml.match(/Rapport de bataille[\s\S]*?\(\s*([WLD])\s*\)/i)?.[1]?.toUpperCase() ??
    null;

  if (!code) {
    const lower = title.toLowerCase();
    if (lower.includes("victoire")) return { outcome: "W", result: "victoire" };
    if (lower.includes("défaite") || lower.includes("defaite")) return { outcome: "L", result: "défaite" };
    if (lower.includes("match nul") || lower.includes("égalité")) {
      return { outcome: "D", result: "match nul" };
    }
    return { outcome: null, result: null };
  }

  return { outcome: code, result: outcomeFromCode(code) };
}

function parseLootFromHtml(html) {
  const source = String(html ?? "");
  const metal = parseGameAmount(
    source.match(/reportSteal element901">([^<]+)/i)?.[1] ??
      source.match(/element901">([^<]+)/i)?.[1]
  );
  const crystal = parseGameAmount(
    source.match(/reportSteal element902">([^<]+)/i)?.[1] ??
      source.match(/element902">([^<]+)/i)?.[1]
  );
  const deut = parseGameAmount(
    source.match(/reportSteal element903">([^<]+)/i)?.[1] ??
      source.match(/element903">([^<]+)/i)?.[1]
  );
  return { metal, crystal, deut };
}

function inferPlayerResultFromFullReport(html, playerUsername) {
  const user = normalizePlayerName(playerUsername);
  if (!user || !html) return null;

  const sanitized = String(html);
  const attackerMatch = sanitized.match(/Attaquant\s+([^\[\n<]+?)\s*\[(\d+:\d+:\d+)\]/i);
  const defenderMatch = sanitized.match(/Défenseur\s+([^\[\n<]+?)\s*\[(\d+:\d+:\d+)\]/i);
  const attackerName = normalizePlayerName(attackerMatch?.[1]);
  const defenderName = normalizePlayerName(defenderMatch?.[1]);

  const isAttacker = attackerName && (attackerName === user || attackerName.includes(user) || user.includes(attackerName));
  const isDefender = defenderName && (defenderName === user || defenderName.includes(user) || user.includes(defenderName));
  if (!isAttacker && !isDefender) return null;

  const attackerWon = /L'attaquant a gagné/i.test(sanitized);
  const defenderWon = /Le défenseur a gagné/i.test(sanitized);
  if (!attackerWon && !defenderWon) return null;

  if (isAttacker) {
    return attackerWon ? { outcome: "W", result: "victoire" } : { outcome: "L", result: "défaite" };
  }
  return defenderWon ? { outcome: "W", result: "victoire" } : { outcome: "L", result: "défaite" };
}

export function finalizeCombatReport(report) {
  if (!report) return report;

  const next = { ...report };
  const inlineHtml = next.summaryHtml || next.htmlBody || "";
  const fullHtml = next.fullHtml || "";

  const lootFromInline = parseLootFromHtml(inlineHtml);
  const lootFromFull = parseLootFromHtml(fullHtml);
  next.lootMetal = next.lootMetal ?? lootFromInline.metal ?? lootFromFull.metal ?? 0;
  next.lootCrystal = next.lootCrystal ?? lootFromInline.crystal ?? lootFromFull.crystal ?? 0;
  next.lootDeut = next.lootDeut ?? lootFromInline.deut ?? lootFromFull.deut ?? 0;
  next.loot = next.lootMetal + next.lootCrystal + next.lootDeut;
  next.lootFormatted = formatLootBreakdown(next.lootMetal, next.lootCrystal, next.lootDeut);

  const inlineOutcome = parseOutcomeFromInline(inlineHtml);
  next.outcome = pickBetterOutcome(next.outcome, inlineOutcome.outcome);
  next.result = pickBetterCombatResult(next.result, inlineOutcome.result);

  if (!next.outcome || !next.result) {
    const inferred = inferPlayerResultFromFullReport(fullHtml, getCredentials().username);
    if (inferred) {
      next.outcome = pickBetterOutcome(inferred.outcome, next.outcome);
      next.result = pickBetterCombatResult(inferred.result, next.result);
    }
  }

  if (!next.result) {
    next.result = "inconnu";
  }

  return next;
}

function parseRaportInline(bodyHtml) {
  if (!/raportMessage|combatReport\?raport=/i.test(bodyHtml)) return null;

  const raportHash = bodyHtml.match(/combatReport\?raport=([a-f0-9]+)/i)?.[1] ?? null;
  const { outcome, result } = parseOutcomeFromInline(bodyHtml);
  const titleMatch = bodyHtml.match(/Rapport de bataille\s*\[(\d+:\d+:\d+)\]/i);
  const coords = titleMatch?.[1] ?? bodyHtml.match(/\[(\d+:\d+:\d+)\]/)?.[1] ?? null;

  const { metal: metalLoot, crystal: crystalLoot, deut: deutLoot } = parseLootFromHtml(bodyHtml);

  const debrisMetal = parseGameAmount(bodyHtml.match(/reportDebris element901">([^<]+)/i)?.[1]);
  const debrisCrystal = parseGameAmount(bodyHtml.match(/reportDebris element902">([^<]+)/i)?.[1]);

  const attackerLosses = parseGameAmount(
    bodyHtml.match(/raportLose[^>]*>Attaquant:\s*([^<]+)/i)?.[1]
  );
  const defenderLosses = parseGameAmount(
    bodyHtml.match(/raportWin[^>]*>Défenseur:\s*([^<]+)/i)?.[1]
  );

  const lootTotal = metalLoot + crystalLoot + deutLoot;

  return finalizeCombatReport({
    raportHash,
    coords,
    outcome,
    result,
    loot: lootTotal,
    lootMetal: metalLoot,
    lootCrystal: crystalLoot,
    lootDeut: deutLoot,
    lootFormatted: formatLootBreakdown(metalLoot, crystalLoot, deutLoot),
    debrisMetal,
    debrisCrystal,
    debrisTotal: debrisMetal + debrisCrystal,
    debrisFormatted: formatCompactNumber(debrisMetal + debrisCrystal),
    attackerLosses,
    defenderLosses,
    summaryHtml: sanitizeCombatHtml(bodyHtml),
  });
}

export function parseFullCombatReportHtml(html) {
  const sanitized = sanitizeCombatHtml(html);
  const contentMatch = sanitized.match(
    /Les flottes suivantes s'opposent[\s\S]*?(?=<div class="clear">|<footer|$)/i
  );
  const fullHtml = contentMatch?.[0] ?? sanitized;

  const attackerMatch = sanitized.match(/Attaquant\s+([^\[\n<]+?)\s*\[(\d+:\d+:\d+)\]/i);
  const defenderMatch = sanitized.match(/Défenseur\s+([^\[\n<]+?)\s*\[(\d+:\d+:\d+)\]/i);

  let battleOutcome = null;
  if (/Le défenseur a gagné/i.test(sanitized)) battleOutcome = "défenseur gagne";
  else if (/L'attaquant a gagné/i.test(sanitized)) battleOutcome = "attaquant gagne";

  const attackerLosses = parseGameAmount(
    sanitized.match(/Pertes attaquant\s*:\s*<span[^>]*title="([^"]+)"/i)?.[1]
  );
  const defenderLosses = parseGameAmount(
    sanitized.match(/Pertes defenseur\s*:\s*<span[^>]*title="([^"]+)"/i)?.[1] ??
      sanitized.match(/Pertes défenseur\s*:\s*<span[^>]*title="([^"]+)"/i)?.[1]
  );

  const debrisBlock =
    sanitized.match(/Coordonnées Champs de Débris([\s\S]*?)Débris\./i)?.[1] ?? "";
  const debrisAmounts = [...debrisBlock.matchAll(/title="([^"]+)"/gi)].map((m) =>
    parseGameAmount(m[1])
  );
  const debrisMetal = debrisAmounts[0] ?? 0;
  const debrisCrystal = debrisAmounts[1] ?? 0;

  const moonChance = sanitized.match(/Probabilité d'une Lune:\s*([\d.,]+)\s*%/i)?.[1] ?? null;

  return {
    attacker: attackerMatch?.[1]?.trim() ?? null,
    attackerCoords: attackerMatch?.[2] ?? null,
    defender: defenderMatch?.[1]?.trim() ?? null,
    defenderCoords: defenderMatch?.[2] ?? null,
    battleOutcome,
    attackerLosses: attackerLosses || undefined,
    defenderLosses: defenderLosses || undefined,
    debrisMetal: debrisMetal || undefined,
    debrisCrystal: debrisCrystal || undefined,
    debrisTotal: debrisMetal + debrisCrystal || undefined,
    debrisFormatted: formatCompactNumber(debrisMetal + debrisCrystal),
    moonChance,
    fullHtml,
  };
}

export async function fetchFullCombatReport(client, raportHash) {
  const response = await client.get(`game/combatReport?raport=${raportHash}`, {
    headers: {
      Referer: "https://play.astrogame.org/uni24/game/messages",
    },
    transformResponse: [(data) => data],
  });
  return parseFullCombatReportHtml(String(response.data));
}

export function summarizeCombatMessage({ messageId, headHtml, bodyHtml }) {
  const head = parseMessageHeadMeta(headHtml);
  const inline = parseRaportInline(bodyHtml);
  if (!inline) return null;

  const timestamp = parseFrenchDateText(head.dateText);

  return {
    messageId: String(messageId),
    dateText: head.dateText ?? null,
    timestamp,
    subject: head.subject ?? null,
    from: head.from ?? null,
    ...inline,
    htmlBody: inline.summaryHtml,
  };
}

export function parseCombatReportsHtml(html) {
  const reports = [];
  const source = String(html);
  const idRegex = /<tr[^>]*class="[^"]*messages_body[^"]*"[^>]*data-message-id="(\d+)"[^>]*>/gi;

  for (const match of source.matchAll(idRegex)) {
    const messageId = match[1];
    const chunkStart = match.index ?? 0;
    const afterOpen = chunkStart + match[0].length;
    const nextRow = source.slice(afterOpen).search(/<tr[^>]*class="[^"]*(?:message_head|messages_body)/i);
    const chunkEnd = nextRow >= 0 ? afterOpen + nextRow : afterOpen + 8000;
    const chunk = source.slice(afterOpen, chunkEnd);
    const bodyHtml = chunk.match(/<div class="raportMessage">[\s\S]*<\/div>/i)?.[0] ?? "";
    if (!bodyHtml) continue;

    const headRegex = new RegExp(
      `<tr[^>]*id="message_${messageId}"[^>]*class="[^"]*message_head[^"]*"[^>]*>([\\s\\S]*?)<\\/tr>`,
      "i"
    );
    const headHtml = source.match(headRegex)?.[1] ?? "";

    const report = summarizeCombatMessage({ messageId, headHtml, bodyHtml });
    if (report) reports.push(report);
  }

  return reports;
}

function detectMaxPage(html) {
  const pages = [...String(html).matchAll(/Message\.getMessages\(\s*100\s*,\s*(\d+)\s*\)/g)].map(
    (m) => Number(m[1])
  );
  if (pages.length) return Math.max(...pages);
  const fallback = [...String(html).matchAll(/Message\.getMessages\(\d+,\s*(\d+)\)/g)].map((m) =>
    Number(m[1])
  );
  return fallback.length ? Math.max(...fallback) : 1;
}

export async function fetchCombatReportsPage(client, page = 1) {
  const response = await client.get(
    `game/messages/view?messcat=${COMBAT_CATEGORY}&site=${page}&ajax=1`,
    {
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Referer: "https://play.astrogame.org/uni24/game/messages",
      },
      transformResponse: [(data) => data],
    }
  );

  const html = String(response.data);
  return {
    page,
    maxPage: detectMaxPage(html),
    reports: parseCombatReportsHtml(html),
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function isCombatReportComplete(report) {
  return Boolean(report?.fullHtml || report?.detailsFetchedAt);
}

function buildCombatProcessedIndex(reports) {
  const byMessageId = new Map();
  const byRaportHash = new Map();
  for (const report of reports ?? []) {
    if (!isCombatReportComplete(report)) continue;
    if (report.messageId) byMessageId.set(String(report.messageId), report);
    if (report.raportHash) byRaportHash.set(String(report.raportHash), report);
  }
  return { byMessageId, byRaportHash };
}

function mergeEnrichedCombatFields(cached, report) {
  return finalizeCombatReport({
    ...cached,
    ...report,
    fullHtml: cached.fullHtml || report.fullHtml,
    htmlBody: cached.fullHtml || cached.htmlBody || report.htmlBody,
    summaryHtml: report.summaryHtml || cached.summaryHtml,
    attacker: cached.attacker || report.attacker,
    defender: cached.defender || report.defender,
    attackerCoords: cached.attackerCoords || report.attackerCoords,
    defenderCoords: cached.defenderCoords || report.defenderCoords,
    attackerLosses: cached.attackerLosses ?? report.attackerLosses,
    defenderLosses: cached.defenderLosses ?? report.defenderLosses,
    debrisMetal: cached.debrisMetal ?? report.debrisMetal,
    debrisCrystal: cached.debrisCrystal ?? report.debrisCrystal,
    debrisTotal: cached.debrisTotal ?? report.debrisTotal,
    debrisFormatted: cached.debrisFormatted || report.debrisFormatted,
    battleOutcome: cached.battleOutcome || report.battleOutcome,
    moonChance: cached.moonChance ?? report.moonChance,
    detailsFetchedAt: cached.detailsFetchedAt || report.detailsFetchedAt,
    outcome: pickBetterOutcome(report.outcome, cached.outcome),
    result: pickBetterCombatResult(report.result, cached.result),
    lootMetal: report.lootMetal ?? cached.lootMetal,
    lootCrystal: report.lootCrystal ?? cached.lootCrystal,
    lootDeut: report.lootDeut ?? cached.lootDeut,
  });
}

function resolveCachedCombatReport(report, index) {
  if (!report) return null;

  if (report.messageId) {
    const cached = index.byMessageId.get(String(report.messageId));
    if (cached) return cached;
  }

  if (report.raportHash) {
    const cached = index.byRaportHash.get(String(report.raportHash));
    if (cached) return cached;
  }

  return null;
}

async function enrichReportDetails(client, report, delayMs = 150, index = null, stats = null) {
  if (report.fullHtml) return finalizeCombatReport(report);

  const cached = index ? resolveCachedCombatReport(report, index) : null;
  if (cached) {
    stats && (stats.skipped += 1);
    return mergeEnrichedCombatFields(cached, report);
  }

  if (!report.raportHash) return report;

  try {
    stats && (stats.fetched += 1);
    const full = await fetchFullCombatReport(client, report.raportHash);
    const merged = finalizeCombatReport({
      ...report,
      ...full,
      attacker: full.attacker ?? report.attacker,
      defender: full.defender ?? report.defender,
      attackerCoords: full.attackerCoords ?? report.attackerCoords,
      defenderCoords: full.defenderCoords ?? report.defenderCoords,
      attackerLosses: full.attackerLosses ?? report.attackerLosses,
      defenderLosses: full.defenderLosses ?? report.defenderLosses,
      debrisMetal: full.debrisMetal ?? report.debrisMetal,
      debrisCrystal: full.debrisCrystal ?? report.debrisCrystal,
      debrisTotal: full.debrisTotal ?? report.debrisTotal,
      debrisFormatted: full.debrisFormatted ?? report.debrisFormatted,
      htmlBody: full.fullHtml || report.htmlBody,
      fullHtml: full.fullHtml,
      detailsFetchedAt: new Date().toISOString(),
    });
    if (index) {
      if (merged.messageId) index.byMessageId.set(String(merged.messageId), merged);
      if (merged.raportHash) index.byRaportHash.set(String(merged.raportHash), merged);
    }
    if (delayMs > 0) await sleep(delayMs);
    return merged;
  } catch (error) {
    log.warn(`Détail combat ${report.raportHash}`, { error: error.message });
    return report;
  }
}

function isNewerCombatReport(candidate, current) {
  const candidateTs = Number(candidate.timestamp) || 0;
  const currentTs = Number(current.timestamp) || 0;
  if (candidateTs !== currentTs) return candidateTs > currentTs;
  if (candidate.fullHtml && !current.fullHtml) return true;
  return String(candidate.htmlBody ?? "").length > String(current.htmlBody ?? "").length;
}

function dedupeCombatReportsByMessageId(reports) {
  const byId = new Map();
  for (const report of reports ?? []) {
    if (!report.messageId) continue;
    const existing = byId.get(report.messageId);
    if (!existing || isNewerCombatReport(report, existing)) {
      byId.set(report.messageId, report);
    }
  }
  return [...byId.values()].sort(
    (a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0)
  );
}

export function mergeCombatReports(existing = [], incoming = []) {
  const byId = new Map((existing ?? []).map((r) => [String(r.messageId), r]));
  for (const report of incoming ?? []) {
    const id = String(report.messageId);
    const prev = byId.get(id);
    if (!prev || isNewerCombatReport(report, prev)) {
      byId.set(id, finalizeCombatReport({
        ...prev,
        ...report,
        fullHtml: report.fullHtml || prev?.fullHtml,
        htmlBody: report.fullHtml || report.htmlBody || prev?.fullHtml || prev?.htmlBody,
        summaryHtml: report.summaryHtml || prev?.summaryHtml,
        attacker: report.attacker || prev?.attacker,
        defender: report.defender || prev?.defender,
        attackerCoords: report.attackerCoords || prev?.attackerCoords,
        defenderCoords: report.defenderCoords || prev?.defenderCoords,
        outcome: pickBetterOutcome(report.outcome, prev?.outcome),
        result: pickBetterCombatResult(report.result, prev?.result),
        lootMetal: report.lootMetal ?? prev?.lootMetal,
        lootCrystal: report.lootCrystal ?? prev?.lootCrystal,
        lootDeut: report.lootDeut ?? prev?.lootDeut,
      }));
    }
  }
  return dedupeCombatReportsByMessageId([...byId.values()]);
}

export function applyCombatHiddenFilter(reports, hiddenIds) {
  const hidden = new Set((hiddenIds ?? []).map(String));
  if (!hidden.size) return reports ?? [];
  return (reports ?? []).filter((report) => !hidden.has(String(report.messageId)));
}

export function removeCombatReports(data, messageIds) {
  const remove = new Set((messageIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  if (!remove.size) return { data, removed: 0 };

  const hidden = new Set((data.meta?.hiddenMessageIds ?? []).map(String));
  for (const id of remove) hidden.add(id);

  const reports = applyCombatHiddenFilter(data.reports, hidden);
  return {
    data: {
      ...data,
      meta: {
        ...data.meta,
        hiddenMessageIds: [...hidden],
        totalReports: reports.length,
      },
      reports,
    },
    removed: remove.size,
  };
}

export async function scrapeCombatReports(options = {}, client) {
  const http = client ?? (await getClient());
  const processedIndex = buildCombatProcessedIndex(options.existingReports ?? []);
  const stats = { fetched: 0, skipped: 0 };
  const reports = [];
  let maxPage = 1;

  if (options.page) {
    const result = await fetchCombatReportsPage(http, options.page);
    reports.push(...result.reports);
    maxPage = result.maxPage;
  } else {
    const first = await fetchCombatReportsPage(http, 1);
    maxPage = options.maxPages ? Math.min(options.maxPages, first.maxPage) : first.maxPage;
    reports.push(...first.reports);
    log.info(`Rapports combat page 1/${maxPage}`, { count: first.reports.length });

    for (let page = 2; page <= maxPage; page++) {
      const result = await fetchCombatReportsPage(http, page);
      reports.push(...result.reports);
      log.info(`Rapports combat page ${page}/${maxPage}`, { count: result.reports.length });
    }
  }

  let deduped = dedupeCombatReportsByMessageId(reports);

  if (options.fetchDetails !== false) {
    const enriched = [];
    for (let i = 0; i < deduped.length; i++) {
      enriched.push(
        await enrichReportDetails(
          http,
          deduped[i],
          i < deduped.length - 1 ? 120 : 0,
          processedIndex,
          stats
        )
      );
      if ((i + 1) % 10 === 0) {
        log.info(`Détails combat ${i + 1}/${deduped.length}`, {
          fetched: stats.fetched,
          skipped: stats.skipped,
        });
      }
    }
    deduped = enriched;
  }

  const payload = {
    meta: {
      scrapedAt: new Date().toISOString(),
      totalReports: deduped.length,
      rawReports: reports.length,
      pagesScanned: options.page ? 1 : maxPage,
      sortedBy: "date-desc",
      detailsFetched: stats.fetched,
      detailsSkipped: stats.skipped,
    },
    reports: deduped,
  };

  log.info(
    `Récupération des rapports de combat terminée — ${deduped.length} rapports, ${stats.fetched} détail(s) chargé(s), ${stats.skipped} ignoré(s) (déjà en cache)`
  );

  if (options.output) {
    writeFileSync(resolve(options.output), JSON.stringify(payload, null, 2), "utf8");
    log.info(`JSON exporté`, { output: options.output, reports: deduped.length });
  }

  return payload;
}

export function filterCombatReports(reports, query = {}) {
  let filtered = reports ?? [];

  if (query.search) {
    const term = String(query.search).toLowerCase();
    filtered = filtered.filter((report) => {
      const blob = [
        report.coords,
        report.attackerCoords,
        report.defenderCoords,
        report.subject,
        report.result,
        report.attacker,
        report.defender,
        report.dateText,
        stripHtml(report.htmlBody),
        stripHtml(report.fullHtml),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(term);
    });
  }

  if (query.result) {
    const wanted = String(query.result).toLowerCase();
    filtered = filtered.filter((r) => String(r.result ?? "").toLowerCase() === wanted);
  }

  if (query.coords) {
    const term = String(query.coords).trim();
    filtered = filtered.filter(
      (r) =>
        r.coords?.includes(term) ||
        r.attackerCoords?.includes(term) ||
        r.defenderCoords?.includes(term)
    );
  }

  if (query.today === "true") {
    filtered = filtered.filter(isReportToday);
  } else if (query.today === "false") {
    filtered = filtered.filter((r) => !isReportToday(r));
  }

  if (query.minLoot) {
    const min = Number(query.minLoot);
    filtered = filtered.filter((r) => (r.loot ?? 0) >= min);
  }

  return filtered;
}

export async function ensureCombatReportDetails(report, client) {
  if (!report) return report;
  if (isCombatReportComplete(report)) return finalizeCombatReport(report);
  if (!report.raportHash) return finalizeCombatReport(report);
  const http = client ?? (await getClient());
  return enrichReportDetails(http, report, 0);
}
