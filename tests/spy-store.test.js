import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  buildAllSpiedCoordsSet,
  loadSpyReportsData,
  saveSpyReportsBundle,
  saveSpyReportsData,
} from "../src/spy-store.js";

let dataDir = null;
let previousDataDir = process.env.ASTROGAME_DATA_DIR;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "astrogame-spy-store-"));
  mkdirSync(join(dataDir, "spy"), { recursive: true });
  previousDataDir = process.env.ASTROGAME_DATA_DIR;
  process.env.ASTROGAME_DATA_DIR = dataDir;
});

afterEach(() => {
  if (previousDataDir === undefined) delete process.env.ASTROGAME_DATA_DIR;
  else process.env.ASTROGAME_DATA_DIR = previousDataDir;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe("spy-store", () => {
  const sample = {
    meta: { totalReports: 1 },
    reports: [{ coords: "1:1:1", messageId: "1", loot: 100 }],
  };

  it("saveSpyReportsBundle écrit loot-targets et miroir reports", () => {
    saveSpyReportsBundle(sample);
    const lootPath = join(dataDir, "spy", "loot-targets.json");
    const reportsPath = join(dataDir, "spy", "reports.json");
    expect(existsSync(lootPath)).toBe(true);
    expect(existsSync(reportsPath)).toBe(true);

    const loot = JSON.parse(readFileSync(lootPath, "utf8"));
    const archive = JSON.parse(readFileSync(reportsPath, "utf8"));
    expect(loot.meta.canonicalStore).toBe("loot-targets.json");
    expect(archive.meta.mirroredFrom).toBe("loot-targets.json");
    expect(loot.reports).toHaveLength(1);
  });

  it("loadSpyReportsData lit loot-targets en priorité", () => {
    saveSpyReportsData({ meta: {}, reports: [{ coords: "2:2:2", messageId: "2" }] });
    const loaded = loadSpyReportsData();
    expect(loaded.reports[0].coords).toBe("2:2:2");
  });

  it("saveSpyReportsData délègue au bundle avec miroir", () => {
    saveSpyReportsData(sample);
    expect(existsSync(join(dataDir, "spy", "reports.json"))).toBe(true);
  });

  it("buildAllSpiedCoordsSet fusionne rapports, masqués et spied-log", () => {
    const coords = buildAllSpiedCoordsSet({
      reports: [{ coords: "1:1:1" }],
      hiddenCoords: ["2:2:2"],
      spiedLogStore: {
        attacks: [
          { coords: "3:3:3", at: Date.now() },
          { coords: "1:1:1", at: Date.now() },
        ],
      },
    });
    expect(coords).toEqual(new Set(["1:1:1", "2:2:2", "3:3:3"]));
  });
});
