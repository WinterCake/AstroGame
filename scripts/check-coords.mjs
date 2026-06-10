import { getClient } from "../src/client.js";
import { fetchGalaxySystem } from "../src/galaxy.js";

const coords = process.argv.slice(2).map((c) => {
  const [g, s, p] = c.split(":").map(Number);
  return { galaxy: g, system: s, position: p };
});

const client = await getClient();
const bySystem = new Map();
for (const c of coords) {
  const key = `${c.galaxy}:${c.system}`;
  if (!bySystem.has(key)) bySystem.set(key, []);
  bySystem.get(key).push(c);
}

for (const [key, list] of bySystem) {
  const [galaxy, system] = key.split(":").map(Number);
  const result = await fetchGalaxySystem(client, galaxy, system);
  for (const c of list) {
    const label = `${c.galaxy}:${c.system}:${c.position}`;
    const entry = result.entries.find((e) => e.position === c.position);
    console.log(
      label,
      entry
        ? `${entry.username} | ${entry.planetName} | id=${entry.planetId}`
        : "VIDE / pas de joueur"
    );
  }
}
