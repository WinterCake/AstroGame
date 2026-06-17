import { readFileSync, writeFileSync } from "node:fs";
import { getDayKey } from "../src/attacks-history.js";
import { paths } from "../src/paths.js";
import { isSansDefense } from "../src/spy-reports.js";

const MIN_LOOT = Number(process.env.ATTACK_MIN_LOOT) || 500_000_000;
const outPath = process.argv[2] ?? "targets/tomorrow-attacks.txt";

const attacks = JSON.parse(readFileSync(paths.attacks.import(), "utf8"));
const galaxy = JSON.parse(readFileSync(paths.galaxy.global(), "utf8"));
const loot = JSON.parse(readFileSync(paths.spy.lootTargets(), "utf8"));

const galaxyByCoord = new Map((galaxy.entries ?? []).map((e) => [e.coords, e]));
const spyByCoord = new Map();
for (const report of loot.reports ?? []) {
  const existing = spyByCoord.get(report.coords);
  if (!existing || (report.timestamp ?? 0) > (existing.timestamp ?? 0)) {
    spyByCoord.set(report.coords, report);
  }
}

const coordHits = new Map();
const playerCoords = new Map();

for (const entry of attacks.attacks ?? []) {
  const coords = typeof entry === "string" ? entry : entry.coords;
  const at = typeof entry === "object" ? entry.at : null;
  const prev = coordHits.get(coords) ?? { count: 0, lastAt: 0 };
  prev.count += 1;
  if (at && at > prev.lastAt) prev.lastAt = at;
  coordHits.set(coords, prev);

  const spy = spyByCoord.get(coords);
  const galaxyEntry = galaxyByCoord.get(coords);
  const username = spy?.username ?? galaxyEntry?.username;
  if (!username) continue;
  if (!playerCoords.has(username)) playerCoords.set(username, new Set());
  playerCoords.get(username).add(coords);
}

function formatLoot(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Md`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  return String(Math.round(n));
}

const scored = [];

for (const [coords, { count: hitCount, lastAt }] of coordHits) {
  const spy = spyByCoord.get(coords);
  const galaxyEntry = galaxyByCoord.get(coords);
  if (!spy && !galaxyEntry) continue;
  if (galaxyEntry?.onVacation) continue;

  const lootValue = spy?.loot ?? 0;
  const sansDefense = spy ? isSansDefense(spy) : false;
  const inactive = galaxyEntry?.isAttackableInactive || galaxyEntry?.inactive;
  const player = spy?.username ?? galaxyEntry?.username ?? "?";
  const playerPlanetCount = playerCoords.get(player)?.size ?? 0;

  let score = 0;
  const reasons = [];

  if (hitCount >= 3) {
    score += 35;
    reasons.push(`${hitCount} attaques passées`);
  } else if (hitCount >= 2) {
    score += 25;
    reasons.push(`${hitCount} attaques passées`);
  } else {
    score += 15;
    reasons.push("déjà attaqué");
  }

  if (playerPlanetCount >= 5) {
    score += 25;
    reasons.push(`${playerPlanetCount} planètes du joueur`);
  } else if (playerPlanetCount >= 3) {
    score += 15;
    reasons.push(`${playerPlanetCount} planètes du joueur`);
  }

  if (galaxyEntry?.isAttackableInactive) {
    score += 15;
    reasons.push("inactif attaquable");
  } else if (inactive) {
    score += 10;
    reasons.push("inactif");
  }

  if (sansDefense) {
    score += 25;
    reasons.push("sans défense");
  } else if ((spy?.defense ?? 0) === 0 && (spy?.fleet ?? 0) > 0) {
    score += 5;
    reasons.push("flotte seule");
  }

  if (lootValue >= 5_000_000_000) {
    score += 30;
    reasons.push("gros butin");
  } else if (lootValue >= 1_000_000_000) {
    score += 20;
  } else if (lootValue >= MIN_LOOT) {
    score += 10;
  }

  if (spy?.verdict === "Gros butin") score += 10;

  if (!sansDefense && lootValue < MIN_LOOT) continue;
  if (!inactive && lootValue < 1_000_000_000) continue;

  scored.push({
    coords,
    player,
    lootValue,
    lootFormatted: spy?.lootFormatted ?? formatLoot(lootValue),
    hitCount,
    playerPlanetCount,
    sansDefense,
    score,
    reasons,
    lastDay: lastAt ? getDayKey(lastAt) : null,
  });
}

scored.sort((a, b) => b.score - a.score || b.lootValue - a.lootValue);

const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowLabel = tomorrow.toLocaleDateString("fr-FR");

const high = scored.filter((t) => t.score >= 140);
const medium = scored.filter((t) => t.score >= 120 && t.score < 140);

const lines = [
  `# Cibles prioritaires pour demain (${tomorrowLabel})`,
  "# Basé sur attaques passées + rapports espionnage + galaxie",
  "# Score = historique attaques + multi-planètes joueur + butin actuel",
  "",
  "## Priorité haute (score >= 140)",
  ...high.map(
    (t) =>
      `${t.coords}  # ${t.player} | ${t.lootFormatted} | ${t.reasons.join(", ")}`
  ),
  "",
  "## Priorité moyenne (score 120-139)",
  ...medium.map(
    (t) =>
      `${t.coords}  # ${t.player} | ${t.lootFormatted} | ${t.reasons.join(", ")}`
  ),
  "",
  "## Joueurs à enchaîner (plusieurs planètes déjà attaquées)",
];

const topPlayers = [...playerCoords.entries()]
  .filter(([, coords]) => coords.size >= 3)
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 8);

for (const [player, coords] of topPlayers) {
  const best = scored.filter((t) => t.player === player).slice(0, 5);
  if (!best.length) continue;
  lines.push(`# ${player} (${coords.size} planètes historiques)`);
  for (const target of best) {
    lines.push(`${target.coords}  # ${target.lootFormatted}${target.sansDefense ? " SD" : ""}`);
  }
  lines.push("");
}

lines.push("## Liste coords seule (copier-coller)");
lines.push(...scored.filter((t) => t.score >= 120).map((t) => t.coords));
lines.push("");

writeFileSync(outPath, lines.join("\n"), "utf8");

console.log(`${scored.length} cibles analysées → ${outPath}`);
console.log(`Haute: ${high.length} | Moyenne: ${medium.length}`);
for (const target of scored.slice(0, 15)) {
  console.log(
    `  ${target.score.toString().padStart(3)} ${target.coords} ${target.player} ${target.lootFormatted}`
  );
}
