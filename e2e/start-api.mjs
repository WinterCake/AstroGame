import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(ROOT, "e2e", ".data");

if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
for (const sub of ["spy", "combat", "attacks", "galaxy", "empire"]) {
  mkdirSync(join(dataDir, sub), { recursive: true });
}

cpSync(join(ROOT, "tests/fixtures/spy-reports-api.json"), join(dataDir, "spy/loot-targets.json"));
cpSync(join(ROOT, "tests/fixtures/combat-reports-api.json"), join(dataDir, "combat/reports.json"));
cpSync(join(ROOT, "tests/fixtures/attacks-store-normalized.json"), join(dataDir, "attacks/import.json"));

writeFileSync(
  join(dataDir, "galaxy/global.json"),
  JSON.stringify(
    {
      entries: [
        { coords: "1:1:1", galaxy: 1, system: 1, position: 1, username: "Alpha", inactive: true, isAttackableInactive: true },
        { coords: "1:1:2", galaxy: 1, system: 1, position: 2, username: "Beta", inactive: true, isAttackableInactive: true },
        { coords: "1:1:3", galaxy: 1, system: 1, position: 3, username: "Gamma", inactive: true, isAttackableInactive: true },
      ],
    },
    null,
    2
  ),
  "utf8"
);
cpSync(join(ROOT, "tests/fixtures/spy-reports-api.json"), join(dataDir, "spy/reports.json"));

process.env.ASTROGAME_DATA_DIR = dataDir;

const { app } = await import(pathToFileURL(join(ROOT, "server/index.js")).href);
const port = Number(process.env.ASTROGAME_UI_PORT) || 3847;
const host = process.env.ASTROGAME_UI_HOST || "127.0.0.1";

await app.listen({ port, host });
console.log(`E2E API → http://${host}:${port} (data: ${dataDir})`);
