import { readFileSync, writeFileSync } from "node:fs";
import { getClient } from "../src/client.js";
import { paths } from "../src/paths.js";
import {
  getTodayKey,
  loadAttacksFromSources,
} from "./chrome-storage-attacks.mjs";

const COMBAT_CATEGORY = 100;

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function dateMarkerInHtml(dayKey) {
  const [, month, day] = dayKey.split("-");
  return `${String(day).padStart(2, "0")}. ${MONTHS_FR[Number(month) - 1]}`;
}

function parseArgs(argv) {
  const options = {
    jsonFile: null,
    storageDir: null,
    pasteFile: null,
    day: null,
    jsonOut: paths.attacks.todayJson(),
    txtOut: paths.attacks.todayTxt(),
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json" && argv[index + 1]) {
      options.jsonFile = argv[++index];
    } else if (arg === "--storage" && argv[index + 1]) {
      options.storageDir = argv[++index];
    } else if (arg === "--paste" && argv[index + 1]) {
      options.pasteFile = argv[++index];
    } else if (arg === "--day" && argv[index + 1]) {
      options.day = argv[++index];
    } else if (arg === "--output" && argv[index + 1]) {
      options.txtOut = argv[++index];
    } else if (arg === "--json-out" && argv[index + 1]) {
      options.jsonOut = argv[++index];
    }
  }
  return options;
}

