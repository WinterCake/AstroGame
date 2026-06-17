import { readFileSync } from "node:fs";
import { getClient } from "../src/client.js";
import { fetchGalaxySystem } from "../src/galaxy.js";
import { encodePlanetCoords } from "../src/spy-send.js";

function extractPlanetCoordsFromHtml(html, galaxy, system, position, planetId) {
  const chunk = html.slice(html.indexOf(`data-planet-id='${planetId}'`) - 500, html.indexOf(`data-planet-id='${planetId}'`) + 500);
  const match = chunk.match(new RegExp(`${planetId},\\s*(\\d+)\\)`));
  return match ? Number(match[1]) : null;
}

const failed = readFileSync("targets/spy-players-failed.txt", "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^\d+:\d+:\d+$/.test(line))
  .map((line) => {
    const [galaxy, system, position] = line.split(":").map(Number);
    return { galaxy, system, position, coords: line };
  });

const client = await getClient();
const bySystem = new Map();
for (const target of failed) {
  const key = `${target.galaxy}:${target.system}`;
  if (!bySystem.has(key)) bySystem.set(key, []);
  bySystem.get(key).push(target);
}

console.log(`Vérification live de ${failed.length} coords...\n`);
let present = 0;
let absent = 0;

for (const [key, targets] of bySystem) {
  const [galaxy, system] = key.split(":").map(Number);
  await new Promise((r) => setTimeout(r, 2000));
  const result = await fetchGalaxySystem(client, galaxy, system);
  const html = String((await client.get(`game/galaxy?galaxy=${galaxy}&system=${system}`)).data);

  for (const target of targets) {
    const entry = result.entries.find((item) => item.position === target.position);
    if (!entry) {
      absent++;
      console.log(`${target.coords} → VIDE (planète absente)`);
      continue;
    }

    present++;
    const encoded = encodePlanetCoords(target.galaxy, target.system, target.position);
    const htmlEncoded = extractPlanetCoordsFromHtml(html, target.galaxy, target.system, target.position, entry.planetId);
    const match = htmlEncoded === encoded ? "enc OK" : `enc ${encoded} vs html ${htmlEncoded ?? "?"}`;
    console.log(
      `${target.coords} → ${entry.username} | ${entry.planetName} | id=${entry.planetId} | ${match}`
    );
  }
}

console.log(`\nRésumé: ${present} présentes, ${absent} absentes`);
