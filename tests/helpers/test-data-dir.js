import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "../fixtures");

let activeDir = null;
let previousDataDir = process.env.ASTROGAME_DATA_DIR;

export function createTestDataDir() {
  if (activeDir) return activeDir;

  activeDir = mkdtempSync(join(tmpdir(), "astrogame-test-"));
  for (const sub of ["spy", "attacks", "galaxy", "combat", "empire", "galaxy/exports", "attacks/history"]) {
    mkdirSync(join(activeDir, sub), { recursive: true });
  }

  previousDataDir = process.env.ASTROGAME_DATA_DIR;
  process.env.ASTROGAME_DATA_DIR = activeDir;

  writeFileSync(
    join(activeDir, "spy", "loot-targets.json"),
    readFileSync(join(fixturesDir, "spy-reports-api.json"), "utf8")
  );
  writeFileSync(
    join(activeDir, "attacks", "import.json"),
    readFileSync(join(fixturesDir, "attacks-store-normalized.json"), "utf8")
  );
  writeFileSync(
    join(activeDir, "galaxy", "global.json"),
    JSON.stringify({ entries: [] }, null, 2)
  );

  return activeDir;
}

export function destroyTestDataDir() {
  if (!activeDir) return;
  if (previousDataDir === undefined) {
    delete process.env.ASTROGAME_DATA_DIR;
  } else {
    process.env.ASTROGAME_DATA_DIR = previousDataDir;
  }
  rmSync(activeDir, { recursive: true, force: true });
  activeDir = null;
}

export function readFixture(name) {
  return readFileSync(join(fixturesDir, name), "utf8");
}
