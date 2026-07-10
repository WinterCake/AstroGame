import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(ROOT, "e2e", ".data");

function prepareData() {
  if (existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true });
  for (const sub of ["spy", "combat", "attacks", "galaxy", "empire"]) {
    mkdirSync(join(dataDir, sub), { recursive: true });
  }

  cpSync(join(ROOT, "tests/fixtures/spy-reports-api.json"), join(dataDir, "spy/loot-targets.json"));
  cpSync(join(ROOT, "tests/fixtures/combat-reports-api.json"), join(dataDir, "combat/reports.json"));
  cpSync(join(ROOT, "tests/fixtures/attacks-store-normalized.json"), join(dataDir, "attacks/import.json"));
  cpSync(join(ROOT, "tests/fixtures/spy-reports-api.json"), join(dataDir, "spy/reports.json"));

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
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

prepareData();
process.env.ASTROGAME_DATA_DIR = dataDir;

const { app } = await import(pathToFileURL(join(ROOT, "server/index.js")).href);
const apiPort = Number(process.env.ASTROGAME_UI_PORT) || 3847;
const apiHost = process.env.ASTROGAME_UI_HOST || "127.0.0.1";
await app.listen({ port: apiPort, host: apiHost });

const vite = spawn("npm", ["run", "dev", "--prefix", "web", "--", "--host", "127.0.0.1", "--port", "5173"], {
  cwd: ROOT,
  shell: true,
  stdio: "inherit",
});

vite.on("exit", (code) => process.exit(code ?? 1));

process.on("SIGINT", () => {
  vite.kill();
  process.exit(0);
});

await waitForUrl(`http://${apiHost}:${apiPort}/api/session`);
await waitForUrl("http://127.0.0.1:5173");
console.log(`E2E stack ready — API ${apiPort}, web 5173`);
