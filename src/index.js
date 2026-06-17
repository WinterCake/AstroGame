import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildUpgradePlan, printUpgradePlan, upgradeNextBuilding } from "./actions.js";
import { loginFromEnv } from "./auth.js";
import { green, logSuccess } from "./logger.js";
import {
  formatBuildingLine,
  formatConstructionQueue,
  formatPlanetHeader,
  getBuildings,
  parseBuildingsPage,
  upgradeBuilding,
} from "./buildings.js";
import { parseGalaxyScrapeOptions, scrapeGalaxy } from "./galaxy.js";
import {
  mergeGalaxyExports,
  parseGalaxyMergeOptions,
  printMergeSummary,
} from "./galaxy-export.js";
import {
  parseSpyScrapeOptions,
  printSpySummary,
  scrapeSpyReports,
  writeSpyReportsExcel,
} from "./spy-reports.js";
import {
  parseAttackLootOptions,
  printAttackLootSummary,
  sendAttackLootMissions,
} from "./attack-loot-send.js";
import { parseSpySendOptions, printSpySendSummary, sendSpyMissions } from "./spy-send.js";

function printUsage() {
  console.log(`Usage:
  npm run login                  Connexion HTTP (identifiants .env, sans navigateur)
  npm run buildings              Liste les bâtiments (live)
  npm run plan                   Commandes prêtes pour les bâtiments améliorables
  npm run upgrade-next           Améliore le 1er bâtiment améliorable (priorité)
  npm run upgrade -- <id> [niv]  Améliore un bâtiment (niv. = actuel + 1 par défaut)
  npm run galaxy-scrape [opts]   Export JSON des positions joueurs (galaxie)
  npm run galaxy-merge [fichiers] Fusionne des exports JSON + Excel
  npm run spy-reports [opts]     Résumé de tous les rapports d'espionnage
  npm run spy-send [opts]        Envoie des sondes vers une liste de coords
  npm run attack-loot [opts]     Attaques pillage (PT) depuis Main Planète
  npm run parse-local            Parse la page HTML sauvegardée localement

Auth (.env) :
  ASTROGAME_USERNAME + ASTROGAME_PASSWORD   recommandé (login automatique)
  ASTROGAME_COOKIES                         optionnel (fallback manuel)

Exemples:
  npm run login
  npm run plan
  npm run upgrade-next
  npm run upgrade -- 4
  npm run upgrade -- 4 36
  npm run galaxy-scrape -- --system 5:270
  npm run galaxy-scrape -- --galaxy 5 --output galaxy-g5.json
  npm run galaxy-scrape -- --all --output galaxy-uni24.json
  npm run galaxy-scrape -- --galaxy 5 --output galaxy-g5.json --refresh
  npm run galaxy-merge -- --all
  npm run galaxy-merge -- galaxy-g5.json galaxy-2026-06-09.json
  npm run spy-reports
  npm run spy-reports -- --excel spy-reports.xlsx
  npm run spy-reports -- --output spy-reports.json --no-excel
  npm run spy-send
  npm run spy-send -- --dry-run
  npm run spy-send -- --file spy-targets.txt 4:153:8
  npm run spy-send -- --parallel 5
  npm run attack-loot -- --file targets/attacks-yesterday.txt --dry-run
  npm run attack-loot -- --file targets/attacks-yesterday.txt
`);
}

async function cmdSpySend(args) {
  const options = parseSpySendOptions(args);
  const result = await sendSpyMissions(options);
  printSpySendSummary(result);
}

async function cmdAttackLoot(args) {
  const options = parseAttackLootOptions(args);
  const result = await sendAttackLootMissions(options);
  printAttackLootSummary(result);
}

async function cmdSpyReports(args) {
  const options = parseSpyScrapeOptions(args);
  const result = await scrapeSpyReports(options);
  printSpySummary(result, { filter: options.filter });

  if (!options.noExcel && options.excel) {
    await writeSpyReportsExcel(result, options.excel);
    console.log(green(`Excel → ${resolve(options.excel)}`));
  }

  if (options.output) {
    console.log(green(`JSON → ${resolve(options.output)}`));
  }
}

async function cmdGalaxyMerge(args) {
  const options = parseGalaxyMergeOptions(args);
  const result = await mergeGalaxyExports(options);
  printMergeSummary(result);
}

