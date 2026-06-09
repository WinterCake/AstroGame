import {
  formatConstructionQueue,
  formatPlanetHeader,
  getBuildings,
  upgradeBuilding,
} from "./buildings.js";
import { createLogger } from "./logger.js";

const log = createLogger("actions");

/** Ordre conseillé : ressources / énergie / stockage / prod */
const BUILD_PRIORITY = [1, 2, 3, 4, 12, 22, 23, 24, 14, 15, 21, 31, 33, 34, 44, 99];

export function getUpgradeableBuildings(buildings) {
  return buildings
    .filter((b) => b.upgradeable && !b.underConstruction && b.defaultTargetLevel != null)
    .sort((a, b) => {
      const pa = BUILD_PRIORITY.indexOf(a.id);
      const pb = BUILD_PRIORITY.indexOf(b.id);
      const ra = pa === -1 ? 999 : pa;
      const rb = pb === -1 ? 999 : pb;
      return ra - rb || a.id - b.id;
    });
}

export function formatUpgradeCommand(building) {
  return `npm run upgrade -- ${building.id} ${building.defaultTargetLevel}`;
}

export function formatUpgradeSummary(building) {
  return `[${building.id}] ${building.name} — niv. ${building.level} → ${building.defaultTargetLevel}`;
}

export function buildUpgradePlan(page) {
  const buildings = page.buildings ?? page;
  const upgradeable = getUpgradeableBuildings(buildings);
  return {
    planet: page.planet ?? null,
    constructionQueue: page.constructionQueue ?? [],
    upgradeable,
    commands: upgradeable.map((b) => ({
      building: b,
      command: formatUpgradeCommand(b),
      summary: formatUpgradeSummary(b),
    })),
    next: upgradeable[0] ?? null,
  };
}

export function printUpgradePlan(plan) {
  if (plan.planet) {
    console.log(formatPlanetHeader(plan.planet));
    console.log("");
  }

  const queueText = formatConstructionQueue(plan.constructionQueue);
  if (queueText) {
    console.log(queueText);
    console.log("");
  }

  if (plan.commands.length === 0) {
    console.log("Aucun bâtiment améliorable pour le moment.");
    console.log("(construction en cours, ressources insuffisantes, ou file pleine)");
    return;
  }

  console.log(`Améliorations possibles (${plan.commands.length}) :\n`);

  for (const item of plan.commands) {
    console.log(item.summary);
    console.log(`  ${item.command}\n`);
  }

  console.log("─".repeat(50));
  console.log("Action rapide (1er de la liste, par priorité) :");
  console.log("  npm run upgrade-next");
  console.log("");
  console.log(`Équivalent manuel : ${formatUpgradeCommand(plan.next)}`);
}

export async function upgradeNextBuilding(client) {
  const page = await getBuildings(client);
  const plan = buildUpgradePlan(page);

  if (!plan.next) {
    throw new Error("Aucun bâtiment améliorable pour le moment.");
  }

  const { next } = plan;
  log.info("Prochaine amélioration", {
    id: next.id,
    name: next.name,
    from: next.level,
    to: next.defaultTargetLevel,
  });

  const result = await upgradeBuilding(next.id, next.defaultTargetLevel, client);
  return { plan, result };
}
