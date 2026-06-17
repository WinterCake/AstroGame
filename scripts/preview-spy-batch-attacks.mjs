import { writeFileSync } from "node:fs";
import { buildAttackTargets, parseAttackLootOptions } from "../src/attack-loot-send.js";
import { paths } from "../src/paths.js";

const COORDS = `
2:132:6
2:333:8
1:381:8
2:26:3
3:82:8
3:82:7
2:301:8
2:381:8
2:380:15
1:190:3
1:357:15
1:330:8
2:225:4
2:335:8
1:71:8
2:335:12
2:333:12
2:135:6
1:55:3
2:29:5
2:193:7
2:135:9
1:17:8
3:43:1
3:44:9
2:335:4
2:29:9
2:30:6
2:333:4
2:236:8
`.trim().split(/\s+/);

writeFileSync("targets/spy-batch-1306.txt", "# Rapports espionnage 13/06\n" + COORDS.join("\n") + "\n");

const opts = parseAttackLootOptions([
  "--file",
  "targets/spy-batch-1306.txt",
  "--cp",
  "3392969",
  "--skip-attacked",
  paths.attacks.import(),
  "--dry-run",
]);
const targets = buildAttackTargets(opts);
console.log(`${targets.length} cibles à attaquer (PT uniquement)`);
for (const t of targets) {
  console.log(`  ${t.coords} ${t.username} ${t.lootFormatted} ${t.ships} PT`);
}
