import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { isSansDefense } from "../src/spy-reports.js";
import { paths } from "../src/paths.js";

const MIN_LOOT = Number(process.env.ATTACK_MIN_LOOT) || 1_000_000_000;
const outPath = "targets/inactive-loot.txt";

const galaxy = existsSync(paths.galaxy.global())
  ? JSON.parse(readFileSync(paths.galaxy.global(), "utf8"))
  : null;
const loot = JSON.parse(readFileSync(paths.spy.lootTargets(), "utf8"));
const skip = existsSync(paths.attacks.import())
  ? new Set(
      JSON.parse(readFileSync(paths.attacks.import(), "utf8")).attacks.map((a) =>
        typeof a === "string" ? a : a.coords
      )
    )
  : new Set();

const inactiveByCoord = new Map();
for (const e of galaxy?.entries ?? []) {
  if (e.isAttackableInactive || e.inactive) inactiveByCoord.set(e.coords, e);
}

const byCoord = new Map();
for (const r of loot.reports ?? []) {
  const ex = byCoord.get(r.coords);
  if (!ex || (r.timestamp ?? 0) > (ex.timestamp ?? 0)) byCoord.set(r.coords, r);
}

const targets = [];
for (const [coords, r] of byCoord) {
  if (skip.has(coords)) continue;
  if (!isSansDefense(r)) continue;
  const g = inactiveByCoord.get(coords);
  if (!g?.isAttackableInactive && !g?.inactive) continue;
  if ((r.loot ?? 0) < MIN_LOOT) continue;
  targets.push({ coords, loot: r.loot, username: r.username, lootFormatted: r.lootFormatted });
}
targets.sort((a, b) => b.loot - a.loot);

const lines = [
  "# Inactifs sans défense — butin >= 1 Md — PT uniquement",
  ...targets.map((t) => t.coords),
];
writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

console.log(`${targets.length} cibles → ${outPath}`);
for (const t of targets.slice(0, 20)) {
  console.log(`  ${t.coords} ${t.username} ${t.lootFormatted}`);
}
if (targets.length > 20) console.log(`  ... +${targets.length - 20} autres`);