function parseActiveFleetActs(html) {
  const marker = "activeFleetActs = ";
  const start = html.indexOf(marker);
  if (start < 0) return [];

  const jsonStart = start + marker.length;
  if (html[jsonStart] !== "[") return [];

  let depth = 0;
  for (let index = jsonStart; index < html.length; index++) {
    if (html[index] === "[") depth++;
    else if (html[index] === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(jsonStart, index + 1));
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

function coordsFromFleet(fleet) {
  const end = fleet?.end;
  if (!end?.galaxy || !end?.system || !end?.position) return null;
  return `${end.galaxy}:${end.system}:${end.position}`;
}

function extractAttacksFromFleets(fleets) {
  const attacks = [];

  for (const fleet of fleets) {
    if (!fleet?.is_own || String(fleet.mission) !== "1") continue;

    const coords = coordsFromFleet(fleet);
    if (!coords) continue;

    const start = fleet?.start;
    if (
      start?.galaxy &&
      String(start.galaxy) === String(fleet.end?.galaxy) &&
      String(start.system) === String(fleet.end?.system) &&
      String(start.position) === String(fleet.end?.position)
    ) {
      continue;
    }

    const startTime = Number(fleet.start_time) || Number(fleet.end_time) || null;
    attacks.push({
      coords,
      at: startTime ? startTime * 1000 : Date.now(),
      source: "fleet-active",
      status: fleet.status ?? null,
      target: fleet.target_username ?? null,
      amount: fleet.amount ?? null,
    });
  }

  return attacks;
}

function extractAttacksFromOverview(html) {
  const attacks = [];
  const regex =
    /atteint\s+Planète\s+[^[]+\[(\d+:\d+:\d+)\][^]*?Mission:\s*Attaquer/gi;

  for (const match of html.matchAll(regex)) {
    attacks.push({
      coords: match[1],
      at: Date.now(),
      source: "overview-log",
    });
  }

  return attacks;
}

function parseDateTextToMs(dateText, dayKey = getTodayKey()) {
  const match = String(dateText).match(
    /(\d{2})\.\s*([A-Za-zÀ-ÿ]+)\s*(\d{4}),\s*(\d{2}):(\d{2}):(\d{2})/
  );
  if (!match) return null;

  const months = {
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

  const month = months[match[2].toLowerCase()];
  if (month === undefined) return null;

  const date = new Date(
    Number(match[3]),
    month,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  );

  return getTodayKey(date) === dayKey ? date.getTime() : null;
}

function extractAttacksFromCombatReportsHtml(html, dayKey = getTodayKey()) {
  const attacks = [];
  const blocks = html.split(/<tr[^>]*class="message_head"[^>]*>/i).slice(1);

  for (const block of blocks) {
    const dateMatch = block.match(/<td>\s*([^<]+?)\s*<\/td>/i);
    const subjectMatch = block.match(/<td>\s*([^<]*Rapport de bataille[^<]*)\s*<\/td>/i);
    const bodyMatch = block.match(
      /<tr[^>]*class="messages_body"[^>]*data-message-id="(\d+)"[^>]*>([\s\S]*?)<\/tr>/i
    );

    if (!dateMatch || !subjectMatch || !bodyMatch) continue;

    const at = parseDateTextToMs(dateMatch[1], dayKey);
    if (!at) continue;

    const body = bodyMatch[2];
    const coordMatches = [
      ...body.matchAll(/Rapport de bataille\s*\[(\d+:\d+:\d+)\]/gi),
      ...body.matchAll(/combatReport[^"]*"[^>]*>[^[]*\[(\d+:\d+:\d+)\]/gi),
    ];

    for (const coordMatch of coordMatches) {
      attacks.push({
        coords: coordMatch[1],
        at,
        source: "combat-report",
        messageId: bodyMatch[1],
        dateText: dateMatch[1].trim(),
      });
    }
  }

  return attacks;
}

function detectMaxPage(html) {
  const pages = [...html.matchAll(/Message\.getMessages\(\d+,\s*(\d+)\)/g)].map((m) =>
    Number(m[1])
  );
  return pages.length ? Math.max(...pages) : 1;
}

async function scrapeCombatReportsToday(client, dayKey = getTodayKey()) {
  const attacks = [];
  const firstHtml = String(
    (await client.get(`game/messages/view?messcat=${COMBAT_CATEGORY}&site=1&ajax=1`)).data
  );
  const maxPage = Math.max(detectMaxPage(firstHtml), 15);
  let emptyPages = 0;

  for (let page = 1; page <= maxPage; page++) {
    const html =
      page === 1
        ? firstHtml
        : String(
            (
              await client.get(
                `game/messages/view?messcat=${COMBAT_CATEGORY}&site=${page}&ajax=1`
              )
            ).data
          );

    const hasToday = html.includes(dateMarkerInHtml(dayKey));
    const pageAttacks = extractAttacksFromCombatReportsHtml(html, dayKey);
    attacks.push(...pageAttacks);

    if (!hasToday) emptyPages++;
    else emptyPages = 0;
    if (emptyPages >= 2) break;
  }

  return attacks;
}

function extractAttacksFromSpyPanelPaste(text, dayKey = getTodayKey()) {
  const attacks = [];
  const dayPrefix = dayKey.slice(8, 10) + "/06";

  for (const line of text.split(/\r?\n/)) {
    if (!line.includes("Déjà attaqué")) continue;
    if (!line.includes(dayPrefix) && !line.includes("09/06")) continue;
    const match = line.match(/\t(\d+:\d+:\d+)\tDéjà attaqué/);
    if (!match) continue;
    attacks.push({
      coords: match[1],
      at: Date.now(),
      source: "spy-panel-paste",
    });
  }

  return attacks;
}

function uniqueCoordsToday(attacks, dayKey = getTodayKey()) {
  const byCoords = new Map();

  for (const attack of attacks) {
    const day = getTodayKey(new Date(Number(attack.at) || Date.now()));
    if (day !== dayKey) continue;
    const existing = byCoords.get(attack.coords);
    if (!existing || Number(attack.at) > Number(existing.at)) {
      byCoords.set(attack.coords, attack);
    }
  }

  return [...byCoords.values()].sort((a, b) =>
    a.coords.localeCompare(b.coords, undefined, { numeric: true })
  );
}

const cli = parseArgs(process.argv.slice(2));
const dayKey = cli.day ?? getTodayKey();

const extension = loadAttacksFromSources({
  jsonFile: cli.jsonFile,
  storageDir: cli.storageDir,
  dayKey,
});

const client = await getClient();
const [fleetHtml, overviewHtml, combatReports] = await Promise.all([
  client.get("game/fleetTable"),
  client.get("game/overview"),
  scrapeCombatReportsToday(client, dayKey),
]);

const fromFleets = extractAttacksFromFleets(parseActiveFleetActs(String(fleetHtml.data)));
const fromOverview = extractAttacksFromOverview(String(overviewHtml.data));
const fromPaste = cli.pasteFile
  ? extractAttacksFromSpyPanelPaste(readFileSync(cli.pasteFile, "utf8"), dayKey)
  : [];

const extensionAttacks = cli.jsonFile ? extension.attacks : [];
const all = uniqueCoordsToday(
  [
    ...combatReports,
    ...fromFleets,
    ...fromOverview,
    ...fromPaste,
    ...extensionAttacks,
  ],
  dayKey
);

const output = {
  meta: {
    exportedAt: new Date().toISOString(),
    day: dayKey,
    total: all.length,
    sources: [
      "game/messages/combat-reports",
      "chrome-extension/attacksHistory",
      "chrome-extension/attacksToday",
      "fleetTable/activeFleetActs",
      "overview",
      ...(cli.jsonFile ? [`json:${cli.jsonFile}`] : []),
      ...(cli.pasteFile ? [`paste:${cli.pasteFile}`] : []),
    ],
    counts: {
      combatReports: combatReports.length,
      combatReportsUnique: new Set(combatReports.map((entry) => entry.coords)).size,
      extension: extension.chrome?.counts ?? null,
      fleetActive: fromFleets.length,
      overview: fromOverview.length,
      paste: fromPaste.length,
    },
    extensionStorage: extension.chrome?.storageDir ?? null,
  },
  coords: all.map((entry) => entry.coords),
  attacks: all,
};

const jsonPath = cli.jsonOut;
const txtPath = cli.txtOut;

writeFileSync(jsonPath, JSON.stringify(output, null, 2), "utf8");
writeFileSync(txtPath, output.coords.join("\n") + (output.coords.length ? "\n" : ""), "utf8");

console.log(`${all.length} coordonnée(s) attaquée(s) le ${dayKey}`);
console.log(`  rapports de bataille: ${output.meta.counts.combatReportsUnique} unique`);
if (extension.chrome?.counts) {
  console.log(
    `  extension Chrome: ${extension.chrome.counts.unique} (${extension.chrome.counts.attacksHistory} history + ${extension.chrome.counts.attacksToday} legacy)`
  );
}
console.log(`  flottes actives: ${fromFleets.length}`);
for (const entry of all) {
  console.log(`  ${entry.coords}${entry.target ? ` — ${entry.target}` : ""} [${entry.source}]`);
}
console.log(`\nJSON → ${jsonPath}`);
console.log(`TXT  → ${txtPath}`);
