import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatCoords, loadSpyTargets } from "../src/spy-send.js";

const args = process.argv.slice(2);
let output = "targets/previous-attacks.txt";
const files = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") output = args[++i];
  else files.push(args[i]);
}

const all = new Map();

for (const file of files) {
  for (const target of loadSpyTargets(resolve(file))) {
    all.set(formatCoords(target), target);
  }
}
const lines = [
  "# Coords déjà attaquées (fusion pour re-espionnage)",
  ...[...all.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
];
writeFileSync(resolve(output), `${lines.join("\n")}\n`, "utf8");
console.log(`${all.size} coords → ${output}`);