async function cmdGalaxyScrape(args) {
  const options = parseGalaxyScrapeOptions(args);
  if (!options.all && !options.coords && !options.galaxy && !options.system) {
    options.coords = { galaxy: 5, system: 270 };
  }

  const result = await scrapeGalaxy(options);
  console.log(
    green(
      `OK — ${result.meta.planetEntries} planètes / ${result.meta.uniquePlayers} joueurs → ${options.output}`
    )
  );
}

async function cmdLogin() {
  await loginFromEnv();
  console.log(green("Connexion OK. Session sauvegardée dans .astrogame-session"));
}

async function cmdBuildings() {
  const page = await getBuildings();
  console.log(formatPlanetHeader(page.planet));
  const queueText = formatConstructionQueue(page.constructionQueue);
  if (queueText) {
    console.log(queueText);
  } else {
    console.log("Construction en cours : aucune");
  }
  console.log(`Bâtiments (${page.buildings.length}) :\n`);
  const { buildings } = page;
  for (const building of buildings) {
    console.log(formatBuildingLine(building));
  }
}

async function cmdPlan() {
  const page = await getBuildings();
  printUpgradePlan(buildUpgradePlan(page));
}

async function cmdUpgradeNext() {
  const { plan, result } = await upgradeNextBuilding();
  const b = result.building;
  logSuccess(
    `OK — ${b.name} : amélioration vers le niveau ${result.targetLevel}.`,
    `Niveau actuel affiché : ${b.level ?? "?"}`
  );

  const remaining = plan.commands.length - 1;
  if (remaining > 0) {
    console.log(`\n${remaining} autre(s) amélioration(s) possible(s). Lance npm run plan pour la suite.`);
  }
}

async function cmdUpgrade(args) {
  const buildingId = Number(args[0]);
  if (!Number.isInteger(buildingId) || buildingId <= 0) {
    throw new Error("ID de bâtiment invalide. Exemple : npm run upgrade -- 4 35");
  }

  let targetLevel = args[1] != null ? Number(args[1]) : null;
  if (targetLevel == null) {
    const { buildings } = await getBuildings();
    const building = buildings.find((b) => b.id === buildingId);
    if (!building?.level) {
      throw new Error(`Impossible de déterminer le niveau actuel du bâtiment ${buildingId}.`);
    }
    targetLevel = building.defaultTargetLevel ?? building.level + 1;
  }

  if (!Number.isInteger(targetLevel) || targetLevel <= 0) {
    throw new Error("Niveau cible invalide.");
  }

  const result = await upgradeBuilding(buildingId, targetLevel);
  const b = result.building;
  logSuccess(
    `OK — ${b.name} : demande d'amélioration vers le niveau ${targetLevel}.`,
    `Niveau actuel affiché : ${b.level ?? "?"}`
  );
}

function cmdParseLocal() {
  const htmlPath = resolve("Bâtiments - Chaos - Astrogame.html");
  const html = readFileSync(htmlPath, "utf8");
  const { buildings, token, planet, constructionQueue } = parseBuildingsPage(html);

  console.log(formatPlanetHeader(planet));
  const queueText = formatConstructionQueue(constructionQueue);
  console.log(queueText ?? "Construction en cours : aucune");
  console.log(`Parse local : ${buildings.length} bâtiments, token=${token ? "oui" : "non"}\n`);
  for (const building of buildings) {
    console.log(formatBuildingLine(building));
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case "login":
      await cmdLogin();
      break;
    case "buildings":
      await cmdBuildings();
      break;
    case "plan":
      await cmdPlan();
      break;
    case "upgrade-next":
      await cmdUpgradeNext();
      break;
    case "upgrade":
      await cmdUpgrade(args);
      break;
    case "galaxy-scrape":
      await cmdGalaxyScrape(args);
      break;
    case "galaxy-merge":
      await cmdGalaxyMerge(args);
      break;
    case "spy-reports":
      await cmdSpyReports(args);
      break;
    case "spy-send":
      await cmdSpySend(args);
      break;
    case "attack-loot":
      await cmdAttackLoot(args);
      break;
    case "parse-local":
      cmdParseLocal();
      break;
    default:
      printUsage();
      process.exit(command ? 1 : 0);
  }
}

main().catch((error) => {
  console.error(`\n[erreur] ${error.message}`);
  if (process.env.ASTROGAME_DEBUG !== "0" && error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
});
